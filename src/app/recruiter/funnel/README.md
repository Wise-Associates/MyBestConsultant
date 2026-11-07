# Processus de recrutement (« Pipelines ») — `/recruiter/funnel`

Réglage des processus de recrutement de l'organisation : pipelines (un par défaut, d'autres affectés à des offres),
phases de chaque pipeline (les colonnes du pipeline d'une offre) et bibliothèque de statuts proposés dans les phases.
Rubrique « Pipelines » du sous-menu (libellé court, AGENTS.md) et lien « Processus de recrutement » du menu du site ;
le pipeline d'une offre y renvoie (`/recruiter/funnel?tab=phases&pipeline=<id>`, `pipeline-client.tsx`).
Décisions : aucun ADR. Règles produit : AGENTS.md, section « Design System », point « Recruiter sub-menu ».

## Fichiers

```
page.tsx          composant serveur : session, loadFunnelData, onglet et pipeline initiaux lus dans l'adresse
data.ts           loadFunnelData : phases par défaut, pipelines, statuts, offres avec leur pipeline
actions.ts        Server Actions (phases, pipelines, offres d'un pipeline, statuts), chacune renvoie FunnelData relu
funnel-client.tsx écran (client) : onglets « Flux par poste », « Phases », « Statuts », fenêtres de création / renommage / suppression / affectation
```

Code partagé :

- [funnel.ts](../../../lib/appwrite/funnel.ts) — accès Appwrite : `getDefaultStages`, `getPipelines`,
  `getStatusLibrary`, `replaceStages`, `createPipeline`, `renamePipeline`, `deletePipeline`, `setPipelineJobs`,
  `saveStatusLibrary`, et pour les autres pages `getStagesForJob`, `getFunnelStages`, `ensureColumns`.
- [funnel-config.ts](../../../lib/funnel-config.ts) — règles pures : `STAGE_LIMITS`, `DEFAULT_STAGE_INPUTS`,
  `DEFAULT_STATUS_LIBRARY`, `STAGE_TEMPLATES`, `slugify`, `sanitizeStageInputs`, `sanitizeStatusList`.
- [phases-editor.tsx](../../../components/recruiter/phases-editor.tsx) — `PhasesEditor` et `StatusPicker`, éditeur
  contrôlé, aussi utilisé par la fenêtre « Processus » du pipeline d'une offre.
- [funnel-stage-utils.ts](../../../lib/funnel-stage-utils.ts) — lecture des statuts de candidature par les autres pages.

## Accès et périmètre des données

- Page : layout de l'espace recruteur, puis `redirect('/login')` si `!user || user.role !== 'recruiter' || !user.tenantId`.
  Tout recruteur de l'organisation lit et modifie les pipelines (aucune règle de propriétaire).
- Actions : `requireRecruiter()` (même condition, sinon « Non autorisé ») dans `run`, qui passe le `tenantId` de la
  session à chaque fonction.
- Données dans deux collections, toutes deux filtrées sur `tenantId`, client `createAdminClient()` :
  - `funnel_stages` : une phase par document (`slug`, `label`, `color`, `order`, `autoAction`, `pipelineId` vide pour
    le pipeline par défaut, `statusesJson`) ; 400 lues au plus par organisation.
  - `funnel_pipelines` : un document par pipeline (`kind: 'pipeline'`, `name`, `jobIdsJson`) et un document
    `kind: 'statuses'` pour la bibliothèque de statuts (`dataJson`) ; 200 lus au plus. Collection absente ou illisible :
    seul le pipeline par défaut existe (`pipelineDocs` renvoie `[]`).
- Pipeline visé par une action : `ownedPipeline` relit le document et exige le même `tenantId` (sinon « Pipeline
  introuvable. ») ; `savePipelineStagesAction` vérifie qu'il figure dans `getPipelines(tenantId)`.
- Offres affectables : celles de `getJobsByTenant(tenantId)` (organisation et offres partagées de la plateforme).

## Chargement de la page

1. `Promise.all([loadFunnelData(tenantId), searchParams])`.
2. `loadFunnelData` : en parallèle `getDefaultStages`, `getPipelines`, `getStatusLibrary`, `getJobsByTenant` ; chaque
   offre reçoit `pipelineId` = le pipeline dont `jobIdsJson` la contient, sinon `null` (pipeline par défaut).
3. Adresse lue une fois : `tab` = `phases` ou `statuts`, sinon `pipelines` ; `pipeline` = identifiant d'un pipeline
   existant, sinon `default`. L'écran ne réécrit pas l'adresse quand on change d'onglet.
4. Pas de `loading.tsx` propre : celui de l'espace recruteur ([`../loading.tsx`](../loading.tsx)). Une exception de
   lecture n'est pas rattrapée (page d'erreur par défaut de Next.js).

## Logique et algorithmes

### Pipeline par défaut créé à la première lecture

`getDefaultStages` : si l'organisation n'a aucune phase sans `pipelineId`, il crée les 9 phases de
`DEFAULT_STAGE_INPUTS` (`pending` « Candidats sélectionnés », `screening`, `interview`, `phone_interview`,
`video_interview`, `onsite_interview`, `accepted`, `on_hold`, `rejected`). Leurs `slug` reprennent les anciens statuts
fixes des candidatures, « so existing applications land in a real column with no migration needed » (commentaire de
`funnel.ts`). Toute page qui lit les phases (tableau de bord, annonces, reporting, équipe) peut donc écrire.

### Phase = valeur du statut de la candidature

Le `slug` d'une phase est la valeur enregistrée dans `applications.status`. `slugify` (éditeur, à l'ajout d'une phase)
le tire du libellé : sans accents, minuscules, `[a-z0-9_]`, 16 caractères, suffixe `_2`, `_3`… s'il est pris dans le
pipeline ; il ne change plus quand on renomme la phase. Supprimer une phase ne touche pas aux candidatures : leur statut
devient inconnu du pipeline et les autres écrans l'affichent en phase « orpheline » (`withOrphanStages`).
`autoAction` (`screening` ou `interview`) est l'« Action suggérée sur la carte » de la phase dans le pipeline d'une
offre (Screening IA ou Entretien IA, utilisée par `pipeline-client.tsx`) ; elle sert aussi à rattacher un ancien statut
à la phase qui le remplace (`resolveStatus`) et à reconnaître les colonnes `screening` / `interview` dans
`ensureColumns`.

### Validation des phases (`sanitizeStageInputs`)

Liste non vide, 20 phases au plus (`STAGE_LIMITS.stages`) ; pour chaque phase : libellé obligatoire (espaces réduits,
60 caractères), `slug` conforme à `^[a-z0-9_]{1,20}$` et unique dans la liste, couleur `#rrggbb` sinon `#6b7280`,
`autoAction` gardée seulement si elle vaut `screening` ou `interview`, statuts passés par `sanitizeStatusList`
(12 au plus, 40 caractères, doublons sans casse retirés). Premier problème trouvé = message renvoyé.

### Enregistrement des phases (`replaceStages`)

1. Lecture des phases actuelles du pipeline visé (`pipelineId`, ou sans `pipelineId` pour le défaut).
2. Création des nouvelles phases (`order` = position dans la liste).
3. Suppression des anciennes, erreurs ignorées.

Les nouvelles phases sont créées avant le retrait des anciennes (commentaire de la fonction) ; les phases ont donc de
nouveaux identifiants de document à chaque enregistrement, les `slug` restent ceux de la liste envoyée.

### Pipelines et offres

- Création (`createPipelineAction`) : nom (espaces réduits, 80 caractères, obligatoire), 15 pipelines au plus
  (`STAGE_LIMITS.pipelines`), modèle `STAGE_TEMPLATES` : `default` (copie des phases actuelles du pipeline par défaut),
  `interviews` (« Plusieurs entretiens », proposé par défaut dans la fenêtre) ou `blank` (« Pipeline minimal », 3
  phases) ; identifiant de modèle inconnu = premier modèle.
- Une offre suit au plus un pipeline : `setPipelineJobs(tenantId, pipelineId, jobIds)` écrit la liste dans le pipeline
  visé et retire ces offres de tous les autres ; `pipelineId` null = retirées de tous, donc pipeline par défaut.
  L'action garde les identifiants d'offres de l'organisation, dédoublonnés, 300 au plus ; `jobIdsJson` est coupé à
  8 000 caractères.
- Suppression d'un pipeline : ses phases, puis son document ; ses offres reviennent au pipeline par défaut (elles ne
  sont plus dans aucun `jobIdsJson`) ; les candidatures ne sont pas supprimées.
- Le pipeline d'une offre est lu par `getStagesForJob` : phases du pipeline qui la contient s'il en a, sinon celles du
  défaut.

### Bibliothèque de statuts

Un statut précise où en est un candidat dans une phase (« Planifié », « À recontacter »…). Liste par défaut
`DEFAULT_STATUS_LIBRARY` tant qu'aucun document `statuses` n'existe ; `saveStatusLibrary` la nettoie
(`sanitizeStatusList`, 60 au plus) et crée ou met à jour ce document. La bibliothèque n'est qu'une liste de suggestions
pour `StatusPicker` : les statuts choisis sont recopiés dans chaque phase (`statusesJson`).

### Brouillons de l'écran

Onglet « Phases » : les phases du pipeline choisi sont copiées en brouillon (`PhaseDraft`) ; toute modification
affiche la barre « Modifications non enregistrées » (Annuler = recharger le brouillon depuis les données). Onglet
« Statuts » : brouillon comparé à la liste enregistrée. Après chaque action, l'écran remplace ses données par
`FunnelData` renvoyé (`apply`) ; une erreur s'affiche dans le bandeau rouge du haut.

## Actions serveur

Toutes passent par `run` (`actions.ts`) : `requireRecruiter`, fonction, `revalidatePath('/recruiter/funnel')` et
`revalidatePath('/recruiter/dashboard')`, puis `loadFunnelData` relu et renvoyé ; une exception devient `{ error }`.

| Action | Rôle | Contrôles | Écritures |
|---|---|---|---|
| `savePipelineStagesAction(pipelineId, stages)` | phases d'un pipeline (`null` = défaut) | `sanitizeStageInputs` ; pipeline de l'organisation | `funnel_stages` : création puis suppression (`replaceStages`) |
| `createPipelineAction(name, templateId)` | nouveau pipeline | nom non vide ; 15 au plus | `funnel_pipelines` + ses phases |
| `renamePipelineAction(id, name)` | renomme | nom non vide ; `ownedPipeline` | `funnel_pipelines.name` |
| `deletePipelineAction(id)` | supprime | `ownedPipeline` | phases puis pipeline supprimés |
| `assignJobsAction(pipelineId, jobIds)` | offres qui suivent un pipeline | offres de `getJobsByTenant` seulement, 300 au plus ; `ownedPipeline` | `jobIdsJson` du pipeline visé et des autres |
| `saveStatusesAction(statuses)` | bibliothèque de statuts | `sanitizeStatusList` (60) | document `statuses` de `funnel_pipelines` |

## Erreurs et cas limites

- `replaceStages` n'est pas atomique et ignore les échecs de suppression : une suppression manquée laisse les deux
  jeux de phases dans le pipeline, sans message.
- Première lecture d'une organisation : deux pages chargées en même temps peuvent chacune créer les phases par défaut
  (aucun verrou dans `getDefaultStages`).
- Supprimer une phase qui a des candidatures : aucune confirmation ni migration ; voir « Phase = valeur du statut ».
- Une phase ne peut pas être supprimée s'il n'en reste qu'une (bouton désactivé dans `PhasesEditor`) ; le serveur
  refuse aussi une liste vide.
- `funnel_pipelines` absente : seul le pipeline par défaut s'affiche ; créer un pipeline échoue alors avec le message
  d'Appwrite.

## Tests

Aucun test de `funnel-config.ts`, `funnel.ts` ni des actions. Commande : `npm test`.

## Modifier cette page

- Un `slug` est une donnée enregistrée sur les candidatures : ne pas changer le `slug` d'une phase existante ni ceux
  de `DEFAULT_STAGE_INPUTS` sans migration des `applications.status`.
- Les limites de `STAGE_LIMITS` sont aussi annoncées dans [knowledge.ts](../../../lib/assistant/knowledge.ts)
  (« Jusqu'à 15 processus, 20 phases, 12 statuts par phase ») : les changer ensemble.
- `PhasesEditor` sert aussi à la fenêtre « Processus » du pipeline d'une offre
  (`src/app/recruiter/pipeline/[jobId]/`, action qui appelle `replaceStages`) : tester les deux écrans.
- Les phases terminales comptées par le reporting (`accepted`, `rejected`, `on_hold`) et « Acceptés » partout sont des
  `slug` écrits en dur : un pipeline sans ces `slug` n'a ni acceptés ni délai de décision dans ces écrans.
- Rubrique : `funnel` dans [recruiter-nav.ts](../../../lib/recruiter-nav.ts) (libellé « Pipelines ») ; nom de page dans
  « ← Retour » = celui de la rubrique.
