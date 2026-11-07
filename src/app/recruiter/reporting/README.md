# Reporting de suivi — `/recruiter/reporting`

Tableau de bord chiffré des recrutements de l'organisation, du matching à la décision : entonnoir de conversion,
entretiens IA, temps passé par phase, candidats bloqués, e-mails suivis, matching IA et détail par offre, filtrables par
offre et par période, avec export CSV. Rubrique « Reporting » du sous-menu ; lien « Reporting » en bas de Suivi des
annonces.
Décisions : aucun ADR. Règles produit : AGENTS.md, section « Tableau de bord du recruteur » (« Tout est compté » :
`getJobsByTenant` et `getApplicationsByTenant` servent aussi le reporting).

## Fichiers

```
page.tsx              composant serveur : session, lectures Appwrite, mise en forme ReportData
reporting-client.tsx  écran (client) : filtres offre / période, tous les calculs (useMemo), sections, CSV
loading.tsx           SectionPageSkeleton content="stats"
```

Code partagé : [jobs.ts](../../../lib/appwrite/jobs.ts) (`getJobsByTenant`, `getApplicationsByTenant`),
[funnel.ts](../../../lib/appwrite/funnel.ts) (`getFunnelStages`),
[funnel-stage-utils.ts](../../../lib/funnel-stage-utils.ts) (`resolveStatus`),
[page-skeletons.tsx](../../../components/recruiter/page-skeletons.tsx) (`SectionPageSkeleton`).

## Accès et périmètre des données

- Layout de l'espace recruteur, puis `redirect('/login')` si `!user || user.role !== 'recruiter' || !user.tenantId`.
- Lectures par `createAdminClient()`, toutes limitées à l'organisation de la session :
  offres = `getJobsByTenant` (organisation + offres partagées de la plateforme) ; candidatures, entretiens
  (`interviews`), e-mails suivis (`application_emails`), correspondances (`job_matches`) et CV des viviers d'offres
  (`vivier_cvs`, `Query.isNotNull('jobId')`) par `tenantId` ; événements `funnel_events` par identifiant de candidature ;
  noms dans `users` par identifiant de candidat.
- Données personnelles envoyées au navigateur : nom et identifiant de profil de chaque candidat (le nom n'est affiché
  que dans la liste des candidats bloqués).

## Chargement de la page

1. En parallèle : `getJobsByTenant`, `getApplicationsByTenant` (toutes les pages), `getFunnelStages`, puis
   `interviews`, `application_emails`, `job_matches`, `vivier_cvs` par la fonction locale `listAll` (une requête,
   **500 documents au plus**, liste vide en cas d'erreur, sans journal).
2. Puis, en parallèle par lots de 100 candidatures : `funnel_events` (`orderAsc('$createdAt')`, 500 par lot) ; et par
   lots de 100 candidats : leurs profils `users` (nom = « prénom nom », sinon e-mail, sinon « Candidat »).
3. `ReportData` : offres `{id, title}` ; phases `{slug, label, color, order}` ; candidatures avec statut passé par
   `resolveStatus` et `aiScore` ; événements sans ceux de type `contact` (WhatsApp) ; entretiens avec `overallScore` et
   `recommendation` tirés de `analysis` (JSON illisible ignoré) et `completedAt` ; e-mails `{createdAt, repliedAt}` ;
   correspondances `pool` (`job_matches`) et `vivier` (CV du vivier d'une offre avec `matchScore`) ; `generatedAt`.
4. `loading.tsx` : `SectionPageSkeleton` en mode `stats`. Une exception des trois premières lectures n'est pas
   rattrapée (page d'erreur par défaut de Next.js).

## Logique et algorithmes

Tout est calculé dans `ReportingClient` (`useMemo` sur les données, l'offre et la période), avec `now = generatedAt`.

### Sélection

- Offre : « Toutes les offres » ou une offre.
- Période : 7, 30, 90 jours ou « Tout » (`PERIODS`) ; `since = now - période`.
- Candidatures retenues : celles de l'offre choisie **créées** depuis `since`. Entretiens et e-mails : ceux de ces
  candidatures (quelle que soit leur date). Correspondances : celles de l'offre créées depuis `since`.

### Entonnoir et indicateurs du haut

| Étape | Valeur |
|---|---|
| Sélectionnés | candidatures retenues |
| Screenés | candidatures avec un `aiScore` |
| Entretien envoyé | candidatures ayant au moins une session d'entretien |
| Entretien terminé | candidatures ayant une session `completed` ou `analysed` |
| Acceptés | candidatures au statut `accepted` |

Pourcentage à droite = valeur / étape précédente. Indicateurs : « Candidatures dans le funnel » (avec le nombre en
`on_hold` et en `rejected`), « Taux d'acceptation » = acceptés / candidatures, « Entretiens IA terminés » = sessions
`completed` + `analysed` / sessions, « Délai moyen de décision » (ci-dessous). Sous l'entonnoir, le nombre de
candidatures par phase connue (phases triées par `order`, sans phase orpheline).

### Temps passé par phase, délai de décision, candidats bloqués

Pour chaque candidature retenue :

```
timeline = [{ stage: 'pending', at: date de création }]
pour chaque événement de la candidature postérieur à sa création, par date croissante :
  ajouter { stage, at } si stage diffère de la dernière phase de timeline
pour chaque segment i :
  si c'est le dernier et que sa phase est terminale (accepted, rejected, on_hold) : ignoré
  durée = (début du segment suivant, ou now pour le dernier) - début du segment   → perStage[stage]
entrée dans la phase actuelle = dernier segment dont stage = statut actuel, sinon la date de création
```

- Temps moyen par phase : moyenne de `perStage` pour chaque phase connue non terminale qui a au moins une mesure ;
  affiché en heures sous 1 jour, sinon en jours à une décimale (`fmtDays`).
- Délai de décision : pour les candidatures `accepted` ou `rejected`, entrée dans la phase actuelle − création ; moyenne.
- Candidats bloqués : statut non terminal et 7 jours ou plus depuis l'entrée dans la phase actuelle ; triés du plus
  ancien, 8 affichés (le titre donne le nombre total), lien vers le pipeline de l'offre.

Phases terminales : `TERMINAL = accepted, rejected, on_hold`, `slug` écrits en dur. La phase de départ est toujours
`pending`. Les phases des événements sont prises telles qu'enregistrées (sans `resolveStatus`), celles des candidatures
après `resolveStatus`.

### Entretiens IA

Nombre de sessions par statut (`pending`, `in_progress`, `completed`, `analysed`), score moyen (`overallScore`),
complétion, délai moyen de passage (création → `completedAt`, valeurs négatives écartées), et recommandations
`hire` / `consider` / `reject`.

### E-mails personnalisés

Sur `application_emails` : e-mails envoyés, candidats distincts, réponses (`repliedAt` renseigné), taux de réponse,
délai moyen de réponse (envoi → `repliedAt`).

### Matching IA

Correspondances (`pool` = `job_matches`, quel que soit le score ; `vivier` = CV du vivier d'une offre notés), score
moyen, et « Candidats de la base ajoutés au funnel » = correspondances `pool` dont le candidat a une candidature à la
même offre (toutes les candidatures, sans le filtre de période) / correspondances `pool`.

### Détail par offre et CSV

Une ligne par offre de la sélection : candidatures, correspondances, screenés, sessions d'entretien, acceptés, refusés ;
les offres sans candidature ni correspondance sur la période sont omises. Le CSV (`exportCsv`) reprend exactement ces
lignes : séparateur `;`, valeurs entre guillemets, BOM UTF-8, fins de ligne `\n`, fichier `reporting-AAAA-MM-JJ.csv`.

## Actions serveur

Aucune (lecture seule). `getFunnelStages` peut créer les phases par défaut d'une organisation qui n'en a pas (voir
[Processus de recrutement](../funnel/README.md)).

## Erreurs et cas limites

- Chiffres sous-estimés sans avertissement au-delà de 500 documents : `interviews`, `application_emails`,
  `job_matches`, `vivier_cvs` (pour toute l'organisation), et `funnel_events` par lot de 100 candidatures (les plus
  anciens gardés : les derniers mouvements manquent alors au temps par phase). Lecture en échec : liste vide, sans
  journal ni message.
- Une candidature `accepted` / `rejected` sans événement d'entrée dans cette phase compte un délai de décision de 0.
- Un pipeline dont les phases terminales n'ont pas les `slug` `accepted`, `rejected`, `on_hold` n'a ni acceptés, ni
  refusés, ni délai de décision, et ses dernières phases comptent comme « bloquées ».
- Données au moment du rendu (`generatedAt`) : « rechargez la page pour actualiser ».

## Tests

Aucun test : les calculs sont dans le composant client. Commande : `npm test`.

## Modifier cette page

- Les calculs sont dans un seul `useMemo` de `reporting-client.tsx`, sans fonction pure ni test (contrairement à
  `src/lib/recruiter-dashboard.ts` pour le tableau de bord) : un changement se vérifie à l'écran.
- Mêmes définitions que Suivi des annonces (sessions terminées, `accepted`, correspondances) : les garder alignées.
- `loading.tsx` (`SectionPageSkeleton content="stats"`) suit la mise en page : à changer avec elle.
- Contenu d'aide de l'assistant : ligne `/recruiter/reporting` de [knowledge.ts](../../../lib/assistant/knowledge.ts).
