# Mon vivier — `/recruiter/vivier` et `/recruiter/vivier/[jobId]`

Espace où un recruteur dépose ses propres CV (hors candidatures) : chaque CV devient un profil créé par l'IA, puis est
noté par le Matching IA. Deux sortes de vivier : le **vivier d'une offre** (`/recruiter/vivier/[jobId]`, CV importés
pour cette offre, notés pour elle seule) et le **vivier général** (onglet de `/recruiter/vivier`, CV importés sans
offre, comparés aux offres ouvertes de l'organisation). On y arrive par la rubrique « Mon vivier » du sous-menu ; les
CV du vivier ressortent ensuite dans le Matching IA de chaque offre (`/recruiter/pipeline/<offre>/matching`).
Un CV peut aussi arriver depuis MBC Search (« Ajouter au vivier », sans fichier).
Décisions : [0016](../../../../docs/adr/0016-format-esn-cv-du-vivier.md) (« CV format cabinet » d'un CV du vivier),
[0026](../../../../docs/adr/0026-correspondances-vivier-general-indexees.md) (`vivier_offer_matches`),
[0028](../../../../docs/adr/0028-notation-par-jugements.md) (notation par jugements).
Règles produit : [AGENTS.md](../../../../AGENTS.md), sections « Vivier général des recruteurs (matching automatique) »,
« Export des CV au format ESN » (point « CV du vivier ») et « MBC Search » (point « Suites d'un profil révélé »).

## Fichiers

```
page.tsx            /recruiter/vivier : lit offres, offres ouvertes, vivier général ; compteurs par offre ; onglets
[jobId]/page.tsx    /recruiter/vivier/<offre> : vérifie l'offre, lit le vivier de l'offre
vivier-tabs.tsx     onglets « Viviers par offre » / « Vivier général » (client), vue gardée dans ?vue=general
vivier-client.tsx   liste des CV d'un vivier (client, partagé par les deux routes) : import, filtres, cartes, suppression
unmatched-cvs.tsx   bouton et fenêtre « Sans offre correspondante » + boucle « Synchroniser » (vivier général)
actions.ts          Server Actions du vivier (lecture, import, ajout MBC Search, synchronisation, analyse, suppression,
                    versions « CV format cabinet ») ; type VivierCv et conversion docToVivierCv
```

Code partagé :

- [vivier-matching.ts](../../../lib/vivier-matching.ts) — règles pures du vivier général : seuil, lots, quotas,
  message de l'IA, lecture de sa réponse, scores enregistrés (`offerMatchesJson`). Tests :
  [vivier-matching.test.ts](../../../lib/vivier-matching.test.ts).
- [match-scoring.ts](../../../lib/match-scoring.ts) — barème commun à toutes les notations (jugements, preuves, score,
  plafonds) ; [title-check.ts](../../../lib/title-check.ts) — seconde question à l'IA sur les intitulés.
- [matching-core.ts](../../../lib/matching-core.ts) — appels à l'IA : `matchVivierCvAgainstJob` (vivier d'une offre),
  `scoreCvAgainstOffers` (vivier général) ; `getJobMatches` (lecture par le Matching IA d'une offre).
- [vivier-offer-matches.ts](../../../lib/vivier-offer-matches.ts) (règles pures, testées) et
  [appwrite/vivier-offer-matches.ts](../../../lib/appwrite/vivier-offer-matches.ts) (Appwrite) — copie indexée des
  correspondances (ADR 0026).
- [cv-profile-extract.ts](../../../lib/cv-profile-extract.ts) — `extractCvProfile` : profil structuré lu dans le CV par
  l'IA.
- [appwrite/jobs.ts](../../../lib/appwrite/jobs.ts) — `getJobsByTenant`, `getOpenJobsOfTenant`, `getJobById`.
- [ao/state.ts](../../../lib/ao/state.ts) — places de quota quotidiennes (`takeDailySlotId`, `releaseDailySlot`).
- [cv-export/](../../../lib/cv-export/) — « CV format cabinet » : `recruiterCvExportAccess` (`recruiter.ts`),
  `loadOwnVivierCv` / `exportVivierCv` (`export.ts`), `vivierExportKey` / `ownsVivierCv` (`stored.ts`),
  `deleteCvExportsForCandidate` / `loadCvExportVersions` (`store.ts`), route
  [api/recruiter/vivier/cv-export/[cvId]/route.ts](<../../api/recruiter/vivier/cv-export/[cvId]/route.ts>).
- [api/vivier-cv/[fileId]/route.ts](<../../api/vivier-cv/[fileId]/route.ts>) — sert le fichier d'un CV du vivier.
- [cvtheque/candidate-profile-modal.tsx](../cvtheque/candidate-profile-modal.tsx) — fenêtre « Profil complet »
  (mode `vivier`) ; [cvtheque/actions.ts](../cvtheque/actions.ts) — actions du bouton « Modèle CV »
  (voir [le README de la CV Thèque](../cvtheque/README.md)).
- [appwrite/browser-client.ts](../../../lib/appwrite/browser-client.ts) — `getBrowserStorage` (envoi du fichier par le
  navigateur).
- [scripts/vivier-offer-matches.mts](../../../../scripts/vivier-offer-matches.mts) — `npm run vivier:matches`.

## Données

Collection `vivier_cvs` (aucune permission client, voir `appwrite.config.json`) — un document par CV :

| Attribut | Contenu |
|---|---|
| `tenantId`, `recruiterId` | organisation et **profil** (`users.$id`) du recruteur qui a importé le CV |
| `jobId` | offre du vivier ; **`null` = vivier général** (`Query.isNull('jobId')`) |
| `cvFileId`, `fileName` | fichier dans le bucket `vivier_cvs` ; `cvFileId` vide pour un profil de MBC Search |
| `candidateName`, `candidateEmail`, `candidatePhone` | lus par l'IA sur le CV (ou saisis par MBC Search) |
| `cvProfileJson` | profil `CvProfile` (JSON) créé par `extractCvProfile` |
| `matchScore`, `matchReason` | note pour l'offre du vivier ; **toujours vides au vivier général** |
| `offerMatchesJson` | vivier général : scores pour les offres déjà comparées (JSON, source des correspondances) |
| `apolloId` | personne Apollo (profil venu de MBC Search) |

Collection `vivier_offer_matches` (ADR 0026) : une ligne par CV du vivier général et par offre notée 65 ou plus
(`tenantId`, `jobId`, `vivierCvId`, `score`, `reason`), copie de `offerMatchesJson`, lue par le Matching IA d'une offre.

Bucket `vivier_cvs` : permission `create("any")` (le navigateur y envoie le fichier sans session Appwrite, donc sans
propriétaire), 10 Mo, extensions `pdf`, `doc`, `docx`, chiffré.

`docToVivierCv` (`actions.ts`) convertit un document en `VivierCv` :

- `candidateName` : l'attribut, sinon le nom du profil, sinon le nom du fichier sans extension (`nameFromFile` :
  `CV_Jean_Dupont.pdf` → `CV Jean Dupont`) ;
- `title` : intitulé de la première expérience du profil (la plus récente) ;
- `offerScores` : `parseOfferScores(offerMatchesJson)` ;
- **`profileReady`** = le profil a un nom, au moins une compétence ou un résumé. `false` : le profil n'a pas pu être créé
  (fichier illisible, IA indisponible) ; la carte affiche « Analyser à nouveau » et rien n'est noté.
- `cvProfileJson` illisible : traité comme absent.

## Accès et périmètre des données

- `src/middleware.ts` renvoie vers `/login` sans cookie `mbc-session`, et vers le tableau de bord du rôle si le cookie
  `mbc-role` n'est pas `recruiter`. Le layout `src/app/recruiter/layout.tsx` redirige vers `/login` tout compte dont le
  rôle n'est pas `recruiter`.
- Les deux pages exigent ensuite `role` `recruiter` ou `admin` **et** un `tenantId` (sinon `redirect('/login')`).
  À vérifier : les branches `admin` des pages (tous les CV de l'organisation, badge « Importé par un autre recruteur »)
  ne sont pas atteignables par l'affichage, le layout ne laissant passer que `recruiter` ; elles ne servent qu'aux
  Server Actions appelées directement. Est-ce voulu (AGENTS.md décrit la vue admin) ?
- `/recruiter/vivier/[jobId]` : `getJobById(jobId)` ; offre absente ou d'une autre organisation (`job.tenantId !==
  user.tenantId`) → `notFound()`.
- Chaque Server Action vérifie l'appelant elle-même :
  - `requireVivierAccess(jobId)` : recruteur ou admin rattaché à une organisation, sinon `Refusal('Non autorisé')` ;
    pour un vivier d'offre, l'offre doit être de l'organisation, sinon `Refusal('Offre introuvable')`.
  - `ownVivierDoc(user, tenantId, jobId, docId)` : le CV doit être de l'organisation, du **même vivier** (même `jobId`,
    ou `null` des deux côtés) et importé par l'appelant (un admin : n'importe quel recruteur de l'organisation) ;
    sinon `Refusal('CV introuvable')`, comme pour un CV qui n'existe pas.
- **Un vivier est personnel** : les lectures filtrent sur `recruiterId = user.$id` (sauf admin) — `getVivierForJob`
  (`jobId`, 200 CV les plus récents), `getGeneralVivier` (`tenantId` + `jobId` nul, 500 plus récents, `total` = tous),
  compteurs de la liste des offres.
- Toutes les lectures et écritures passent par `createAdminClient()` (clé API serveur) ; seul l'**envoi du fichier**
  se fait depuis le navigateur (`getBrowserStorage().createFile`, sans session).
- Fichier du CV : `GET /api/vivier-cv/<cvFileId>` exige un recruteur ou un admin, puis un document `vivier_cvs` de ce
  fichier dans son organisation (et à son nom, sauf admin), sinon 404 ; type de réponse lu dans les octets
  (`cvFileHeaders`).
- « CV format cabinet » : route `/api/recruiter/vivier/cv-export/[cvId]` et action `getVivierCvExportVersions`, rôle
  `recruiter` seulement, puis `loadOwnVivierCv` (même organisation et même `recruiterId`, `ownsVivierCv`) — ADR 0016.
- Fiche d'un CV ouverte depuis le Matching IA : [candidate-preview](../candidate-preview/README.md), mêmes règles.

## Chargement de la page

### `/recruiter/vivier`

1. Lit `searchParams.vue`, puis l'utilisateur (`getCurrentUser`) et le contrôle d'accès ci-dessus.
2. En parallèle (`Promise.all`) :
   - `getJobsByTenant(tenantId)` : **toutes** les offres de l'organisation **et** les offres partagées de la plateforme
     (`tenantId ''`), actives ou non, lues page par page ;
   - `getOpenJobsOfTenant(tenantId)` : offres de l'organisation seule, `isActive`, les 100 plus récentes, puis celles
     dont `expiresAt` est passée retirées ;
   - `getGeneralVivier()` ;
   - `recruiterCvExportAccess(user)` : modèle CV de l'organisation et raisons d'un refus (`null` si la fonction est
     coupée ou si le compte n'est pas un recruteur).
3. Compteurs « N profils » par offre : `vivier_cvs` de l'organisation avec `jobId` non nul, `Query.select(['jobId'])`,
   1 000 documents au plus, filtrés sur le recruteur (sauf admin). Une erreur est ignorée : la liste s'affiche sans
   compteurs.
4. Rendu : en-tête avec `CvTemplateManager` (si `cvExport.access`), puis `VivierTabs` avec la vue initiale
   (`?vue=general` → vivier général, sinon offres) et les nombres des onglets (`general.total`, `jobs.length`). La vue
   « Vivier général » est un `VivierClient` avec `jobId={null}` et `openOffers` (identifiant et intitulé des offres
   ouvertes) ; si `total` dépasse les 500 CV lus, une ligne le dit. La vue « Viviers par offre » liste chaque offre de
   `getJobsByTenant` avec un lien vers `/recruiter/vivier/<id>`.
5. `maxDuration = 300` : import (analyse puis comparaison par lots) et dépôt du modèle CV (cartographie par l'IA)
   tournent dans les Server Actions de cette page.
6. Pas de `loading.tsx` propre : celui de `src/app/recruiter/loading.tsx` (`SectionPageSkeleton`, contenu « liste »).

### `/recruiter/vivier/[jobId]`

1. Contrôle d'accès, puis `getJobById(jobId)` (toute erreur de lecture donne `null`, donc `notFound()`).
2. En parallèle : `getVivierForJob(jobId)` et `recruiterCvExportAccess(user)`.
3. Rendu : `BackLink` (repli : `/recruiter/vivier`), lien « Voir le Matching IA » vers
   `/recruiter/pipeline/<offre>/matching`, puis `VivierClient` avec `jobId`. La zone d'import est en haut de la liste.
4. Pas de `maxDuration` exporté par cette page, pas de `loading.tsx` propre. À vérifier : durée maximale accordée aux
   imports lancés depuis cette page (analyse et notation par l'IA).

Erreurs de lecture : `getVivierForJob` et `getGeneralVivier` renvoient `{ cvs: [], error }` ; `VivierClient` affiche
`loadError` en bandeau rouge. `recruiterCvExportAccess` en échec : bandeau orange (`cvExportError`), page utilisable.
Les autres lectures (`getJobsByTenant`, `getOpenJobsOfTenant`, `getJobById` hors 404) ne sont pas rattrapées : erreur
de rendu de Next.

## Logique et algorithmes

### Import d'un fichier

Navigateur (`VivierClient.handleFiles` / `importOne`) :

1. Fichiers choisis ou déposés (`accept=".pdf,.doc,.docx"`), traités **3 à la fois** (`CONCURRENCY`).
2. Plus de 10 Mo (`MAX_SIZE`) : refusé sur place.
3. `getBrowserStorage().createFile(BUCKETS.VIVIER_CVS, ID.unique(), file, …)` avec progression, puis
   `attachVivierCv(jobId, fileId, fileName)`.
4. Réponse : le CV est ajouté en tête de la liste locale ; `notice` (vivier général) s'affiche en bandeau orange.

Serveur (`attachVivierCv`) :

1. Validation zod `attachInput` : `jobId` (1 à 36 caractères, ou `null`), `fileId` (`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$`),
   `fileName` (1 à 255).
2. `requireVivierAccess(jobId)`.
3. `assertFreshUpload(fileId)` : le fichier existe dans le bucket, **aucun** `vivier_cvs` ne le référence (index
   `cvFileId_idx`), et il a été créé il y a 15 minutes au plus (`UPLOAD_MAX_AGE_MS`). Raison (commentaire du code) :
   le fichier n'a pas de propriétaire ; sans ce contrôle, l'identifiant de fichier du CV d'un autre suffirait à en
   obtenir le profil puis à supprimer le fichier.
4. Création du document (`tenantId`, `recruiterId = user.$id`, `jobId`, `cvFileId`, `fileName`).
5. `buildProfile` : `extractCvProfile(fileId, BUCKETS.VIVIER_CVS)` puis écriture de `cvProfileJson`, `candidateName`,
   `candidateEmail`, `candidatePhone`. Toute erreur donne `null` : le CV reste importé, sans profil.
6. Profil créé : `matchProfile` (ci-dessous). Puis `revalidateVivier(jobId)`, relecture du document et réponse.

`extractCvProfile` ([cv-profile-extract.ts](../../../lib/cv-profile-extract.ts)) : texte lu par `pdf-parse` (PDF,
reconnu à `%P`), `mammoth` (DOCX, reconnu à `PK`), sinon les octets lus comme du texte ; 8 000 caractères au plus ;
moins de 30 caractères → `null`. Appel `callLLM` sans module (modèle par défaut de Config IA, repli habituel), réponse
JSON bornée : 20 compétences, 25 expériences de 6 missions, 10 formations, 10 langues, nom / e-mail / téléphone tels
qu'écrits sur le CV.

### Matching IA du vivier d'une offre

`matchProfile` avec `jobId` appelle `matchVivierCvAgainstJob(jobId, docId, profile)`
([matching-core.ts](../../../lib/matching-core.ts)) :

1. Relit l'offre ; critères `offerCriteria(skills, description)` : compétences demandées (`requiredSkills`, 12 au plus,
   sans doublon) et exigences tirées des puces du profil recherché puis des missions (`offerRequirements`, 10 au plus).
2. Message : poste, critères numérotés, description `offerTextForAi(description, 4000)` (profil recherché d'abord),
   profil `profileForAi(profile)`.
3. `callLLM(…, { module: 'matching', maxTokens: 8000 })` ; réponse = un objet JSON de jugements (`MATCH_RULES`).
4. `parseJudgements` vérifie les preuves dans le texte envoyé, `withCheckedTitles` compare les intitulés (un appel de
   plus), `judgedScore` calcule le score (voir « Notation »).
5. Écrit `matchScore` et `matchReason` (`judgementSummary` + raison de l'IA, 500 caractères) sur le CV.

Aucune exception ne remonte : réponse illisible ou sans jugement, ou erreur → journalisée, CV laissé sans score. Aucun
quota ni contrôle de l'adresse e-mail sur ce chemin (seul le vivier général en a).

### Matching IA du vivier général : `compareWithNewOffers`

Appelée par `matchProfile` (import, « Analyser à nouveau », ajout MBC Search) et par `syncVivierCvMatching`
(« Synchroniser »). Toute exception est rattrapée par l'appelant, journalisée et rendue comme
`VIVIER_MATCHING_REFUSAL.failed`.

```
offers, doc ← getOpenJobsOfTenant(tenantId), vivier_cvs[docId]            (en parallèle)
toCompare  ← offersToCompare(scores enregistrés, offers)                   offres ouvertes jamais comparées, 100 au plus
si toCompare vide → null                                                   ni quota ni IA
assertVivierOfferMatchesReady()                                            collection lisible, avant quota et IA
refus ← matchingSlot(user, tenantId) ; si refus → refus
{ scores, failed } ← scoreCvAgainstOffers(profile, toCompare)
latest ← vivier_cvs[docId]                                                 relu juste avant l'écriture
merged ← mergeOfferScores(scores de latest, scores, ids des offres ouvertes)
stored ← serializeOfferScores(merged)
syncVivierOfferMatches(tenantId, docId, parseOfferScores(stored))          lignes AVANT les scores (ADR 0026)
vivier_cvs[docId].offerMatchesJson ← stored
si failed : partial si le CV correspond déjà à une offre ouverte, sinon failed ; sinon null
```

`scoreCvAgainstOffers` découpe les offres en lots de 5 (`OFFERS_PER_CALL`, `offerBatches`) et les envoie **tous en
même temps** (`Promise.all`, sans limite de concurrence) : `callLLM(…, { module: 'matching', moduleDefault: 'claude',
maxTokens: 8000, timeoutMs: 120_000 })` — modèle du « Matching IA » de Config IA, Claude s'il n'y en a pas. Chaque lot :
`parseVivierMatching`, puis une comparaison des intitulés pour tout le lot (`withCheckedTitles`), puis `vivierScore`.
Un lot en erreur ou à réponse illisible donne `null` : ses offres restent « nouvelles » (comparées à la prochaine
synchronisation) et `failed` vaut `true`.

Message (`vivierMatchingPrompt`, `VIVIER_MATCHING_SYSTEM`) :

- Candidat (`profileForAi`) : 8 expériences au plus (intitulé, employeur, période, 5 missions), 40 compétences,
  résumé (1 500 caractères), années d'expérience, 8 langues ; **ni nom ni coordonnées**, chaque champ borné (test
  « borne la taille du message »).
- Offres **numérotées 1 à 5** (« --- Offre 1 --- »), jamais par leur identifiant (un identifiant mal recopié rattachait
  une note à une autre offre, ADR 0028) : poste, lieu, critères, description `offerTextForAi(description, 1500)`.

Lecture (`parseVivierMatching`) : premier tableau JSON de la réponse ; chaque élément est rattaché à l'offre de son
numéro `offre` (nombre ou texte numérique) ; numéro hors du lot ou répété ignoré ; élément sans jugement lisible
ignoré (l'offre reste à comparer : un score absent n'est pas un 0). Réponse sans tableau → `null`.

### Notation (commune, ADR 0028)

Moteur commun expliqué en entier, vivier général compris (lots, fusion, ordre d'écriture) :
[docs/matching-et-notation-ia.md](../../../../docs/matching-et-notation-ia.md).

Le score n'est jamais donné par l'IA. Elle répond par jugements, que le code vérifie puis convertit
([match-scoring.ts](../../../lib/match-scoring.ts)) :

- `poste` : un élément par métier du titre (4 au plus) avec l'intitulé d'un poste du CV ; sans intitulé → « non » ;
  intitulé absent du texte envoyé → un niveau de moins. Puis `withCheckedTitles` : même métier → gardé ; même famille ou
  comparaison impossible → « partiel » au plus ; autre métier → « non ».
- `exigences` et `competences` : un jugement par élément des listes numérotées ; un « oui » exige une citation d'au
  moins 5 mots retrouvée dans le CV, qui n'est pas une liste de mots-clés (et, pour une compétence, qui la nomme) ;
  sinon « partiel ». Élément oublié → « non ».
- `domaine` (oui / partiel / non / non requis), `niveau` (oui / partiel / non / non précisé).
- `judgedScore` : `SCORE_WEIGHTS` = poste 30, exigences 30, compétences 20, domaine 15, niveau 5 ; points `POINTS` :
  oui 1, partiel 0,5, non 0, « non requis » et « non précisé » 1 ; moyenne par critère, total arrondi, puis plafond
  `capFor` = le plus bas de `ROLE_CAP` (poste non exercé 50, voisin 75 — par métier, sans compensation) et
  `DOMAIN_CAP` (domaine absent 60, voisin 80).
- Raison enregistrée : `judgementSummary` (« Poste : … · Exigences : … · Compétences : … · Domaine : … · Niveau : … »)
  puis « — » et la phrase de l'IA ; 300 caractères (`REASON_MAX`) au vivier général.

Un CV **correspond** à une offre notée `VIVIER_MATCH_MIN_SCORE` = 65 ou plus (`SOURCING_MIN_SCORE`,
[sourcing-rules.ts](../../../lib/sourcing-rules.ts)).

### Scores enregistrés : `offerMatchesJson`

Règles pures de [vivier-matching.ts](../../../lib/vivier-matching.ts) :

- `parseOfferScores` : JSON validé par zod (`jobId`, `score` entier 0–100, `reason` ≤ 300) ; absent ou illisible →
  `[]` (le CV est traité comme jamais comparé, la prochaine synchronisation répare).
- `mergeOfferScores(previous, fresh, openIds)` : le nouveau score d'une offre remplace l'ancien ; les offres qui ne
  sont plus ouvertes sont retirées.
- `serializeOfferScores` : meilleurs scores d'abord ; la raison n'est gardée que pour les 10 meilleurs (`REASONS_KEPT`)
  notés 65 ou plus, pour tenir dans l'attribut de 20 000 caractères.
- `matchingOffers(scores, openIds)` : offres ouvertes notées 65 ou plus, la mieux notée d'abord (« Correspond à »).
- `newOffersFor(scores, openOffers)` : offres ouvertes jamais comparées ; `offersToCompare` en garde 100
  (`MAX_OFFERS_PER_RUN`).

Concurrence : le document est relu juste avant l'écriture ; deux comparaisons simultanées du même CV peuvent encore
s'effacer pendant quelques millisecondes (les offres perdues redeviennent « nouvelles », AGENTS.md).

### Copie indexée : `vivier_offer_matches` (ADR 0026)

- `wantedRows` : une ligne par score ≥ 65 ; identifiant `matchRowId` = `m` + 32 caractères du SHA-256 de
  `<cv>:<offre>` (le même pour un couple, deux écritures simultanées ne font qu'une ligne ; 36 caractères au plus) ;
  raison coupée à 300 caractères entiers, moitié d'emoji retirée (Appwrite refuserait le champ).
- `rowChanges` : lignes à écrire (absentes ou différentes, organisation comprise) et à supprimer (offre retirée ou
  passée sous 65).
- `syncVivierOfferMatches` : lit les lignes du CV, crée ou met à jour (un 409 à la création devient une mise à jour),
  supprime (un 404 est ignoré). Appelée **avant** l'écriture de `offerMatchesJson` : si elle échoue, les scores ne sont
  pas enregistrés et la comparaison sera refaite (IA et quota consommés deux fois, ADR 0026).
- `deleteVivierOfferMatchesOf` : appelée **après** la suppression du CV.
- Lecture : `listVivierOfferMatches(jobId, tenantId)` dans `getJobMatches`, qui relit les CV et ne garde que ceux du
  recruteur connecté, du vivier général, encore présents.
- Reconstruction : `npm run vivier:matches -- <env> [--apply] [--prod]` (simulation sans `--apply`).

### Quotas de la comparaison : `matchingSlot`

Avant chaque comparaison d'un CV (une place quel que soit le nombre d'offres) :

1. Adresse e-mail non vérifiée → `VIVIER_MATCHING_REFUSAL.unverified`.
2. `takeDailySlotId('vivierMatchOrg', tenantId, now, 200)` → sinon `organisation`.
3. `takeDailySlotId('vivierMatchAll', 'platform', now, 2000)` → sinon la place de l'organisation est rendue
   (`releaseDailySlot`) et `platform` (avertissement dans les journaux).

Limites : `VIVIER_MATCHING_DAILY_LIMITS` (journée UTC, documents de `AO_STATE`). Une comparaison qui échoue après la prise
des places les garde (l'IA a pu être facturée). Un refus n'empêche pas l'import : le message s'affiche et le CV apparaît
dans « Sans offre correspondante ».

### « Sans offre correspondante » et « Synchroniser » (`unmatched-cvs.tsx`)

- Liste (calculée dans le navigateur, sur les CV chargés) : CV `profileReady` sans aucune offre ouverte notée 65 ou
  plus. Pour chacun, le nombre d'offres ouvertes jamais comparées (`newOffersFor`) ; seuls ceux qui en ont sont
  synchronisés.
- La boucle appelle `syncVivierCvMatching(cv.$id)` **un CV après l'autre** et remplace la carte par le CV relu
  (`onUpdated`). Elle s'arrête : sur « Arrêter » (après le CV en cours, `stopRef`), au premier `error` renvoyé (refus de
  quota, adresse non vérifiée, IA indisponible : les suivants échoueraient de même), ou sur une exception de l'appel
  (réseau, redéploiement). Compte rendu : nombre de CV qui correspondent désormais à une offre.
- La boucle vit dans le composant, monté tant que le vivier général a des CV : elle continue fenêtre fermée (le bouton
  montre « Synchronisation n/N ») et dans l'autre onglet de `VivierTabs` (vues masquées par `hidden`, pas démontées).
- Les nouvelles offres ne sont **pas** comparées automatiquement aux CV existants, ni aux CV qui correspondent déjà à
  une offre (AGENTS.md, demande du 2026-10-28).

`syncVivierCvMatching(docId)` : `requireVivierAccess(null)`, `ownVivierDoc(…, null, docId)`, refus si le profil n'est
pas créé, puis `compareWithNewOffers` ; renvoie le CV relu même en cas de refus (une partie des offres a pu être
comparée).

### Liste dans le navigateur (`vivier-client.tsx`)

- Score affiché (`displayedMatch`) : vivier d'une offre → `matchScore` / `matchReason` ; vivier général → score de
  l'offre choisie dans le filtre, sinon de la meilleure offre correspondante.
- Recherche : sous-chaîne sans casse dans nom, intitulé, e-mail, compétences, résumé.
- Filtre par offre (vivier général) : CV notés 65 ou plus pour cette offre ; le menu montre ce nombre par offre.
- Tri : « Plus récents » (ordre du serveur) ou « Meilleur matching » ; un filtre par offre trie toujours par score
  (sans score = -1).
- Carte du vivier général : « Correspond à » (3 offres au plus, puis « +N ») ouvre `/jobs/<offre>` dans un nouvel onglet
  sans ouvrir la fiche (l'import et la synchronisation tournent dans cette page) ; sinon « Pas encore comparé à N
  offres » ou « Aucune offre ouverte ne correspond ».
- Boutons : « Profil complet » (`CandidateProfileModal` en mode `vivier`, profil créé), « Analyser à nouveau » (profil
  non créé), « Voir le CV » (`/api/vivier-cv/<fichier>`, si fichier), « CV format cabinet » (modèle de l'organisation,
  fichier et profil créé — le nom sert au contrôle d'anonymisation, ADR 0016), e-mail, téléphone, « Supprimer »
  (confirmation `window.confirm`).
- Vivier général : l'import est dans une fenêtre (« Importer des CV ») qui peut être fermée pendant l'import.

### Suppression d'un CV : `deleteVivierCv(jobId, docId)`

Ordre imposé (données personnelles, ADR 0016 et 0026) :

1. `requireVivierAccess`, `ownVivierDoc`.
2. Versions « CV format cabinet » (`deleteCvExportsForCandidate(vivierExportKey(docId))`, si le stockage des exports est
   configuré). Échec → `Refusal`, **le CV est gardé**.
3. Fichier du bucket supprimé seulement si un seul `vivier_cvs` le référence (un fichier rattaché à deux CV reste pour
   l'autre ; profil MBC Search : pas de fichier). Un échec de suppression du fichier est ignoré.
4. Document `vivier_cvs` supprimé.
5. Vivier général : lignes `vivier_offer_matches` du CV supprimées ; échec journalisé (lignes écartées à la lecture,
   purgées par `npm run vivier:matches`).
6. Second passage sur les versions « CV format cabinet » (une génération a pu écrire pendant la suppression) ; échec
   journalisé, à supprimer à la main.

### Ajout depuis MBC Search : `addMbcProfileToVivier(input)`

- Validation zod `mbcProfileInput` : `jobId` (ou `null`), `apolloId` (`APOLLO_PERSON_ID`), nom (1–200), lien LinkedIn
  `https://` ou vide, e-mail simple (`PLAIN_EMAIL`) ou vide, 8 expériences au plus.
- Doublon refusé dans **le même vivier du même recruteur** : même e-mail, ou même nom si l'e-mail est vide.
- Crée un `vivier_cvs` sans fichier (`cvFileId` vide, `fileName` « Profil MBC Search (sans CV) »), avec un `CvProfile`
  construit à partir du parcours (résumé = accroche, lieu, lien LinkedIn et « Profil trouvé avec MBC Search (sans CV). »,
  1 000 caractères ; une expérience « aujourd'hui » tirée de l'intitulé et de l'entreprise s'il n'y a pas de parcours),
  puis `matchProfile` comme un import. Appelée par `src/app/recruiter/mbc-search/mbc-profile-panel.tsx`.

### Onglets (`vivier-tabs.tsx`)

« Viviers par offre » d'abord (vue par défaut, demande du 2026-10-28), « Vivier général » ensuite. Un clic écrit la vue
dans l'adresse par `history.replaceState` (`?vue=general`, paramètre retiré pour les offres) ; flèches gauche / droite
entre les onglets (motif ARIA). Les deux vues restent montées (`hidden`) : un import ou une synchronisation continue
d'une vue à l'autre.

## Actions serveur

Toutes dans `actions.ts` (`'use server'`), client Appwrite `createAdminClient()`.

| Action | Rôle | Contrôles | Écritures et effets |
|---|---|---|---|
| `getVivierForJob(jobId)` | CV du vivier d'une offre | `requireVivierAccess(jobId)` ; filtre `recruiterId` sauf admin | lecture, 200 CV |
| `getGeneralVivier()` | CV du vivier général | `requireVivierAccess(null)` ; filtre `recruiterId` sauf admin | lecture, 500 CV + `total` |
| `attachVivierCv(jobId, fileId, fileName)` | import d'un fichier déjà envoyé au bucket | zod `attachInput`, `requireVivierAccess`, `assertFreshUpload` ; comparaison : adresse vérifiée et quotas (vivier général) | crée et met à jour `vivier_cvs` ; IA : profil, notation (+ intitulés) ; `vivier_offer_matches` ; places `AO_STATE` ; `revalidatePath` du vivier de l'offre |
| `addMbcProfileToVivier(input)` | profil révélé de MBC Search → CV sans fichier | zod `mbcProfileInput`, `requireVivierAccess`, doublon | crée `vivier_cvs` ; notation comme un import |
| `syncVivierCvMatching(docId)` | « Synchroniser » un CV du vivier général | `requireVivierAccess(null)`, `ownVivierDoc`, profil créé ; adresse vérifiée et quotas | `compareWithNewOffers` : IA, `vivier_offer_matches`, `offerMatchesJson`, places `AO_STATE` |
| `reanalyseVivierCv(jobId, docId)` | « Analyser à nouveau » | `requireVivierAccess`, `ownVivierDoc` ; refusé si le profil est déjà créé | IA : profil puis notation, comme un import |
| `deleteVivierCv(jobId, docId)` | « Supprimer » | `requireVivierAccess`, `ownVivierDoc` | supprime versions `cv_exports` (deux passages), fichier (s'il n'est pas partagé), `vivier_cvs`, `vivier_offer_matches` |
| `getVivierCvExportVersions(cvId)` | versions « CV format cabinet » pour la fenêtre d'export | rôle `recruiter` + `tenantId`, `vivierExportKey`, `loadOwnVivierCv` | lecture `cv_exports`, date du modèle |

Le bouton « Modèle CV » de l'en-tête utilise `saveRecruiterCvTemplate` / `deleteRecruiterCvTemplate` de
[cvtheque/actions.ts](../cvtheque/actions.ts) ; après un dépôt, `/recruiter/cvtheque` et tout `/recruiter/vivier` sont
relus. Génération et téléchargement d'un export : route `/api/recruiter/vivier/cv-export/[cvId]` (POST / GET, ADR 0016).

Revalidation : seul le vivier d'une offre est relu après une action (`revalidateVivier`) ; le vivier général tient sa
liste dans l'état du client (relire 500 CV à chaque import serait du travail perdu, commentaire du code).

Messages d'erreur : les actions renvoient `{ error }`, jamais d'exception. `addMbcProfileToVivier` et
`syncVivierCvMatching` ne montrent tel quel que le message d'un `Refusal` (les autres erreurs sont journalisées et
remplacées par un message générique) ; les autres renvoient `e.message` de toute erreur.

## Erreurs et cas limites

- Profil non créé (fichier illisible, scanné, IA indisponible) : CV gardé, `profileReady` faux, aucune notation ; la
  synchronisation le refuse (« relancez son analyse depuis sa fiche »).
- Fichier envoyé puis non rattaché (onglet fermé, échec de `attachVivierCv`) : reste dans le bucket, aucun code ne le
  supprime ; après 15 minutes il ne peut plus être rattaché.
- Offre supprimée (`deleteJobAction` → `deleteJob`) ou recruteur retiré de l'équipe / compte supprimé : aucun de ces
  chemins ne supprime les `vivier_cvs` concernés (ni leurs fichiers, versions ou lignes). À vérifier : conservation
  voulue de ces CV (données personnelles) ?
- Deux `attachVivierCv` simultanés avec le même fichier peuvent passer `assertFreshUpload` tous les deux ;
  `deleteVivierCv` garde alors le fichier pour l'autre CV.
- Collection `vivier_offer_matches` ou variable `APPWRITE_COLLECTION_VIVIER_OFFER_MATCHES` absente : la comparaison
  échoue avant le quota et l'IA (`assertVivierOfferMatchesReady`) ; la suppression d'un CV du vivier général journalise
  l'échec de la suppression des lignes.
- Aucune offre ouverte : le vivier général l'annonce ; les CV seront comparés depuis « Sans offre correspondante » une
  fois des offres publiées.
- Plus de 500 CV au vivier général : seuls les 500 plus récents sont affichés, filtrés, comptés dans « Sans offre
  correspondante » et synchronisables ; la ligne « Les 500 CV les plus récents sont affichés, sur N » le dit.
- Plus de 200 CV dans le vivier d'une offre, ou plus de 1 000 CV dans l'ensemble des viviers d'offres (compteurs) : le
  surplus n'est pas lu, sans avertissement.
- `getOpenJobsOfTenant` lit les 100 offres actives les plus récentes puis retire les expirées : avec des offres actives
  expirées parmi elles, moins de 100 offres ouvertes sont comparées.
- À vérifier : la liste « Viviers par offre » vient de `getJobsByTenant`, qui inclut les offres partagées de la
  plateforme (`tenantId ''`) ; leur page `/recruiter/vivier/<id>` répond `notFound()` (`job.tenantId !== user.tenantId`)
  et `requireVivierAccess` les refuse. Faut-il les retirer de la liste, ou ouvrir leur vivier ?
- Une offre fermée depuis la dernière comparaison garde sa ligne dans `vivier_offer_matches` jusqu'à la comparaison
  suivante du CV (ADR 0026, « Conséquences »).

## Tests

- [vivier-matching.test.ts](../../../lib/vivier-matching.test.ts) — seuil 65, offres à comparer et limite d'un passage,
  fusion des scores, lots, JSON enregistré (raisons gardées, taille), lecture de la réponse de l'IA par numéro,
  plafonds, taille bornée du message, ni nom ni coordonnées envoyés.
- [vivier-offer-matches.test.ts](../../../lib/vivier-offer-matches.test.ts) — identifiant des lignes, lignes voulues,
  raison coupée sans moitié d'emoji, lignes à écrire et à supprimer.
- [match-scoring.test.ts](../../../lib/match-scoring.test.ts) — jugements, preuves, comparaison des intitulés, barème.
- [cv-export/stored.test.ts](../../../lib/cv-export/stored.test.ts) — `vivierExportKey`, `ownsVivierCv`.
- [ai/models.test.ts](../../../lib/ai/models.test.ts) — modèle de l'appelant (Claude pour le vivier général).
- [recruiter-trail.test.ts](../../../lib/recruiter-trail.test.ts), [recruiter-nav.test.ts](../../../lib/recruiter-nav.test.ts)
  — noms « Mon vivier », « Vivier général », « Vivier de l'offre » et rubrique du sous-menu.

Les Server Actions (`actions.ts`) et les composants n'ont pas de test automatisé. Commandes : `npm test` (tous les
`src/**/*.test.ts`, `node --import tsx --test`), un fichier : `node --import tsx --test src/lib/vivier-matching.test.ts` ;
`npm run typecheck`, `npm run lint`.

## Modifier cette page

- **Nouvel attribut de `vivier_cvs`** : `appwrite.config.json` puis `npm run schema:push -- dev` avant le déploiement
  (limite de 16 attributs par collection ; production par un humain), et `docToVivierCv` / `VivierCv`.
- **Tout nouveau chemin qui supprime un `vivier_cvs`** doit aussi supprimer ses versions « CV format cabinet »
  (`vivierExportKey`, ADR 0016) et, pour le vivier général, ses lignes `vivier_offer_matches` (ADR 0026).
- **Tout nouvel endroit qui écrit `offerMatchesJson`** doit appeler `syncVivierOfferMatches` avant (aujourd'hui seul
  `compareWithNewOffers` l'écrit).
- **Barème, consignes ou format de `judgementSummary`** : `match-scoring.ts`, et `score-breakdown.ts` avec son test
  (le détail des scores du Matching IA relit ce résumé, AGENTS.md).
- **Paramètre `?vue=general`** : lu par `page.tsx`, écrit par `vivier-tabs.tsx`, nommé par `recruiterPageLabel`
  (`src/lib/recruiter-trail.ts`, testé) et utilisé comme page parente par `candidate-preview` : changer les quatre
  ensemble. La sous-page `/recruiter/vivier/<offre>` a son nom dans `PAGE_LABELS` (« Vivier de l'offre »).
- **Contrôle de propriété** : `ownVivierDoc` (actions), `/api/vivier-cv/[fileId]`, `ownsVivierCv` (export) et
  `candidate-preview/[source]/[id]/page.tsx` appliquent la même règle (organisation + recruteur, sauf admin) : les
  garder alignés.
- **`VivierClient`** sert aux deux routes ; `CandidateProfileModal` et le type `CvThequeCandidate` viennent de la CV
  Thèque (`toCandidate`).
- **Squelette de chargement** : aucune route du vivier n'a de `loading.tsx` ; en ajouter un = partir de
  `SectionPageSkeleton` (`src/components/recruiter/page-skeletons.tsx`).
