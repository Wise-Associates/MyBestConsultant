# Pipeline d'une offre — `/recruiter/pipeline/[jobId]`

Tableau en colonnes (Kanban) des candidatures d'une offre : une colonne par phase du pipeline de l'offre. Le recruteur
y déplace les candidats (glisser-déposer, boutons de la carte, panneau de droite), lance le screening IA et l'entretien
IA, suit le funnel de chaque candidat étape par étape et envoie des e-mails personnalisés. On y arrive par l'onglet
« Pipeline » du Matching IA, l'aperçu d'une offre du tableau de bord, le suivi des annonces et le reporting ; « Retour »
y ramène depuis la fiche candidat. Sous-route : le **Matching IA** de l'offre (`…/matching`), qui alimente le pipeline
par « Ajouter dans le funnel » ; il a son propre document : [[jobId]/matching/README.md]([jobId]/matching/README.md).
Décisions : [ADR 0028](../../../../docs/adr/0028-notation-par-jugements.md) (notation, aussi utilisée par le screening),
[ADR 0026](../../../../docs/adr/0026-correspondances-vivier-general-indexees.md) (Matching IA).
Règles produit : [AGENTS.md](../../../../AGENTS.md), sections « Design System » (« Pipeline et Matching IA d'une offre
sur grand écran ») et « Vivier général des recruteurs » (« Matching IA d'une offre », « Notation d'un candidat »).

## Fichiers

```
[jobId]/page.tsx                     composant serveur : accès, candidatures, phases, entretiens, e-mails → PipelineClient
[jobId]/loading.tsx                  PipelineSkeleton
[jobId]/pipeline-client.tsx          tableau (client) : colonnes, cartes, glisser-déposer, rail et panneau grand écran,
                                     fenêtres entretien IA, e-mail, phases, étiquettes et note, historique
[jobId]/funnel-modal.tsx             fenêtre « Funnel de recrutement » d'un candidat : suivi des étapes, personnalisation
[jobId]/actions.ts                   actions serveur du pipeline et du funnel ; requireRecruiter (repris par les deux suivants)
[jobId]/email-actions.ts             e-mail personnalisé au candidat, « Marquer comme répondu »
[jobId]/interview-detail-actions.ts  détail et analyse d'un entretien IA (fenêtre de l'admin réutilisée)
[jobId]/matching-actions.ts          actions du Matching IA (voir son README)
[jobId]/matching/                    page Matching IA de l'offre (voir son README)
```

Code partagé :

- [candidate-funnel.ts](../../../lib/candidate-funnel.ts) : funnel d'un candidat (types d'étapes, étape en cours,
  alignement sur une colonne, validation de ce que renvoie le navigateur). Pur.
- [funnel-stage-utils.ts](../../../lib/funnel-stage-utils.ts) : `resolveStatus`, `withOrphanStages` (statuts sans
  colonne). Pur.
- [funnel-config.ts](../../../lib/funnel-config.ts) : phases par défaut (`DEFAULT_STAGE_INPUTS`), bornes
  (`STAGE_LIMITS`), `sanitizeStageInputs`. Pur.
- [appwrite/funnel.ts](../../../lib/appwrite/funnel.ts) : phases et pipelines de l'organisation (`getStagesForJob`,
  `replaceStages`, `ensureColumns`), historique (`logFunnelEvent`, `getFunnelEvents`).
- [appwrite/jobs.ts](../../../lib/appwrite/jobs.ts) : `getJobById`, `getApplicationsByJob`, `updateApplicationStatus`,
  `updateApplicationCard`, `deleteApplication`.
- [candidate-identity.ts](../../../lib/candidate-identity.ts) : nom et contact d'un candidat, ou du chasseur pour un
  profil proposé par un chasseur (`resolveCandidateIdentities`, `notificationUserId`).
- [appwrite/application-emails.ts](../../../lib/appwrite/application-emails.ts) : e-mails envoyés depuis le pipeline et
  leur état de remise.
- [screening/actions.ts](../screening/actions.ts) : `screenAllApplications` (screening d'une carte),
  `sendInterviewInvitationEmail` ; [interviews/actions.ts](../interviews/actions.ts) : `getInterviewPrefillData`,
  `generateInterviewQuestions`, `createInterviewSession`.
- [interview-detail-modal.tsx](../../admin/interviews/interview-detail-modal.tsx) (fenêtre de l'admin) ;
  [whatsapp-contact.tsx](../../../components/recruiter/whatsapp-contact.tsx) ;
  [job-tabs.tsx](../../../components/recruiter/job-tabs.tsx) (`JobTabs`, `jobMetaLine`).
- Réponse du candidat : page publique [repondre/[token]](<../../(public)/repondre/[token]/actions.ts>)
  (`submitEmailReply`).

## Accès et périmètre des données

- **Page** (`page.tsx`) : `getCurrentUser()` ; pas de session, rôle autre que `recruiter` ou pas d'organisation
  (`tenantId`) → `redirect('/login')`. Offre lue par `getJobById` : absente → `notFound()` ; offre d'une autre
  organisation que celle de l'appelant et non partagée par la plateforme (`tenantId` vide) →
  `redirect('/recruiter/dashboard')`. La règle est écrite dans la page (même règle que `recruiterCanOpenJob`,
  [job-ownership.ts](../../../lib/job-ownership.ts), qu'utilisent les actions du Matching IA).
- Toutes les lectures et écritures passent par la clé API serveur (`createAdminClient`) : le périmètre ne vient que du
  code.
- **Candidatures** : `getApplicationsByJob(jobId)`, toutes celles de l'offre, sans filtre d'organisation (pour une
  offre partagée par la plateforme : celles de toutes les organisations ; le Matching IA, lui, ne garde que celles de
  l'organisation et les candidatures directes).
- **Phases** : `getStagesForJob(user.tenantId, jobId)` : pipeline de l'organisation de l'appelant, même pour une offre
  partagée.
- **Actions serveur** : chacune appelle `requireRecruiter` (rôle `recruiter` et organisation, sinon exception
  « Non autorisé »). Ce que chacune vérifie en plus est dans le tableau « Actions serveur ». Les actions du funnel passent
  par `ownApplication` : candidature de l'organisation de l'appelant **et** de l'offre `jobId`.

## Chargement de la page

1. `getCurrentUser()` et contrôle du rôle (ci-dessus).
2. En parallèle : `getJobById(jobId)`, `getApplicationsByJob(jobId)` (les 100 plus récentes, `Query.limit(100)`),
   `getStagesForJob(user.tenantId, jobId)`. Une organisation qui n'a encore aucune phase reçoit les phases par défaut à
   ce moment (`getDefaultStages` les crée).
3. Contrôle de l'offre (ci-dessus).
4. `resolveCandidateIdentities(candidateIds)` : nom, e-mail, photo, WhatsApp et téléphone ; pour un profil de chasseur
   (`role = 'hunter_profile'`), e-mail et numéros du chasseur, et son nom (`hunterName`).
5. En parallèle : `getInterviewResultsByApplication` (fonction locale de `page.tsx` : `COLLECTIONS.INTERVIEWS` des 100
   premières candidatures, 100 entretiens au plus, du plus récent au plus ancien ; analyse lue dans `analysis`) et
   `getEmailsForApplications` (`COLLECTIONS.APPLICATION_EMAILS`, 100 au plus ; état de remise de chacun lu dans Appwrite
   Messaging, `messaging.getMessage`).
6. Construction des cartes (`PipelineCandidate`) : nom à défaut `Candidat #<6 derniers caractères>` ; WhatsApp confirmé
   par le candidat, sinon son téléphone normalisé (`normalizeWhatsApp(…).e164`, `whatsappConfirmed: false`) ; statut
   rattaché à une phase actuelle (`resolveStatus`) ; funnel enregistré ou funnel par défaut aligné sur la colonne
   (`funnelForCandidate`) ; `aiScore` `null` ramené à `undefined`.
7. Colonnes : `withOrphanStages(stages, statuts)` ajoute une colonne par statut qu'aucune phase ne porte (identifiant
   `orphan-<slug>`), pour qu'aucune candidature ne disparaisse quand l'offre change de pipeline ou qu'une phase est
   supprimée.
8. `<PipelineClient>` reçoit l'offre (titre, `jobMetaLine`), les cartes, les colonnes, les e-mails et le pipeline
   (`{ id, name }`, `null` pour le pipeline par défaut). `loading.tsx` affiche `PipelineSkeleton`
   ([page-skeletons.tsx](../../../components/recruiter/page-skeletons.tsx)). Aucun `error.tsx` : une exception de
   lecture (candidatures, phases) donne la page d'erreur de Next.

## Logique et algorithmes

### Phases (colonnes) et statut d'une candidature

- Le **statut** d'une candidature (`applications.status`) est l'identifiant (`slug`) d'une phase. Les phases d'une offre
  sont celles du pipeline personnalisé dont `jobIdsJson` contient l'offre (s'il a des phases), sinon celles du pipeline
  par défaut de l'organisation (phases sans `pipelineId`) — `getStagesForJob`.
- Pipeline par défaut (`DEFAULT_STAGE_INPUTS`) : `pending`, `screening` (action suggérée `screening`), `interview`
  (action `interview`), `phone_interview`, `video_interview`, `onsite_interview`, `accepted`, `on_hold`, `rejected`.
- `resolveStatus` : un statut qui n'est pas une phase est rattaché à la phase qui a la même action suggérée, ou le même
  libellé que le statut historique (`LEGACY` : « Screening IA », « Entretien », « Accepté »…). Sinon il garde sa colonne
  orpheline (libellé de `LEGACY` ou slug mis en forme, couleur `#9ca3af`).
- **Action suggérée** d'une phase (`getStageAutoAction`, `pipeline-client.tsx`) : `autoAction` enregistrée ; à défaut,
  `screening` / `interview` pour les phases de ces identifiants (phases créées avant ce réglage).
- **« Étapes de cette offre »** (`StagesConfigModal` → `saveFunnelStagesAction`) : renommer, recolorer, réordonner,
  ajouter (identifiant `nouvelle_etape_<n>`), supprimer, choisir l'action suggérée. L'identifiant d'une phase existante
  ne change pas quand on la renomme ; les statuts de phase sont repris par identifiant. Validation `sanitizeStageInputs`
  (1 à 20 phases, nom de 60 caractères, identifiant `^[a-z0-9_]{1,20}$` unique, couleur `#rrggbb` sinon `#6b7280`).
  `replaceStages` crée les nouvelles phases puis supprime les anciennes. Le pipeline modifié est celui de l'offre : toutes
  les offres qui l'utilisent changent (le pipeline par défaut sert à toutes les offres sans pipeline personnalisé).
  « Colonnes : <pipeline> · gérer » ouvre `/recruiter/funnel?tab=phases&pipeline=<id>` ([funnel/](../funnel/)).

### Affichage du tableau

- Filtre et tri dans le navigateur (`byStage`) : score minimum (curseur de 0 à 100 par pas de 5 ; un candidat **non
  noté** reste toujours affiché), recherche sur nom et e-mail (rail, dès 1440 px ; minuscules `fr`, sans retrait des
  accents), tri par score décroissant ou croissant (non noté = −1, donc en bas en ordre décroissant).
- En-tête de colonne : nombre de cartes affichées et score moyen des cartes notées. « Statistiques »
  (`StageStatsButton`) : nombre de candidats par phase, **sans** les filtres.
- Première colonne : lien « Voir la liste du Matching IA ».
- Dès 1440 px (`min-[90rem]:`) : rail de gauche (recherche, score, tri, phases vides, e-mails `EmailsRail`,
  raccourcis) ; une phase vide devient une bande de 36 px qui reste une zone de dépôt et s'ouvre au clic
  (`collapseEmpty`, `openedEmpty`). Dès 1800 px (`min-[112.5rem]:`) : panneau `CandidatePanel` de la carte cliquée
  (clic hors lien, bouton et champ). La disposition elle-même est décrite dans AGENTS.md.
- Carte repliée par défaut (`detailsOpen`) : nom, e-mail (ou « Chasseur · <nom> »), score, étape du funnel, action
  suggérée, poignée.

### Déplacer une carte : règle du retour en arrière

`minAllowedOrder(candidate, stages)` donne l'ordre de phase le plus bas autorisé :

```
si la carte a au moins un entretien IA et qu'une phase a l'action « interview » → ordre de cette phase
sinon si la carte a un score IA et qu'une phase a l'action « screening »       → ordre de cette phase
sinon                                                                          → 0
```

- Appliquée au glisser-déposer (`handleDrop`) et à « Déplacer vers » du panneau (`moveFromPanel`, boutons désactivés
  dans `CandidatePanel`) : phase d'ordre inférieur → message « Cette candidature a déjà dépassé cette étape —
  impossible de revenir en arrière. » (4 s), rien n'est envoyé au serveur.
- **Non appliquée** aux boutons de décision de la carte (`onQuickMove`) : « Mettre en vivier » (`on_hold`),
  « Valider / accepter » (`accepted`), « Refuser » (`rejected`), toujours permis. Ces identifiants sont écrits dans le
  code, pas lus dans le pipeline.
- La règle est appliquée dans le navigateur ; `moveApplicationStage` ne la refait pas.
- Une carte dont une action est en cours (`busy`) ne se glisse pas et un dépôt est ignoré ; un voile (`CardLoader`)
  dit ce qui tourne.

`moveCard(appId, stageSlug)`, commun au glisser-déposer, aux boutons et au funnel :

1. Phase cible d'action `interview` : la carte **ne bouge pas** ; la fenêtre d'entretien IA s'ouvre
   (`autoOpenInterviewFor`). Elle ne bouge qu'à l'envoi de l'invitation (voir « Entretien IA ») : annuler la laisse où
   elle était.
2. Sinon, mise à jour immédiate de l'écran (statut, statut de phase vidé), puis `moveApplicationStage` :
   `updateApplicationStatus`, `syncFunnelToColumn` (statut de phase remis à `null` ; funnel **enregistré** aligné sur
   la colonne par `alignToColumn` : les étapes non validées qui précèdent la première étape de cette colonne passent à
   « passée » ; colonne absente du funnel : rien), `logFunnelEvent` (`stage_change`, nom du recruteur), puis
   `revalidatePath` du pipeline, du tableau de bord recruteur et du tableau de bord candidat. Erreur : la carte revient
   à sa phase, message 5 s.
3. Phase cible d'action `screening` et carte non notée : le screening de la carte part en même temps
   (`triggerScreening`).

### Screening IA d'une carte

Bouton « cerveau » de la carte (désactivé dès qu'elle a un score), action suggérée « Screening », ou dépôt dans la
phase de screening. `launchScreeningAction(appId, jobId, stageSlug?)` :

1. `screenAllApplications(jobId, [appId])` : texte du CV (12 000 caractères, `CV_CHARS_FOR_SCORING`), notation par
   jugements commune au Matching IA (`scoreApplicationInternal`, module « screening » de Config IA ; détail :
   [README du Matching IA]([jobId]/matching/README.md#notation-commune-adr-0028)), document `COLLECTIONS.SCREENINGS`,
   `aiScore` / `aiSummary` / `aiRecommendation` recopiés sur la candidature. **E-mail automatique au candidat** si le
   score est de 70 ou plus et que la candidature n'avait encore aucun score (`sendAutoScreeningEmail`).
2. Phase de destination : celle demandée si elle est dans le pipeline, sinon la phase d'action `screening`, sinon la
   phase `screening` ; aucune : la carte ne change pas de colonne. `syncFunnelToColumn` puis `logFunnelEvent`
   (`screening`, « Score: N/100 »).

### Entretien IA

Ouvert par le bouton « vidéo » de la carte, par un dépôt dans une phase d'action `interview`, ou par l'étape suivante
d'un funnel de type Entretien IA. Trois temps, rien n'est envoyé au candidat avant le troisième (`InterviewModal`) :

1. **Préparation** (à l'ouverture, `prepareInterviewAction`) : `getInterviewPrefillData` (nom et e-mail du candidat,
   offre, résumé du screening ou à défaut 3 000 caractères du CV) → `generateInterviewQuestions` (8 questions par
   l'IA, modèle par défaut de `callLLM`, réparties intro / technique / comportement / motivation / clôture, précédées
   des questions génériques activées, `getEnabledGenericQuestions`) → `createInterviewSession` (document
   `COLLECTIONS.INTERVIEWS`, statut `pending`, organisation de l'appelant). Cette fonction passe la candidature au
   statut `interview` ; `prepareInterviewAction` remet aussitôt le statut d'avant.
2. **Relecture** : titre facultatif (120 caractères), questions modifiables et supprimables, lien
   `/interview/<session>?mode=video`. Fermer ou « Annuler » supprime la session (`cancelInterviewAction`).
3. **Envoi** (`sendInterviewInviteAction`) : au moins une question non vide ; session de l'organisation de l'appelant
   et de cette candidature ; questions relues et titre enregistrés sur la session ; e-mail d'invitation
   (`sendInterviewInvitationEmail`, mode vidéo ; destinataire : compte du candidat, ou du chasseur, retrouvé par la
   candidature, à défaut par l'adresse e-mail) ; puis la carte passe dans `interviewTargetStage` (la **première** phase
   d'action `interview` du pipeline, à défaut `interview`), `syncFunnelToColumn`, `logFunnelEvent` (`interview`).

Un candidat peut recevoir autant d'entretiens que voulu, chacun sa session. La carte liste ses entretiens (plus récent
d'abord : en attente, en cours, analyse en cours, terminé ; score et recommandation de l'analyse), renommables
(`renameInterviewAction`). « Voir l'analyse, la transcription et les enregistrements » ouvre `InterviewDetailModal` de
l'admin avec `getInterviewDetailForRecruiter` et `analyzeInterviewForRecruiter` (`performInterviewAnalysis`,
[interview-analysis.ts](../../../lib/interview-analysis.ts)).

### Funnel d'un candidat

Parcours d'étapes propre à une candidature, enregistré dans `applications.funnelJson` (`{ v: 1, steps }`). Le pipeline en
est la vue d'ensemble : chaque type d'étape correspond à une colonne (`STEP_TYPES[type].column`).

- Types (`STEP_TYPES`) : `screening` → colonne `screening`, `ai_interview` → `interview`, `phone` → `phone_interview`,
  `video` → `video_interview`, `onsite` → `onsite_interview`, `other` → `other_interview`, `hired` → `accepted`.
  `screening` et `hired` ne se répètent pas. Bornes `FUNNEL_LIMITS` : 12 étapes, 5 par type, libellé de 60 caractères,
  compte rendu de 1 200.
- Funnel par défaut (`defaultFunnel`) : Screening → Entretien IA → téléphonique → visio → présentiel → Embauché ; tant
  qu'aucun funnel n'est enregistré, il est recalculé et aligné sur la colonne actuelle (`funnelForCandidate`).
- Étape en cours (`currentIndex`) : la première ni validée ni passée ; aucune = parcours terminé.
- **Suivi** (onglet « Suivi » de `FunnelModal`) : seule l'étape en cours se modifie. `saveStepProgressAction` enregistre
  statut (à faire, planifié, réalisé), résultat (favorable, réservé, défavorable) et compte rendu, refusé sur une
  étape validée. `validateStepAction` : seulement l'étape en cours, résultat obligatoire ; elle devient « validée »
  (date et nom du recruteur) ; l'action renvoie l'étape suivante et sa colonne (`columnFor` : pour Screening et
  Entretien IA, la phase d'action correspondante). La fenêtre déplace alors la carte (`moveFromFunnel` : Entretien IA
  ouvre la fenêtre d'entretien, sinon `moveCard`).
- **Compte rendu par l'IA** (`generateStepReportAction`, consigne `REPORT_SYSTEM`) : 80 à 140 mots, à partir du titre
  de l'offre, de l'étape, du résultat choisi, des notes du recruteur (800 caractères), de la note de la candidature
  (400), du screening, des analyses des 3 derniers entretiens IA et des comptes rendus des 3 dernières étapes validées.
  Rien n'est enregistré : le texte va dans le formulaire, à relire.
- **Personnaliser** (onglet « Personnaliser le funnel », `saveCandidateFunnelAction`) : étapes ajoutées (`addStep` :
  après la dernière du même type, sinon avant « Embauché »), retirées, réordonnées, renommées (`custom`, plus
  renumérotée). Une étape validée ne bouge pas et ne se supprime pas (refusé aussi par le serveur). Validation
  `sanitizeFunnel`.
- Toute écriture du funnel (`persist`) appelle d'abord `ensureColumns` : les colonnes qui manquent au pipeline de
  l'offre pour les types d'étapes du funnel sont créées à leur place logique (`COLUMN_DEFS`, `COLUMN_RANK`) — le pipeline
  partagé par d'autres offres change aussi. Les colonnes existantes ne sont pas modifiées.

### Statut dans la phase

Une phase peut proposer des statuts (`statuses`, réglés dans `/recruiter/funnel`) : liste sur la carte.
`setApplicationStageStatusAction` n'accepte qu'un statut de la phase actuelle de la candidature (vide = retiré) et
l'inscrit dans l'historique. Tout déplacement remet le statut de phase à vide.

### E-mail personnalisé et réponse du candidat

- `EmailModal` → `sendCandidateEmailAction` : objet (200 caractères) et message (3 000) obligatoires, message échappé
  ligne par ligne, bouton « Répondre » vers `<NEXT_PUBLIC_APP_URL>/repondre/<jeton>` (jeton : 18 octets aléatoires en
  hexadécimal). Envoi par Appwrite Messaging au compte du candidat (`notificationUserId` : au chasseur pour un profil de
  chasseur). Enregistré dans `COLLECTIONS.APPLICATION_EMAILS` (candidature, organisation, objet, message, identifiant du
  message, jeton).
- Les réponses à un e-mail d'Appwrite Messaging ne reviennent pas à la plateforme : le candidat répond sur la page
  publique `/repondre/<jeton>` (`submitEmailReply` : une réponse par e-mail, 3 000 caractères), qui prévient par e-mail
  le **propriétaire de l'organisation** (`tenants.recruiterId`) et relit le pipeline de l'offre. Sans réponse sur la
  plateforme, le recruteur peut « Marquer comme répondu » (`setEmailRepliedAction`, réversible).
- Affichage : colonne « Emails envoyés » au bout du tableau (sous 1440 px), sinon carte « E-mails envoyés » du rail,
  celles qui attendent une réponse en tête. État de remise lu à chaque chargement : envoyé, échec, en cours.

### WhatsApp et historique

- `WhatsAppContact` : le recruteur choisit un modèle de message, l'adapte, puis WhatsApp s'ouvre sur la conversation
  avec le numéro de la carte, message pré-rempli ; le contact est noté (`logWhatsAppContactAction` : évènement
  `contact`, note « WhatsApp », jamais le message). Sans numéro, le bouton est grisé.
- Historique (`HistoryModal`, 8 derniers dans `CandidatePanel`) : `COLLECTIONS.FUNNEL_EVENTS`, 50 derniers
  (`getFunnelEvents`). `logFunnelEvent` n'échoue jamais (erreur ignorée) ; l'auteur est le nom passé, sinon le
  recruteur de la session.

### Étiquettes, note et suppression

- « Modifier » / « Tags et note » (`EditCardModal` → `updateApplicationCardAction`) : étiquettes séparées par des
  virgules et note, écrites sur la candidature.
- « Supprimer la candidature » (après `window.confirm`) → `deleteApplicationAction` → `deleteApplication` : le document
  de la candidature seulement ; screenings, entretiens, évènements et e-mails qui la citent restent en base.

## Actions serveur

| Action | Fichier | Rôle | Contrôles | Écritures et effets |
|---|---|---|---|---|
| `moveApplicationStage` | `actions.ts` | déplacer une carte | `requireRecruiter` | `applications.status`, `stageStatus`, `funnelJson` ; évènement ; revalidation pipeline, tableaux de bord recruteur et candidat |
| `logWhatsAppContactAction` | `actions.ts` | noter un contact WhatsApp | `requireRecruiter`, candidature de l'organisation | évènement `contact` |
| `saveFunnelStagesAction` | `actions.ts` | phases du pipeline de l'offre | `requireRecruiter`, offre de l'organisation ou partagée, `sanitizeStageInputs` | `COLLECTIONS.FUNNEL_STAGES` remplacées (`replaceStages`) ; revalidation pipeline et `/recruiter/funnel` |
| `setApplicationStageStatusAction` | `actions.ts` | statut dans la phase | `requireRecruiter`, candidature de l'organisation, statut proposé par sa phase | `stageStatus` ; évènement |
| `updateApplicationCardAction` | `actions.ts` | étiquettes et note | `requireRecruiter` | `tags`, `note` |
| `deleteApplicationAction` | `actions.ts` | supprimer la candidature | `requireRecruiter` | suppression du document ; revalidation |
| `launchScreeningAction` | `actions.ts` | screening IA d'une carte | `requireRecruiter` ; `screenAllApplications` : rôle `recruiter` | IA (notation + comparaison des intitulés) ; `SCREENINGS` ; `aiScore`… ; e-mail au candidat (70 et plus, première analyse) ; statut, funnel, évènement |
| `prepareInterviewAction` | `actions.ts` | questions et session d'entretien | `requireRecruiter` ; fonctions appelées : rôle `recruiter` | IA (questions) ; session `INTERVIEWS` ; statut changé puis rétabli |
| `cancelInterviewAction` | `actions.ts` | jeter la session non envoyée | `requireRecruiter` | suppression de la session (erreur ignorée) |
| `sendInterviewInviteAction` | `actions.ts` | envoyer l'invitation | `requireRecruiter`, session de l'organisation et de la candidature, ≥ 1 question | session (questions, titre) ; e-mail ; statut, funnel, évènement |
| `renameInterviewAction` | `actions.ts` | renommer un entretien | `requireRecruiter`, entretien de l'organisation | `title` (120) |
| `getEventsAction` | `actions.ts` | historique d'une candidature | `requireRecruiter` | lecture ; erreur → liste vide |
| `saveCandidateFunnelAction` | `actions.ts` | personnaliser le funnel | `ownApplication`, `sanitizeFunnel`, étape validée conservée | `funnelJson` ; colonnes créées (`ensureColumns`) ; évènement |
| `saveStepProgressAction` | `actions.ts` | avancement de l'étape | `ownApplication`, étape non validée | `funnelJson` ; colonnes créées |
| `validateStepAction` | `actions.ts` | valider l'étape en cours | `ownApplication`, étape en cours, résultat choisi | `funnelJson` ; colonnes créées ; évènement |
| `generateStepReportAction` | `actions.ts` | compte rendu proposé par l'IA | `ownApplication` | IA (`callLLM`) ; aucune écriture |
| `sendCandidateEmailAction` | `email-actions.ts` | e-mail personnalisé | `requireRecruiter`, candidature de l'organisation, objet et message non vides | e-mail (Messaging) ; `APPLICATION_EMAILS` |
| `setEmailRepliedAction` | `email-actions.ts` | « Marquer comme répondu » | `requireRecruiter`, e-mail de l'organisation | `repliedAt` |
| `getInterviewDetailForRecruiter` | `interview-detail-actions.ts` | détail d'un entretien | `requireOwnedInterview` : rôle, organisation, entretien de l'organisation | lecture |
| `analyzeInterviewForRecruiter` | `interview-detail-actions.ts` | (re)lancer l'analyse | `requireOwnedInterview` | IA ; analyse enregistrée (`performInterviewAnalysis`) |

`requireRecruiter` est aussi exportée par `actions.ts` (fichier `'use server'`) pour `email-actions.ts` et
`matching-actions.ts`. Les actions du Matching IA sont dans son README.

## Erreurs et cas limites

- **Lectures plafonnées sans avertissement** : 100 candidatures par offre (les plus récentes), entretiens et e-mails des
  100 premières candidatures, 100 entretiens et 100 e-mails au plus.
- **Erreurs ignorées** : lecture des entretiens en échec → cartes sans résultats ; e-mails illisibles → aucun e-mail ;
  historique illisible → « Aucun évènement » ; mise à jour du funnel au déplacement et évènements d'historique en échec
  → le déplacement réussit quand même.
- Erreurs des actions du tableau : bandeau rouge en haut du tableau, 4 à 5 s ; erreurs des fenêtres : dans la fenêtre.
- **Offre partagée par la plateforme** : phases de l'organisation de l'appelant ; les actions qui vérifient
  l'organisation de la candidature (funnel, e-mail, statut de phase, WhatsApp) répondent « Non autorisé » pour une
  candidature d'une autre organisation ou sans organisation.
- Boutons « Vivier », « Accepter », « Refuser » sur un pipeline sans phase `on_hold` / `accepted` / `rejected` : le
  statut est écrit, mais le tableau n'affiche que les colonnes connues — la carte disparaît jusqu'au rechargement, où
  `resolveStatus` la rattache (libellé historique) ou lui donne une colonne orpheline.
- Dépôt dans une seconde phase d'action `interview` : l'invitation envoyée, la carte va dans la **première**.
- `syncFunnelToColumn` compare la colonne au type d'étape par identifiant (`alignToColumn`, `STEP_TYPES.column`) : une
  phase de screening ou d'entretien IA d'un autre identifiant n'aligne pas le funnel au déplacement.
- L'évènement `contact` (WhatsApp) s'affiche « contact » dans l'historique : `EVENT_LABEL` n'a pas ce type.
- À vérifier : la page n'exporte pas `maxDuration` ; le screening d'une carte, la préparation d'un entretien et le
  compte rendu par l'IA tiennent-ils dans la durée par défaut des actions serveur sur l'hébergement actuel ?

## Tests

Aucun test sur le pipeline lui-même ni sur `candidate-funnel.ts`, `funnel-config.ts`, `funnel-stage-utils.ts`. Règles
utilisées et testées : notation du screening ([match-scoring.test.ts](../../../lib/match-scoring.test.ts)), accès d'un
recruteur à une offre ([job-ownership.test.ts](../../../lib/job-ownership.test.ts), `recruiterCanOpenJob`), libellé
« Retour » ([recruiter-trail.test.ts](../../../lib/recruiter-trail.test.ts)). Tests du Matching IA : son README.
Commande : `npm test` (`node --import tsx --test "src/**/*.test.ts"`) ; un fichier :
`node --import tsx --test src/lib/match-scoring.test.ts`.

## Modifier cette page

- **Mise en page** : `PipelineSkeleton` ([page-skeletons.tsx](../../../components/recruiter/page-skeletons.tsx)) suit
  la page à chaque largeur ; points de rupture `min-[90rem]:` (1440 px) et `min-[112.5rem]:` (1800 px), largeur de
  colonne 232 px, bande de 36 px : à changer avec la page. `JobTabs` est partagé avec le Matching IA.
- **Navigation** : nom « Pipeline de l'offre » dans `PAGE_LABELS` ([recruiter-trail.ts](../../../lib/recruiter-trail.ts),
  motif `/recruiter/pipeline/<id>`) ; `/recruiter/pipeline` dans `also` de « Tableau de bord »
  ([recruiter-nav.ts](../../../lib/recruiter-nav.ts)) ; `BackLink` avec `fallbackHref="/recruiter/dashboard"`.
- **Règle du retour en arrière** : une seule fonction, `minAllowedOrder`, utilisée par `handleDrop`, `moveFromPanel` et
  `CandidatePanel` ; la garder commune.
- **Identifiants de phases** : `DEFAULT_STAGE_INPUTS`, `LEGACY`, `getStageAutoAction`, `STEP_TYPES.column`,
  `COLUMN_DEFS`, `COLUMN_RANK` et les boutons de décision (`on_hold`, `accepted`, `rejected`) reposent sur les mêmes
  identifiants : les changer ensemble.
- **Revalidation** : le pipeline est aussi relu par `submitEmailReply` (réponse du candidat) et
  `performInterviewAnalysis` (analyse d'un entretien) ; un chemin renommé doit l'être là aussi.
- **Nouvelle action serveur** : `requireRecruiter`, puis vérifier que la candidature (ou l'entretien, l'e-mail) est de
  l'organisation de l'appelant et de l'offre, comme `ownApplication`.
- Une règle produit qui change : section « Pipeline et Matching IA d'une offre sur grand écran » d'AGENTS.md.
