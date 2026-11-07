# Tableau de bord — `/recruiter/dashboard`

Page d'accueil de l'espace recruteur : quatre indicateurs, tuiles « À traiter », liste « Mes offres » (candidatures,
pipeline, diffusion sur les réseaux, recruteur affecté, archivage, suppression) et fenêtre « Nouvelle offre » (saisie
avec l'assistant de rédaction IA, ou import d'un fichier). On y arrive par l'onglet « Tableau de bord » du sous-menu
(`RECRUITER_SECTIONS`), par `/recruiter/import` (redirigé vers `?openCreateJob=1&tab=import`), par l'appel « Déposer une
offre » de la page d'accueil (`smartHref`, intention `deposit`, de `immersive-page.tsx` : `?openCreateJob=1`) et par le
lien « Republier depuis le tableau de bord » de la page d'un appel d'offres publié côté recruteur (`?offre=<id>`).
Décisions : [ADR 0023](../../../../docs/adr/0023-recruteur-affecte-identifiant-de-profil.md) (recruteur affecté = profil),
[ADR 0015](../../../../docs/adr/0015-affiche-reseaux-dessinee-par-la-plateforme.md) (diffusion en deux temps).
Règles produit : [AGENTS.md](../../../../AGENTS.md), sections « Tableau de bord du recruteur (`/recruiter/dashboard`) »,
« Tableau de bord recruteur sur grand écran » (Design System), « Publication sur les réseaux (Make + Buffer) ».

## Fichiers

```
page.tsx                   composant serveur : lectures, faits et indicateurs calculés ; maxDuration = 300
loading.tsx                squelette DashboardSkeleton
dashboard-layout.ts        largeurs du grand écran (1440 / 1800 px) et PREVIEW_MEDIA
actions.ts                 Server Actions : création, archivage, suppression, affectation, statut d'une candidature, diffusion
ai-job-draft-actions.ts    Server Actions de l'assistant de rédaction : generateJobDraft, improveJobDraft
jobs-list-client.tsx       état de la liste : filtres dans l'adresse, tuiles, rail, 50 lignes à la fois, aperçu, fenêtre des candidatures
job-row.tsx                une ligne de « Mes offres » (ROW_GRID) ; clic → Matching IA ou aperçu
job-actions.tsx            « Modifier » et menu « Autres actions »
job-assignee-select.tsx    choix du recruteur affecté
social-status.tsx          colonne « Diffusion » et usePublish (lancer / relancer)
job-preview-panel.tsx      panneau d'aperçu en lecture seule (1800 px et plus)
job-applications-modal.tsx fenêtre « Candidatures » d'une offre
applications-panel.tsx     CandidateCard (Retenir / Refuser / Vivier) ; ApplicationsPanel, importé nulle part
dashboard-stats.tsx        les quatre indicateurs
recruiter-filter.tsx       filtre « Recruteurs » (appliqué par le serveur)
contract-filter.tsx        filtre « Type de contrat » (appliqué dans le navigateur)
create-job-dialog.tsx      fenêtre « Nouvelle offre » : saisie manuelle, bibliothèque, assistant IA
import-panel.tsx           onglet « Import IA / Excel » de la fenêtre
```

Code partagé :

- [recruiter-dashboard.ts](../../../lib/recruiter-dashboard.ts) : `jobState`, `expiresInDays`, `jobFacts`, `summarize` (pur, heure injectée).
- [recruiter-job-filters.ts](../../../lib/recruiter-job-filters.ts) : filtres, tri, lecture / écriture de l'adresse, sélection de recruteurs (pur).
- [url-list-state.ts](../../../lib/url-list-state.ts) : `initialUrlListSync`, `noteListWrite`, `syncFromUrl` (pur).
- [appwrite/jobs.ts](../../../lib/appwrite/jobs.ts) : lectures et écritures de `jobs` et `applications` ; [appwrite/list-all.ts](../../../lib/appwrite/list-all.ts) : `listAllDocuments`.
- [appwrite/funnel.ts](../../../lib/appwrite/funnel.ts) : `getFunnelStages` ; [funnel-stage-utils.ts](../../../lib/funnel-stage-utils.ts) : `resolveStatus`.
- [recruiter-assignment.ts](../../../lib/recruiter-assignment.ts) (`server-only`), [assignment-email.ts](../../../lib/assignment-email.ts), [job-ownership.ts](../../../lib/job-ownership.ts).
- [job-pay.ts](../../../lib/job-pay.ts) : unité du montant (TJM ou salaire annuel).
- [social.ts](../../../lib/social.ts) : `latestPostsByJob`, `latestSocialStateByJob`, `prepareSocialPost`, `deliverSocialPost`, `tryAutoPublishJob`, `isMakeConfigured`, `deliveryDeadline`.
- [auto-source-candidates.ts](../../../lib/auto-source-candidates.ts) : `tryAutoSourceCandidates` ; [sourcing-rules.ts](../../../lib/sourcing-rules.ts) : `bestMatches`.
- [ao/platform-view.ts](../../../lib/ao/platform-view.ts) : `aoAccessFor` (affectation d'une offre issue d'un AO).
- [format-date.ts](../../../lib/format-date.ts) : `formatDateFr` ; [candidate-identity.ts](../../../lib/candidate-identity.ts) : `displayEmail`.
- [import/actions.ts](../import/actions.ts) : `parseFileWithLLM`, `importJobsChunk` ; [import/import-client.tsx](../import/import-client.tsx) : `JobCard`.
- [admin/jobs/job-edit-modal.tsx](../../admin/jobs/job-edit-modal.tsx) et l'action `updateJob` de [admin/jobs/actions.ts](../../admin/jobs/actions.ts) (« Modifier »).
- [page-skeletons.tsx](../../../components/recruiter/page-skeletons.tsx) : `DashboardSkeleton`.

## Accès et périmètre des données

- `middleware.ts` ne regarde que les cookies (`mbc-session` présent ; `mbc-role`, s'il existe, égal à `recruiter`) :
  ce n'est pas un contrôle d'accès.
- Le layout [`../layout.tsx`](../layout.tsx) appelle `getCurrentUser()` et redirige vers `/login` sans session ou si
  `role !== 'recruiter'`. `page.tsx` rappelle `getCurrentUser()` et redirige vers `/login` sans utilisateur ou sans
  `tenantId` ; elle ne revérifie pas le rôle.
- `getCurrentUser` lit le compte avec la session (`createSessionClient`), puis le profil `users`. Toutes les autres
  lectures et écritures de la page et de ses actions passent par la clé API serveur (`createAdminClient`) : le
  périmètre ne tient qu'aux filtres de requête, construits avec `user.tenantId` de la session.

| Donnée | Collection (`COLLECTIONS.…`) | Périmètre |
|---|---|---|
| Offres | `JOBS` | `tenantId` = organisation, plus les offres partagées de la plateforme `tenantId = ''` (`getJobsByTenant`) ; avec le filtre « Recruteurs » : organisation et `recruiterId` dans la sélection, ou nul (`getTenantJobsOfRecruiters`), sans offres partagées |
| Candidatures | `APPLICATIONS` | `tenantId` = organisation (`getApplicationsByTenant`) ; avec le filtre : en plus `jobId` parmi les offres lues (`getApplicationsOfJobs`, lots de `JOB_BATCH` = 100 offres) |
| Noms des candidats | `USERS` | `$id` parmi les candidats des candidatures lues |
| Correspondances IA | `JOB_MATCHES`, `VIVIER_CVS` | `tenantId` = organisation ; `VIVIER_CVS` avec `jobId` non nul (vivier général exclu) |
| Phases | `FUNNEL_STAGES` | `tenantId` = organisation |
| Diffusions | `SOCIAL_POSTS` | `tenantId` = organisation, champs d'état seulement (`Query.select`, sans le corps envoyé à Make) |
| Équipe | `USERS` | `tenantId` = organisation et `role = 'recruiter'`, 100 au plus (`listTenantRecruiters`) |

Le compte Auth des recruteurs (`users.userId`) n'est pas envoyé au navigateur : la page passe `recruiterOptions(…)`
(identifiant de profil et nom). Contrôles des actions : voir « Actions serveur ».

## Chargement de la page

1. Lecture de `searchParams` : `offre` (offre à montrer) et `recruteurs` (filtre « Recruteurs »).
2. `getCurrentUser()` et redirections (ci-dessus).
3. Lectures lancées ensemble, attendues par un seul `Promise.all` :
   - `listTenantRecruiters(tenantId)` ; échec journalisé (`[dashboard] recruteurs de l’organisation non lus`) → `null`.
   - sélection : sans `recruteurs`, `null` tout de suite ; sinon, une fois l'équipe lue,
     `parseRecruiterSelection(recruteurs, identifiants de l'équipe ou [])`. Seules les offres attendent l'équipe.
   - offres et candidatures : avec une sélection, `getTenantJobsOfRecruiters` puis `getApplicationsOfJobs` sur leurs
     identifiants ; sinon `getJobsByTenant` et `getApplicationsByTenant` en parallèle. Toutes lues en entier
     (`listAllDocuments`, pages de 500 avec curseur).
   - `countMatchesByJob(tenantId)` (badge « correspondances IA »).
   - `getFunnelStages(tenantId)` : phases du pipeline par défaut puis celles des pipelines personnalisés, dédoublonnées
     par `slug`. Si l'organisation n'a aucune phase par défaut, `getDefaultStages` les crée (`DEFAULT_STAGE_INPUTS`) :
     ce chargement peut donc écrire.
   - `latestPostsByJob(tenantId)` (dernière diffusion de chaque offre) ; échec journalisé → `null`.
4. `resolveCandidateNames(allApplications)` : identifiants de candidats dédoublonnés, lots de `NAME_BATCH` = 25 (`Query.equal('$id', …)`),
   `PARALLEL_BATCHES` = 8 lots en parallèle ; nom = prénom + nom, e-mail = `displayEmail` (vide pour un profil de
   chasseur).
5. Construction de `appsByJobRecord` (jobId → `CandidateApp[]`) pour toutes les offres, afin que la fenêtre
   « Candidatures » s'ouvre sans aller-retour serveur. Statut = `resolveStatus(funnelStages, app.status)` ; e-mail
   affiché, à défaut l'identifiant du candidat.
6. Calculs sur le serveur, `now = new Date()` : `keys` (`resolveStatus` de `'pending'` et de `'accepted'`),
   `summarize(jobs, Object.values(appsByJobRecord), keys, now)`, puis une `DashboardJobRow` par offre : `jobFacts`,
   `publishedOn = formatDateFr(job.createdAt)`, `shared = job.tenantId !== tenantId`, `matches`, `social`
   (`status`, `results`, `stale`, `sentOn = formatDateFr(sentAt ?? createdAt)`).
7. Rendu : `JobsListClient` reçoit les lignes, `appsByJobRecord`, les phases, `socialEnabled = isMakeConfigured()`,
   `socialUnavailable`, les recruteurs, `jobsWithNew`, `focusJobId` (`offre` s'il est une chaîne), `recruiterFiltered` et,
   en `header`, l'avertissement du filtre, la ligne « Indicateurs et offres de : … · Tous les recruteurs » et
   `DashboardStats`. `RecruiterFilter` et `CreateJobDialog` (variante `primary`) sont sous `Suspense` (`useSearchParams`).

`maxDuration = 300` : les Server Actions de la page (création d'offre, import, diffusion) envoient la publication en
arrière-plan, photo de l'affiche par OpenAI (jusqu'à 2 min) puis envoi à Make (commentaire de `page.tsx`).
`loading.tsx` affiche `DashboardSkeleton`, construit sur la même grille que la page. Erreurs : voir « Erreurs et cas
limites ».

## Logique et algorithmes

### État et échéance d'une offre

`jobState` ([recruiter-dashboard.ts](../../../lib/recruiter-dashboard.ts)) : `isActive` faux → `archived` ; actif et
`expiresAt` passé → `expired` (le passage quotidien `/api/cron/deactivate-expired-jobs` le désactivera) ; sinon
`online`. `expiresInDays` : pour une offre `online` seulement, jours restants arrondis au jour supérieur (1 au moins),
`null` au-delà de `EXPIRING_SOON_DAYS` = 7. Onglets de statut : « En ligne » = `online`, « Archivées » = `expired` et
`archived`, donc En ligne + Archivées = Toutes.

### Faits d'une ligne (`jobFacts`)

Entrées : l'offre, ses candidatures (statut déjà passé par `resolveStatus`), `keys`, le statut de sa dernière
diffusion, `now`. Sortie `JobFacts` : `state`, `expiresInDays`, `applications` (nombre), `newApplications` (statut =
`keys.newStatus`, l'étape où arrive toute candidature créée par `createApplication`), `avgScore` (moyenne arrondie des
`aiScore` numériques, `null` sans note), `diffusionFailed` (offre `online` et dernière diffusion `failed`).

### Indicateurs (`summarize`, `DashboardStats`)

Calculés sur toutes les offres et candidatures lues (la sélection seulement avec le filtre « Recruteurs ») :

- Offres : `total`, `online`, `offline` = total − en ligne (« sur N offres · M archivées »).
- Candidatures : `total` ; `weekly`, `WEEKS_SHOWN` = 8 tranches de 7 jours comptées depuis `now`, la plus ancienne
  d'abord, la dernière = les 7 derniers jours (« +N sur 7 jours ») ; barres de hauteur `max(2, round(n / pic × 28))` px.
- Score moyen IA : moyenne arrondie des `aiScore` numériques, `scored` = nombre de candidatures notées.
- Taux de sélection : `accepted` (statut = `keys.acceptedStatus`) / total, en %, arrondi ; `null` sans candidature.
- `new` (nouvelles candidatures) et `jobsWithNew` (nombre de listes de candidatures par offre qui en contiennent au
  moins une) : sous-titre de la première tuile.

### Tuiles « À traiter »

`matchesFocus` ([recruiter-job-filters.ts](../../../lib/recruiter-job-filters.ts)) :

| Tuile (`JobFocus`) | Offre retenue | Chiffre affiché (`jobs-list-client.tsx`) |
|---|---|---|
| `new` | `newApplications > 0` | somme des `newApplications` des lignes ; sous-titre « Réparties sur `jobsWithNew` offres » |
| `noApplications` | `online` et 0 candidature | nombre d'offres ; « Dont N avec des correspondances IA » si `matches > 0` |
| `diffusionFailed` | `diffusionFailed` | nombre d'offres |
| `expiringSoon` | `expiresInDays !== null` | nombre d'offres |

Un clic choisit la tuile comme filtre `focus` (un second clic le retire) ; une tuile à 0 est désactivée sauf si elle
est déjà choisie. Les tuiles sont rendues deux fois : dans le rail (1440 px et plus) et dans la section « À traiter »
(en dessous) ; une seule est visible.

### Filtres, tri et adresse de « Mes offres »

Appliqués dans le navigateur (`filterJobs`) sur toutes les lignes reçues :

- `q` : intitulé, ville et `companyName`, sans casse ni accents (`fold` : NFD puis retrait des diacritiques).
- `status` : `all` / `active` (`online`) / `archived` (tout le reste).
- `contract` : choix multiple ; une offre sans contrat est écartée dès qu'un contrat est choisi.
- `focus` : tuile « À traiter ».
- `sort` : `recent` (`createdAt` décroissant), `applications`, `score` (`avgScore`), `expiry` (échéance des offres
  `online` seulement) ; valeur absente toujours en fin de liste (`nullsLast`), départage par `recent`.

`isFiltering` : un filtre autre que le tri est actif (bouton « Réinitialiser les filtres » de la liste vide).

Adresse : `jobFiltersFromSearchParams` lit `q` (tronqué à `MAX_QUERY` = 200 caractères), `status`, `contract`
(`cdi,mission`, valeurs inconnues ignorées, ordre de `JOB_CONTRACTS` par `normalizeContracts`, anciens liens à une seule
valeur acceptés), `focus`, `sort` ; une valeur inconnue reprend sa valeur par défaut. `withJobFilters` les réécrit sans
les valeurs par défaut, en gardant les autres paramètres (`recruteurs`, `offre`). Synchronisation (`jobs-list-client.tsx`
et [url-list-state.ts](../../../lib/url-list-state.ts)) :

1. Un changement de filtre (`update`) met à jour l'état, remet l'affichage à 50 lignes, note l'écriture
   (`noteListWrite`, `MAX_PENDING` = 50 écritures gardées) et écrit l'adresse par `history.replaceState` (ni nouvelle
   entrée d'historique, ni rendu serveur).
2. À chaque rendu, la forme normalisée des filtres de `useSearchParams` est comparée à la dernière vue
   (`syncFromUrl`) : une adresse que la liste n'a pas écrite (onglet « Tableau de bord » du sous-menu, lien « Tous les
   recruteurs », Précédent) est adoptée ; une écriture de la liste arrivée en retard pendant une frappe ne l'est pas.

### Filtre « Recruteurs » (appliqué par le serveur)

`recruiter-filter.tsx` : cases « (vous) » d'abord, puis l'équipe, puis « Non affectées » ; « Appliquer » écrit
`?recruteurs=<profil>,<profil>,aucun` (`recruiterSelectionParam`, `RECRUITERS_PARAM`), retire `offre`, garde les autres
paramètres et fait un `router.replace` (rendu serveur). Rien ne change si la valeur est identique ; Échap, un clic ou
un focus hors du panneau le referment sans appliquer. Côté serveur, `parseRecruiterSelection` ne garde que les profils
de l'équipe et `aucun` ; rien de valable → `null` (toutes les offres). `getTenantJobsOfRecruiters` fait une requête par
cas (`Query.equal('recruiterId', ids)`, `Query.isNull('recruiterId')`), réunies puis triées par date. Les indicateurs,
les tuiles et la liste ne portent alors que sur ces offres et leurs candidatures. Le bouton « Tous les recruteurs » du
panneau ne retire que `recruteurs` ; le lien du même nom, au-dessus des indicateurs, mène à `/recruiter/dashboard`
sans paramètre (les filtres de la liste sont donc aussi retirés).

### Affichage par lots et offre ciblée (`?offre=`)

`PAGE_SIZE` = 50 lignes à la fois, « Afficher N offres de plus » ajoute 50 ; toutes les lignes restent en mémoire. Avec
`?offre=<id>`, le nombre initial de lignes est `max(50, rang de l'offre dans la liste filtrée + 1)`, l'offre est
présélectionnée dans l'aperçu, mise en évidence, amenée au centre de l'écran (`scrollIntoView`, sans animation si
`prefers-reduced-motion`) et reçoit le focus, une seule fois par valeur de `focusJobId`. L'identifiant n'est comparé
qu'aux offres déjà chargées.

### Badge « correspondances IA » (`countMatchesByJob`, `page.tsx`)

Par offre : nombre de lignes `JOB_MATCHES` de l'organisation (base candidats, quel que soit le score) + nombre de
`VIVIER_CVS` de l'organisation rattachés à l'offre et dont `matchScore` n'est pas nul (CV de tous les recruteurs de
l'organisation). Les correspondances du vivier général (`vivier_offer_matches`) ne sont pas comptées. Affiché sur la
ligne seulement quand l'offre n'a aucune candidature, et dans l'aperçu ; échec de lecture → badge absent.

### Colonne « Diffusion » (`SocialStatus`, `usePublish`)

Réseaux affichés : résultats `published` ou `scheduled` de la dernière diffusion, liés à leur `url`. Texte d'état, dans
cet ordre de priorité :

1. offre partagée → « Gérée par la plateforme » ; offre pas `online` → « Hors ligne » ;
2. action en cours (`publish.pending`) → « Lancement… » ;
3. `queued` / `sent` / `images_ready` et pas `stale` → « Création du visuel… » (`queued`) ou « Publication en cours… » ;
   mêmes statuts mais `stale` (aucune activité depuis `STALE_MS` = 10 min, `social.ts`) → « Envoyée, sans confirmation » ;
4. `published` → « Publiée le … » ; `partial` → « En partie publiée le … » ; `failed` → « Échec », avec
   « Réessayer » (relance forcée) si Make est configuré ;
5. aucune diffusion : « Publier maintenant » si Make est configuré, sinon « Non diffusée ».

`docToPost` (`social.ts`) requalifie déjà certains statuts : `queued` depuis plus de `QUEUED_MAX_MS` = 6 min →
`failed` ; `images_ready` avec des résultats mais sans mise à jour depuis 3 min → `published`, `partial` ou `failed`
selon les résultats reçus. Tant qu'une diffusion est en cours, chaque ligne concernée appelle `router.refresh()` toutes
les 10 s, 30 fois au plus (5 min). « Republier sur les réseaux » (menu de la ligne) n'apparaît que pour une offre de
l'organisation, `online`, qui a déjà une diffusion (quel que soit son état) et aucune en cours, Make configuré. Côté
serveur : `publishJobToSocialAction` (tableau des actions).

### Pipeline d'une ligne et panneau d'aperçu

Phases = `getFunnelStages` triées par `order` ; nombre de candidatures dont le statut (résolu) est le `slug` de la
phase. La ligne n'affiche que les phases non vides (barre proportionnelle + légende) ; un statut sans phase
correspondante n'apparaît pas. Clic sur la ligne (hors liens, boutons, `select`, `label`, menu) : si
`window.matchMedia(PREVIEW_MEDIA)` (`(min-width: 112.5rem)`, 1800 px), l'offre passe dans le panneau d'aperçu ;
sinon navigation vers `/recruiter/pipeline/<id>/matching`. Le titre est toujours un lien vers le Matching IA.

`JobPreviewPanel` (lecture seule) : offre choisie, ou à défaut la première de la liste filtrée ; candidatures,
nouvelles, correspondances IA ; pipeline replié (phases non vides) ou déplié (« Toutes les phases (N) », barres
relatives à la phase la plus remplie) ; `TOP_PROFILES` = 3 candidatures au plus fort `aiScore` numérique, liées à
`/recruiter/candidates/<appId>` ; une phrase sur la dernière diffusion (`diffusionText`) ; liens « Ouvrir le
pipeline » et « Matching IA ».

### Fenêtre « Candidatures » (`JobApplicationsModal`, `CandidateCard`)

Ouverte par « N candidatures » de la ligne ou de l'aperçu, avec les données déjà chargées. Chiffres comptés sur des
`slug` fixes : « À traiter » = `pending` ou `screening`, « En entretien » = `interview`, « Retenus » = `accepted` ;
« Score IA moyen » sur les candidatures dont `aiScore !== undefined`. Chaque `CandidateCard` : libellé de statut pris
dans une table fixe (`STATUS`, « En attente » pour un `slug` inconnu), « Voir CV » (`/api/cv/<cvFileId>`), « Message »
(`mailto:`), « Entretien IA » (`/recruiter/interviews/new?appId=…&jobId=…`), résumé IA dépliable, et « Retenir » /
« Refuser » / « Vivier », qui affichent tout de suite le nouveau statut et appellent `setApplicationStatusAction` avec
`accepted` / `rejected` / `on_hold` sans attendre ni lire sa réponse.

### Création d'une offre (`CreateJobDialog` → `createJobAction`)

- Ouverture : bouton « Créer une offre », ou `?openCreateJob=1` (et `?tab=import` pour l'onglet import) lus à
  l'ouverture de la page. Un clic sur le fond ne ferme la fenêtre que dans l'onglet « Saisie manuelle ».
- Bibliothèque : `listMyJobsForLibrary` (lue au premier dépliage) renvoie `getJobsByTenant`, offres partagées
  comprises ; un choix recopie ses champs dans le formulaire.
- Assistant IA : si le titre ou la description sont remplis, le bouton appelle `improveJobDraft(prompt, champs
  actuels)` (« Améliorer l'offre ») ; sinon `generateJobDraft(prompt, dernier brouillon)` (« Générer l'annonce » ; le
  dernier brouillon, s'il existe, demande une variante). Les deux appellent `callLLM` sans module (modèle par défaut de
  Config IA, avec repli), prennent le premier objet `{…}` de la réponse et le passent à `toDraft` : titre tronqué à
  200 caractères, 10 compétences au plus, `contractType` et `remote` gardés seulement s'ils sont dans leurs valeurs
  permises, `salary` numérique ou `null` ; sans titre ou sans description, « Réponse IA incomplète ». Rien n'est
  publié par l'IA : le brouillon remplit le formulaire.
- Montant : libellé et texte d'aide selon le contrat (`PAY_FIELD_LABEL`, `payUnitFor`, `payHint` de
  [job-pay.ts](../../../lib/job-pay.ts)) : salaire annuel brut pour CDI / CDD, TJM sinon ; un montant invraisemblable
  (TJM > 3 000 €, salaire annuel < 10 000 €) est signalé, pas refusé.
- Champ caché `companyName` = prénom et nom du recruteur connecté (prop passée par `page.tsx`).
- Envoi : `createJobAction(formData)` (tableau des actions). En cas de succès, la fenêtre se ferme et le formulaire est
  vidé ; la liste suit par `revalidatePath`.

Étapes de `createJobAction` après les contrôles : `createJob` (`isActive: true`, `expiresAt = oneMonthFromNow()`,
`postedBy` et `recruiterId` = profil du créateur par `jobOwnership`) ; `after(() => tryAutoPublishJob(job,
deliveryDeadline(requestStart)))` (diffusion après la réponse, échéance = début de la requête + 270 s) ; puis
`await tryAutoSourceCandidates(job)` **dans la requête** : classement de la base candidats par l'IA
(`matchCandidatesForJob`), e-mail aux `bestMatches` (5 au plus, notés 65 ou plus, `SOURCING_TOP_N` /
`SOURCING_MIN_SCORE`), classement complet enregistré par `runPoolMatching` ; ses erreurs sont journalisées, jamais
renvoyées. La réponse (et donc le lancement de la diffusion) attend la fin du sourcing.

### Import d'un fichier (`ImportPanel`)

Côté navigateur : fichier de 5 Mo au plus (`MAX_FILE`) ou texte collé, modèle choisi parmi `teckia` / `claude` (par
défaut) / `gpt4o`, envoyé à `parseFileWithLLM` ([import/actions.ts](../import/actions.ts) : tableur aux colonnes
reconnues lu sans IA, autres formats par `callLLM` avec ce modèle). Offres présélectionnées : toutes pour un tableur,
sinon celles dont `confidence` n'est pas `low`. Jusqu'à `EDITABLE_MAX` = 30 offres, cartes modifiables (`JobCard`) ;
au-delà, tableau compact avec recherche et pages de 25. Import par lots de `CHUNK` = 20 offres, chaque lot essayé deux
fois s'il lève une exception (sinon toutes ses offres comptées en erreur « Connexion interrompue »), arrêt sur une
erreur renvoyée par le serveur ou après le lot en cours (« Arrêter »). Plus de `BULK_FROM` = 10 offres sélectionnées :
import « en masse » (`bulk: true`). Côté serveur, `importJobsChunk` refuse un lot de plus de 50 offres, en crée 5 à la
fois et, hors import en masse, lance pour chacune la diffusion (`after`) et le sourcing automatiques.

### Affectation d'un recruteur (`JobAssigneeSelect` → `assignJobAction`)

Le choix (« Non affectée » ou un recruteur de l'équipe ; « Recruteur hors de l’équipe » pour un profil affecté qui n'y
est plus) s'affiche tout de suite, revient à l'ancienne valeur en cas d'erreur, puis `router.refresh()`. Côté serveur :

1. identifiants validés par `ASSIGN_ID` (`/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/`, `recruiterId` vide permis) ;
2. `checkAssignee` : vide ou profil d'un recruteur de l'organisation ;
3. offre relue (`getJobById`) et de l'organisation, puis `setJobRecruiter` (qui revérifie l'organisation) ;
4. identifiant commençant par `ao` : l'AO d'origine (`ao<offre>`) reçoit le même recruteur (`setAoAssignee`) si
   `aoAccessFor(tenantId).offer(offerId)` le rattache à une boîte de l'organisation ; un échec ici devient un
   avertissement, l'affectation de l'offre est gardée ;
5. e-mail si `shouldNotifyAssignee(ancien, nouveau, user.$id)` (nouveau recruteur, différent de l'ancien et de celui
   qui affecte) : `notifyAssigneeWarning` (Appwrite Messaging, destinataire = compte Auth du recruteur, copie = cible
   e-mail du compte de celui qui affecte, lien `/recruiter/pipeline/<id>/matching`) ; un e-mail ou une copie non partis
   donnent un avertissement, jamais une annulation.

## Actions serveur

| Action | Fichier | Rôle | Contrôles (auth, rôle, organisation, validation) | Écritures et effets |
|---|---|---|---|---|
| `createJobAction` | `actions.ts` | « Publier l'offre » | session, `role === 'recruiter'`, `tenantId` ; titre, description, localisation non vides ; montant sans contrat refusé (`PAY_NEEDS_CONTRACT`) ; autres champs lus tels quels du `FormData` (pas de schéma) | `JOBS` créé ; en arrière-plan `tryAutoPublishJob` (si la publication automatique est activée et Make configuré : `SOCIAL_POSTS`, textes par l'IA, photo OpenAI, Make ; sinon ancien envoi LinkedIn direct) ; dans la requête `tryAutoSourceCandidates` (IA, e-mails aux candidats, `JOB_MATCHES`) ; `revalidatePath('/recruiter/dashboard')` |
| `listMyJobsForLibrary` | `actions.ts` | bibliothèque de la fenêtre | session, rôle, `tenantId` (sinon `[]`) | lecture seule (`getJobsByTenant`) |
| `toggleJobStatusAction` | `actions.ts` | « Archiver » / « Remettre en ligne » | `ownJobOrError` : session, rôle, `tenantId`, identifiant non vide, offre relue et `job.tenantId === user.tenantId` ; `isActive` booléen | `JOBS.isActive` seulement (pas `expiresAt`) ; revalidation |
| `deleteJobAction` | `actions.ts` | « Supprimer l'offre… » (après `confirm`) | `ownJobOrError` | document `JOBS` supprimé, rien d'autre ; revalidation |
| `assignJobAction` | `actions.ts` | recruteur affecté | session, rôle, `tenantId` ; `ASSIGN_ID` ; `checkAssignee` ; offre de l'organisation ; AO vérifié par `aoAccessFor` | `JOBS.recruiterId` ; `AO_OFFER_DETAILS.assigneeId` (document créé s'il manque) ; e-mail Appwrite Messaging ; revalidation du tableau de bord (et de `/recruiter/parametres/boites-ao/<offre>` si l'AO est mis à jour) |
| `setApplicationStatusAction` | `actions.ts` | « Retenir » / « Refuser » / « Vivier » | session et `role === 'recruiter'` seulement : ni l'organisation de la candidature ni la valeur du statut ne sont vérifiées | `APPLICATIONS.status` ; revalidation de `/recruiter/dashboard` et `/candidate/dashboard` |
| `publishJobToSocialAction` | `actions.ts` | « Publier maintenant », « Réessayer », « Republier » (`again` = relance forcée) | session, rôle, `tenantId` ; offre relue et de l'organisation ; refus si la dernière diffusion est en cours (`latestSocialStateByJob` : ni `stale`, ni `published` / `partial` / `failed`) ; `prepareSocialPost` refuse si Make n'est pas configuré, si aucun réseau n'est activé, pour une offre inactive, et si le verrou de l'offre est déjà pris | `SOCIAL_POSTS` « queued » (textes par l'IA de Config IA) puis `after(deliverSocialPost)` : photo OpenAI (quota `SCENE_DAILY_LIMITS`), envoi à Make ; déjà diffusée sans `again` → « Cette offre est déjà diffusée. » |
| `generateJobDraft` | `ai-job-draft-actions.ts` | « Générer l'annonce » | session et `role === 'recruiter'` ; consigne non vide ; aucun quota, ni organisation ni adresse vérifiée exigées | appel `callLLM` ; rien d'enregistré |
| `improveJobDraft` | `ai-job-draft-actions.ts` | « Améliorer l'offre » | idem, plus titre ou description non vides | appel `callLLM` ; rien d'enregistré |
| `parseFileWithLLM`, `importJobsChunk` | [import/actions.ts](../import/actions.ts) | onglet « Import IA / Excel » | session et `role === 'recruiter'` ; fichier de 5 Mo au plus ; lot de 50 au plus | `JOBS` créés avec `tenantId = user.tenantId ?? ''` ; diffusion et sourcing hors import en masse ; revalidation de `/recruiter/dashboard` (et `/jobs`) |
| `updateJob` | [admin/jobs/actions.ts](../../admin/jobs/actions.ts) | « Modifier » (`JobEditModal`) | `requireAdmin()` : refusé pour un recruteur (lève « Non autorisé ») | aucune pour un recruteur |

## Erreurs et cas limites

- **Lectures obligatoires** (offres, candidatures, `getFunnelStages`) : non interceptées. Il n'y a pas de
  `error.tsx` dans ce dossier, dans `src/app/recruiter` ni dans `src/app` : l'écran d'erreur par défaut de Next.js
  s'affiche.
- **Lectures facultatives** (journalisées avec le préfixe `[dashboard]`) :
  - équipe illisible : ni choix du recruteur affecté, ni filtre « Recruteurs » ; avec `recruteurs` dans l'adresse,
    bandeau « Le filtre « Recruteurs » n’a pas pu être appliqué (équipe illisible) ». `parseRecruiterSelection`
    reçoit alors une équipe vide : seul `aucun` peut être retenu, et dans ce cas la page ne lit que les offres non
    affectées ;
  - diffusions illisibles : bandeau dans « Mes offres » (« la colonne « Diffusion » est incomplète ») ; les lignes
    n'ont alors aucune diffusion et affichent l'état « aucune diffusion » (« Publier maintenant » ou « Non
    diffusée » ; « Pas encore diffusée » dans l'aperçu) ;
  - correspondances IA illisibles : badges absents ;
  - noms illisibles : les lots déjà lus sont gardés, les autres candidatures s'affichent par leur identifiant.
- `getJobById` renvoie `null` pour toute erreur Appwrite : les actions répondent alors « Offre introuvable. ».
- `createJobAction` renvoie le message brut de l'exception (`e.message`) ; les autres actions renvoient un message fixe
  et journalisent la cause (`[dashboard]`, `[social]`, `[affectation]`).
- **Offres partagées de la plateforme** (`tenantId ''`) : listées et comptées (« dont N de la plateforme »), sans
  « Modifier », archivage, suppression, affectation ni diffusion (« Gérée par la plateforme »). Leurs candidatures ne
  sont comptées que si elles portent le `tenantId` de l'organisation ; `applyToJob` (`src/app/(public)/jobs/actions.ts`)
  enregistre le `tenantId` de l'offre, donc `''` pour une candidature directe à une offre partagée.
- **Candidatures d'une offre supprimée** : `deleteJob` ne supprime que l'offre. Sans filtre, ses candidatures restent
  lues : elles comptent dans les indicateurs et dans `jobsWithNew`, pas dans les lignes ni dans le chiffre des tuiles.
- **« Remettre en ligne »** une offre dont `expiresAt` est passé : elle redevient active mais reste `expired`
  (onglet « Archivées », badge « Expirée ») et le passage quotidien de `/api/cron/deactivate-expired-jobs` la désactive
  de nouveau ; l'échéance n'est pas prolongée.
- **« Modifier »** : `JobEditModal` appelle `updateJob`, réservé à l'admin ; `save` n'intercepte pas l'exception levée
  pour un recruteur (AGENTS.md, « Reste à faire »).
- Offre affectée à un recruteur parti : « Recruteur hors de l’équipe » dans le choix ; elle n'apparaît que sans filtre
  « Recruteurs ».
- La relecture toutes les 10 s d'une diffusion en cours s'arrête après 5 min ; chaque `router.refresh()` relit toute la
  page.

## Tests

Règles pures seulement (aucun test des actions ni des composants de ce dossier) :

- [recruiter-dashboard.test.ts](../../../lib/recruiter-dashboard.test.ts) : états, échéance, faits, indicateurs.
- [recruiter-job-filters.test.ts](../../../lib/recruiter-job-filters.test.ts) : filtres, tri, tuiles, adresse, sélection de recruteurs.
- [url-list-state.test.ts](../../../lib/url-list-state.test.ts) : écritures de la liste et navigations.
- [appwrite/list-all.test.ts](../../../lib/appwrite/list-all.test.ts) : lecture complète par pages et par lots de 100.
- [assignment-email.test.ts](../../../lib/assignment-email.test.ts), [job-ownership.test.ts](../../../lib/job-ownership.test.ts),
  [job-pay.test.ts](../../../lib/job-pay.test.ts), [format-date.test.ts](../../../lib/format-date.test.ts),
  [sourcing-rules.test.ts](../../../lib/sourcing-rules.test.ts), [social-poster/rules.test.ts](../../../lib/social-poster/rules.test.ts).
- [recruiter-nav.test.ts](../../../lib/recruiter-nav.test.ts), [recruiter-trail.test.ts](../../../lib/recruiter-trail.test.ts) :
  rubrique « Tableau de bord » et retour avec les filtres.

Commandes : `npm test` (tous les `src/**/*.test.ts`, `node --import tsx --test`) ; un fichier :
`node --import tsx --test src/lib/recruiter-dashboard.test.ts`. Puis `npm run typecheck` et `npm run lint`.

## Modifier cette page

- **Largeurs du grand écran** : les classes `min-[90rem]:` (1440 px) et `min-[112.5rem]:` (1800 px) de tous les
  fichiers du dossier, `PREVIEW_MEDIA` (`dashboard-layout.ts`), `ROW_GRID` (`job-row.tsx`) et `DashboardSkeleton`
  (`page-skeletons.tsx`) changent ensemble. Écrites en rem pour que Tailwind les range après `sm:` / `lg:`
  (`dashboard-layout.ts`).
- **Un filtre de plus** : `JobFilters`, `EMPTY_JOB_FILTERS`, `filterJobs`, `isFiltering`, `jobFiltersFromSearchParams`
  et `withJobFilters` (dont sa liste de clés à effacer), avec leurs tests ; le contrôle existe deux fois dans
  `jobs-list-client.tsx` (rail et barre de filtres en dessous de 1440 px).
- **Une tuile de plus** : `JobFocus`, `FOCUSES`, `matchesFocus`, `FOCUS_CHIPS` et le tableau `tiles` (rendu dans le rail
  et dans la section « À traiter »).
- **Un type de contrat** : `JOB_CONTRACTS`, `LABELS` (`contract-filter.tsx`), `CONTRACT_LABELS` (`job-row.tsx`,
  `job-preview-panel.tsx`, `job-applications-modal.tsx`), `CONTRACT` (`import-panel.tsx`), `CONTRACT_TYPES`
  (`ai-job-draft-actions.ts`), `CONTRACTS` ([import/actions.ts](../import/actions.ts)), le `select` de
  `create-job-dialog.tsx` et `payUnitFor` (`job-pay.ts`). `jobs.contractType` est un texte libre (200 caractères) dans
  `appwrite.config.json` : la base n'impose aucune liste.
- **Une lecture de plus** : dans le `Promise.all` de `page.tsx`, lue en entier (`listAllDocuments`), avec un choix
  explicite en cas d'échec (bloquante, ou `catch` journalisé et état affiché). `getJobsByTenant` et
  `getApplicationsByTenant` servent aussi d'autres pages (AGENTS.md) : ne pas les changer pour ce seul écran.
- `keys` repose sur les statuts `pending` (donné par `createApplication`) et `accepted` : changer ces statuts change
  « nouvelle candidature » et le taux de sélection.
- `maxDuration = 300` doit rester tant que des actions de la page lancent des tâches `after()` : `deliveryDeadline`
  compte 270 s depuis le début de la requête.
- Nom de la page dans « Retour : … » : le libellé de la rubrique `dashboard` de `RECRUITER_SECTIONS`
  ([recruiter-nav.ts](../../../lib/recruiter-nav.ts)), pas `PAGE_LABELS` de [recruiter-trail.ts](../../../lib/recruiter-trail.ts) ;
  les sous-pages qui gardent l'onglet actif sont dans `also`.
- Un libellé, un bouton ou une règle visibles changés : mettre à jour `src/lib/assistant/knowledge.ts` (contenu de
  l'assistant IA) et la section « Tableau de bord du recruteur » d'AGENTS.md.
