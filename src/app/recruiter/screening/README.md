# Screening IA des CV — `/recruiter/screening`

Le recruteur y fait noter par l'IA les candidatures reçues sur une offre (score de 0 à 100 calculé par le code à
partir des jugements de l'IA, recommandation de « Top profil » à « À rejeter »), relit les résultats, les exporte en CSV,
invite un candidat à un entretien IA ou lui écrit, et voit le classement de ses candidats toutes offres confondues.
On y arrive par le bouton « Screening CV » de la page Entretiens IA (`/recruiter/interviews`) : le screening n'a pas de
rubrique dans le sous-menu, il garde « Entretiens IA » en surbrillance. Les actions serveur de ce dossier servent aussi
hors de ces pages : analyse automatique de chaque candidature reçue, « Lancer le screening » du pipeline, envoi des
invitations d'entretien.
Décisions : [ADR 0028](../../../../docs/adr/0028-notation-par-jugements.md) (notation par jugements). Règles produit :
AGENTS.md, section « Vivier général des recruteurs (matching automatique) », puce « Notation d'un candidat pour une
offre » ; section « Design System », puces *Recruiter sub-menu*, *« Retour » links* et *Loading states*.

## Fichiers

```
page.tsx              /recruiter/screening : offres actives de l'organisation et nombre de candidatures, lien « Meilleurs candidats »
best/page.tsx         /recruiter/screening/best : classement des candidatures notées, filtres score et offre (composant serveur seul)
[jobId]/page.tsx      /recruiter/screening/<offre> : charge l'offre et ses candidatures, rend ScreeningClient
screening-client.tsx  écran d'une offre (client) : critères, sélection, « Analyser N CV », résultats, filtres, export CSV
result-actions.tsx    boutons d'un résultat (client) : fenêtres « Inviter à un entretien IA » et « Message personnalisé »
actions.ts            actions serveur : notation, chargement, analyse automatique, e-mails, export CSV
```

Pas de `loading.tsx` dans ce dossier : c'est celui de l'espace recruteur qui s'affiche.

Code partagé :

- [match-scoring.ts](../../../lib/match-scoring.ts) — règles de notation communes aux quatre notations (consignes
  `MATCH_RULES`, lecture et vérification des jugements, barème, plafonds, recommandation) ; tests
  [match-scoring.test.ts](../../../lib/match-scoring.test.ts).
- [title-check.ts](../../../lib/title-check.ts) — `withCheckedTitles`, seconde question à l'IA (intitulés du CV).
- [description-sections.ts](../../../lib/description-sections.ts) — `parseDescription`, découpage de la description de
  l'offre (exigences, ordre des sections).
- [sourcing-core.ts](../../../lib/sourcing-core.ts) — `CV_CHARS_FOR_SCORING` (12 000) ;
  [sourcing-rules.ts](../../../lib/sourcing-rules.ts) — `SOURCING_MIN_SCORE` (65).
- [recommendation-boost.ts](../../../lib/recommendation-boost.ts) (`expertiseBoost`),
  [scoring-weights.ts](../../../lib/scoring-weights.ts) (`getScoringWeights`),
  [recommendations.ts](../../../lib/appwrite/recommendations.ts) (`getSubmittedRecommendations`) — part des
  recommandations dans le score.
- [jobs.ts](../../../lib/appwrite/jobs.ts) — `getJobsByTenant`, `getApplicationsByTenant` (listes complètes, par pages).
- [auth.ts](../../../lib/appwrite/auth.ts) — `getCurrentUser` ; [client.ts](../../../lib/appwrite/client.ts) —
  `createAdminClient`.
- [candidate-identity.ts](../../../lib/candidate-identity.ts) — `notificationUserId`, `displayEmail` (profils du vivier
  d'un chasseur).
- [llm-router.ts](../../../lib/ai/llm-router.ts) — `callLLM` ; [email-template.ts](../../../lib/email-template.ts) —
  `wrapEmailHtml`.
- [interviews/actions.ts](../interviews/actions.ts) — `generateInterviewQuestions`, `createInterviewSession`
  (documentés dans [../interviews/README.md](../interviews/README.md)).
- [score-breakdown.ts](../../../lib/score-breakdown.ts) — relit le résumé des jugements écrit dans `aiSummary` (détail
  du score sur la page Matching IA).
- Composants : [back-link.tsx](../../../components/recruiter/back-link.tsx),
  [pagination.tsx](../../../components/shared/pagination.tsx),
  [cv-preview-modal.tsx](../../../components/shared/cv-preview-modal.tsx) (CV servi par
  [`/api/cv/[fileId]`](<../../api/cv/[fileId]/route.ts>)),
  [loading-provider.tsx](../../../components/shared/loading-provider.tsx).

## Accès et périmètre des données

- [middleware.ts](../../../middleware.ts) renvoie vers `/login` sans cookie `mbc-session` et vers le tableau de bord
  du rôle si `mbc-role` n'est pas `recruiter` ; ce n'est pas un contrôle d'accès. Le layout recruteur
  ([layout.tsx](../layout.tsx)) appelle `getCurrentUser` et redirige vers `/login` si le rôle n'est pas `recruiter`.
- Chaque page revérifie : `getCurrentUser`, rôle `recruiter` sinon `redirect('/login')`. `page.tsx` et `best/page.tsx`
  exigent aussi `user.tenantId`, sinon `redirect('/recruiter/dashboard')` ; `[jobId]/page.tsx` ne regarde pas
  `tenantId`.
- Toutes les lectures et écritures passent par `createAdminClient()` (clé API serveur) ; la session ne sert qu'à
  identifier l'utilisateur (`account.get()` dans `getCurrentUser`).
- Périmètre :
  - `/recruiter/screening` et `/best` : offres de `getJobsByTenant(tenantId)` = offres de l'organisation **et** offres
    partagées de la plateforme (`tenantId ''`) ; candidatures de `getApplicationsByTenant(tenantId)` = candidatures
    dont `tenantId` est celui de l'organisation.
  - `/recruiter/screening/<offre>` (`getApplicationsForJob`) : l'offre est lue par son identifiant et ses candidatures
    par `Query.equal('jobId', jobId)` ; aucun filtre sur l'organisation, ni pour l'offre ni pour les candidatures. Seul
    le rôle `recruiter` est vérifié.
- Aucune condition d'abonnement, d'adresse e-mail vérifiée ni de quota pour les appels d'IA de ces pages.
- Contrôles de chaque action serveur : tableau « Actions serveur ».

## Chargement de la page

### `/recruiter/screening` (`ScreeningIndexPage`)

1. `getCurrentUser` et contrôles ci-dessus.
2. En parallèle : `getJobsByTenant(tenantId)` et `getApplicationsByTenant(tenantId)`.
3. Offres affichées : `jobs.filter(j => j.isActive)` (la date d'expiration n'est pas regardée ici). Nombre de
   candidatures par offre compté sur les candidatures de l'organisation.
4. Rendu serveur, sans composant client : carte « Meilleurs candidats », puis une ligne par offre (titre, lieu,
   contrat, nombre) vers `/recruiter/screening/<id>` ; sans offre active, « Aucune offre active… ».
5. Pas de `try` : une lecture en échec remonte à Next (aucun `error.tsx` dans `src/app`).

### `/recruiter/screening/<offre>` (`ScreeningJobPage`)

1. `getCurrentUser`, rôle `recruiter`.
2. `getApplicationsForJob(jobId)` (action serveur appelée directement par la page) :
   1. revérifie le rôle ;
   2. en parallèle : l'offre (`jobs`, `getDocument`) et ses candidatures (`applications`, `jobId`, les plus récentes
      d'abord, **100 au plus**) ;
   3. analyses enregistrées (`screenings`) des **25 premières** candidatures de cette liste (`appIds.slice(0, 25)`,
      100 documents au plus) ; lecture en échec ignorée (commentaire : collection peut-être absente) ;
   4. profils (`users`) des **25 premiers** candidats (`candidateIds.slice(0, 25)`) : nom `firstName lastName`, e-mail
      `users.email` ; sinon « Candidat #<6 derniers caractères de l'identifiant> » et e-mail vide ; échec ignoré ;
   5. `ApplicationRow` par candidature (avec `existingScore` / `existingScreeningId` lus dans les analyses) et
      `existingResults` : **un `ScreeningScore` par document `screenings` lu**, sans regroupement par candidature,
      sans `plainSummary`.
3. Erreur (offre introuvable, Appwrite injoignable) : la page affiche le message d'erreur tel quel, ou « Offre
   introuvable ».
4. Props de `ScreeningClient` : `jobId`, titre, description, compétences de l'offre, `applications`, `existingResults`.

### `/recruiter/screening/best` (`BestCandidatesPage`)

1. `searchParams` : `job` (identifiant d'offre) et `min` (`70`, `85`, sinon tous).
2. Contrôles, puis en parallèle `getJobsByTenant` et `getApplicationsByTenant`.
3. Filtre et tri : voir « Classement des meilleurs candidats ».
4. Noms et e-mails : `users` des **100 premiers** candidats du classement, e-mail par `displayEmail` (vide pour un
   profil du vivier d'un chasseur) ; échec ignoré, la ligne affiche alors l'identifiant du candidat.
5. Rendu serveur ; filtres = liens (`qs`), pas d'état client.

Chargement des trois routes : `src/app/recruiter/loading.tsx` (`SectionPageSkeleton`, contenu « liste », de
[page-skeletons.tsx](../../../components/recruiter/page-skeletons.tsx)).

## Logique et algorithmes

### Notation d'une candidature (`scoreApplicationInternal`, `actions.ts`)

Entrée : `ApplicationToScreen` (offre : titre, description, compétences ; candidat ; texte du CV ; message de
motivation ; critères du recruteur facultatifs). Sortie : `ScreeningScore`, ou `{ error }`.

1. `offerCriteria(skills, description)` : listes numérotées de l'offre.
   - `requiredSkills` : compétences de l'offre sans vide ni doublon (casse ignorée), 80 caractères chacune,
     `MAX_REQUIRED_SKILLS` = 12 au plus.
   - `offerRequirements` : puces des sections « profil » puis « missions » de la description (`parseDescription`),
     sans mise en forme ni doublon, 160 caractères chacune, `MAX_REQUIREMENTS` = 10 au plus ; aucune si la
     description n'a pas de liste à puces.
2. Consigne système : format JSON attendu (`judgementFields(criteriaCounts(criteria))`, plus `skills` libres si l'offre
   n'a pas de compétences, `strengths`, `concerns`, `summary`), puis `MATCH_RULES`, puis « Domaine exigé absent : le
   dire dans "concerns" ».
3. Message : titre de l'offre (« Poste : … »), `criteriaBlock` (exigences et compétences numérotées),
   `offerTextForAi(description, 4000)` (sections dans l'ordre profil, missions, contexte, informations, modalités ;
   description brute si elle n'a pas plusieurs sections), critères du recruteur (`buildCriteriaPrompt`), CV coupé à
   `CV_CHARS_FOR_SCORING` (12 000 caractères), message de motivation coupé à 500 caractères.
4. `callLLM(…, { module: 'screening', maxTokens: 8000 })` : modèle « Screening CV » de Config IA, avec le repli
   habituel de `callLLM` sur les autres modèles configurés.
5. Premier objet `{…}` de la réponse, `JSON.parse` ; `parseJudgements(parsed, criteria, cvText)` (section suivante).
   Pas d'objet ou jugements illisibles : `{ error: 'Réponse LLM invalide' }`, pas de score.
6. `withCheckedTitles([judgements])` : comparaison des intitulés (plus bas).
7. Score :
   ```
   aiScore = judgedScore(j)                                    // barème + plafonds
   blended = blendWithRecommendationScore(aiScore, candidateId, titre + compétences + description)
   score   = round(min(withBonus(aiScore, blended − aiScore), capFor(j)))
   recommendation = recommendationFor(score)
   ```
8. Champs rendus : `skills` = les compétences de l'offre avec leur jugement (`oui` → `yes`, `partiel` → `partial`,
   `non` → `no`, table `SKILL_MATCH`), ou, sans compétences dans l'offre, la liste `skills` de l'IA (12 au plus) ;
   `strengths` (4 au plus) et `concerns` (3 au plus) de l'IA ; `summary` = `judgementSummary(j)` + « — » + résumé de
   l'IA ; `plainSummary` = résumé de l'IA seul (pour l'e-mail au candidat) ; `provider` = modèle qui a répondu.

`screenApplication` = même fonction précédée du contrôle du rôle `recruiter` ; `scoreApplicationInternal` (non
exportée) sert à l'analyse automatique, sans recruteur en session.

### Jugements de l'IA vérifiés dans le CV (`parseJudgements`, `match-scoring.ts`)

Moteur commun expliqué en entier (préparation de l'offre, vérification des preuves, barème, plafonds, recommandations) :
[docs/matching-et-notation-ia.md](../../../../docs/matching-et-notation-ia.md).

L'IA ne donne pas de note (ADR 0028) ; elle répond par critère, et le code vérifie ses preuves dans le texte du CV
qu'elle a lu (mots normalisés : sans casse, accents ni ponctuation).

- `poste` : un élément par métier du titre de l'offre (4 au plus, `MAX_ROLES`), `{ metier, exerce, intitule }`. Un
  métier jugé exercé sans `intitule` passe à `non` ; un `intitule` dont un mot manque au CV (ou qui a la forme d'une
  liste de mots-clés) perd un niveau (`oui` → `partiel`, `partiel` → `non`).
- `exigences` et `competences` : une valeur par élément de la liste numérotée (`{ jugement, citation }`) ; un élément
  oublié vaut `non`, un élément en trop est ignoré, une valeur seule (pas un tableau) vaut pour tous. Sans liste dans
  l'offre, la consigne demande un jugement d'ensemble (`evidenceField`) ; un tableau reçu quand même est gardé,
  12 valeurs au plus. Un
  `oui` n'est gardé que si `citation` (ou `preuve`) a au moins 5 mots (`MIN_CITATION_WORDS`), tous présents dans le
  CV, et n'est pas une liste de mots-clés (`isKeywordList` : 3 séparateurs `, ; / | • ·` ou plus et moins de 3 mots par
  segment) ; pour une compétence, la citation doit aussi contenir un mot de 3 lettres ou plus de la compétence.
  Sinon `partiel`.
- `domaine` : `oui` / `partiel` / `non` / `non requis` ; `niveau` : `oui` / `partiel` / `non` / `non précisé`
  (réponses anglaises acceptées).
- Un critère illisible ou absent : `null`, la candidature n'est pas notée.

Tests : `match-scoring.test.ts`, blocs « jugements vérifiés dans le CV » et « score calculé à partir des jugements ».

### Comparaison des intitulés (`withCheckedTitles`, `title-check.ts`)

Paires « métier du titre / intitulé cité » des métiers jugés exercés (`rolePairs`) envoyées en une seule question
(`titleCheckPrompt`, `callLLM` module `matching`, 2 000 jetons). Réponse par paire (`parseTitleRelations`) : `meme`
garde le jugement, `famille` le ramène à `partiel` au plus, `autre` à `non` ; réponse illisible ou appel en échec
(journalisé `[matching] comparaison des intitulés …`) : `partiel` au plus. Aucun appel s'il n'y a pas de paire.

### Barème et plafonds (`judgedScore`, `capFor`)

Points par jugement (`POINTS`) : `oui` 1, `partiel` 0,5, `non` 0, `non requis` 1, `non précisé` 1. Poids
(`SCORE_WEIGHTS`) :

| Critère | Poids | Valeur |
|---|---|---|
| poste | 30 | moyenne des métiers du titre |
| exigences | 30 | moyenne des exigences |
| compétences | 20 | moyenne des compétences |
| domaine | 15 | points du jugement |
| niveau | 5 | points du jugement |

Le total arrondi est plafonné par `capFor`, le plus bas de : chaque métier du titre (`ROLE_CAP` : `non` 50,
`partiel` 75) et le domaine (`DOMAIN_CAP` : `non` 60, `partiel` 80). Un métier non exercé plafonne même si l'autre
métier du titre l'est. Recommandation (`recommendationFor`) : 85 et plus `top`, 70 `good`, 55 `average`, 40 `weak`,
sinon `reject` ; les seuils de couleur de `ScoreBadge` (`screening-client.tsx`) sont les mêmes.

### Part des recommandations (`blendWithRecommendationScore`, `actions.ts`)

Sans `candidateId`, ou sans recommandation notée (`getSubmittedRecommendations` : statut `submitted`, les 25 plus
récentes), le score de l'IA reste tel quel. Sinon :

1. note moyenne des étoiles (1 à 5) ramenée sur 100 : `(moyenne − 1) / 4 × 100` ;
2. mélange : `aiScore × (1 − w) + note × w`, avec `w` = `recommendationWeight` de `/admin/scoring` (lu par
   `getScoringWeights` dans le premier document de `COLLECTIONS.TEMPLATES_CONFIG`, clé `__scoringWeights` du JSON
   `customColors` ; 0,15 par défaut, `DEFAULT_SCORING_WEIGHTS`) ;
3. plus `expertiseBoost` : pour chaque expertise recommandée citée dans le texte de l'offre, +2 (1 recommandation),
   +3,5 (2), +5 (3 ou plus), 12 points au plus (`BOOST_CAP`) ;
4. borné à 0–100 et arrondi. Toute erreur : score de l'IA tel quel.

L'écart obtenu passe par `withBonus` : un candidat noté sous 65 (`SOURCING_MIN_SCORE`) reste à 64 au plus ; puis le
plafond `capFor` s'applique encore.

### Critères du recruteur (`buildCriteriaPrompt`)

Panneau « Critères de scoring » (`CriteriaPanel`), état du navigateur seulement (rien n'est enregistré). Chaque
critère différent de `any` ou non vide ajoute une ligne au message de l'IA, sous « CRITÈRES SUPPLÉMENTAIRES DU
RECRUTEUR » : niveau (`junior` « < 3 ans », `senior` « 3–7 ans », `expert` « 7+ ans »), disponibilité, langue,
compétences prioritaires (texte libre, « bonus si présentes »), instructions libres. Ces lignes ne changent ni les
listes numérotées ni le barème : elles n'agissent que par les jugements de l'IA. Seul « Analyser N CV » de cette page
les envoie (le pipeline et l'analyse automatique n'en ont pas). Type `ScreeningCriteria` déclaré deux fois
(`actions.ts` et `screening-client.tsx`).

### Lecture du CV (`extractCVText`, `actions.ts`)

Fichier lu dans le bucket `BUCKETS.CVS` ; type d'après les premiers octets : `%P` → `pdf-parse` (avec un
`DOMMatrix` factice), `PK` → `mammoth` (texte brut), sinon UTF-8 filtré. Texte coupé à 12 000 caractères. Texte trop
court ou erreur : un texte de remplacement est envoyé à l'IA à la place du CV (`[PDF sans texte extractible]`,
`[DOCX sans contenu texte]`, `[Fichier non lisible]`, `[Erreur lecture CV: …]` ; sans fichier : `[Pas de CV joint]`).

### Analyse de plusieurs candidatures (`screenAllApplications`)

Appelée par « Analyser N CV » (avec les critères) et par `launchScreeningAction` du pipeline
([pipeline/[jobId]/actions.ts](<../pipeline/[jobId]/actions.ts>), une seule candidature, sans critères).

1. Rôle `recruiter`, puis lecture de l'offre.
2. Pour chaque identifiant, **l'un après l'autre** : candidature, texte du CV, profil du candidat (nom, e-mail),
   `screenApplication`.
3. Score obtenu : nouveau document `screenings` (`ID.unique()`, `tenantId` = celui du recruteur), puis copie sur la
   candidature (`aiScore`, `aiSummary`, `aiRecommendation`) ; chaque écriture en échec est ignorée.
4. E-mail au candidat si `score >= 70` **et** si la candidature n'avait pas de score avant (`appDoc.aiScore == null`,
   lu avant la notation) ; échec ignoré.
5. Erreurs collectées par candidature (« <nom>: <message> », « App <id>: <message> »), renvoyées avec les résultats ;
   `revalidatePath('/recruiter/screening')`.

### Analyse automatique d'une candidature reçue (`autoScreenApplication`)

Lancée en tâche de fond (`after()`) par [api/apply/route.ts](../../api/apply/route.ts),
[(public)/jobs/actions.ts](<../../(public)/jobs/actions.ts>), [hunter.ts](../../../lib/hunter.ts) (profil proposé
par un chasseur) et la page Matching IA (candidatures sans score) ; attendue par « Relancer » / « Lancer le matching »
du Matching IA (`runApplicationMatchingAction`, [matching-actions.ts](<../pipeline/[jobId]/matching-actions.ts>), qui
vérifie l'offre et l'organisation de la candidature avant l'appel). Elle-même ne fait aucun contrôle : elle tourne
sans recruteur en session.

1. Candidature, offre, profil du candidat (sinon « Candidat #… »), texte du CV.
2. `scoreApplicationInternal`, sans critères ; erreur : abandon silencieux.
3. En parallèle : document `screenings` (`tenantId` de la candidature) et copie sur la candidature.
4. Même règle d'e-mail que ci-dessus (70 et plus, première analyse).
5. `revalidatePath` de `/recruiter/screening` et `/recruiter/dashboard`. Toute exception est avalée (commentaire : ne
   jamais casser le dépôt de candidature).

### Écran d'une offre (`ScreeningClient`)

- Sélection : toutes les candidatures cochées au départ ; recherche par nom ou e-mail (au-delà de 5 candidatures),
  pages de 50 (`PAGE_SIZE`). La liste de sélection n'est affichée que tant qu'aucun résultat n'est là (`done` faux) :
  avec des analyses déjà enregistrées, ou après un passage, elle est masquée et « Analyser N CV » porte sur la
  dernière sélection (au départ : toutes les candidatures).
- « Analyser N CV » (`runScreening`) : vide les résultats affichés, appelle `screenAllApplications` dans une transition
  (`withLoading` : barre de progression du haut), puis affiche les résultats de ce passage seulement et ses erreurs.
- Résultats triés par score décroissant ; tuiles par recommandation (cliquer filtre, recliquer retire), score moyen,
  recherche par nom ou e-mail, pages de 50. Carte : score, recommandation, nom (lien vers
  `/recruiter/candidates/<candidature>`), résumé, « Voir CV » (`CvPreviewModal`), détail repliable (compétences,
  points forts, vigilance, modèle et date).
- Export CSV (`downloadCSV`) : `exportScreeningCSV(sorted)` renvoie le texte (colonnes Candidat, Email, Score,
  Recommandation — clé brute `top`… —, Résumé, Points forts et Points de vigilance séparés par « | ») ; le navigateur le
  télécharge en `screening-<offre>.csv`.

### Classement des meilleurs candidats (`best/page.tsx`)

Candidatures de l'organisation dont `aiScore !== undefined` et `aiScore >= min` (`MIN_OPTIONS` : tous = 0, 70, 85),
restreintes à l'offre `job` si elle est donnée, triées par `aiScore` décroissant ; rang affiché, les trois premiers
mis en évidence. Recommandation lue dans `aiRecommendation` (`average` par défaut), résumé `aiSummary` sur deux lignes.
Actions : CV (`/api/cv/<fichier>`, nouvel onglet), `mailto:`, entretien IA
(`/recruiter/interviews/new?appId=…&jobId=…`). Les filtres d'offre listent toutes les offres de `getJobsByTenant`
(actives ou non) ; une candidature dont l'offre n'y est plus affiche « Offre supprimée ».

### Passage à l'entretien IA (`InterviewModal`, `prepareInterviewFromScreening`)

Le screening prépare l'entretien puis passe la main aux entretiens ([../interviews/README.md](../interviews/README.md)).

1. « Inviter à un entretien IA » ouvre la fenêtre, qui lance aussitôt `prepareInterviewFromScreening` (fermeture
   impossible pendant la génération) :
   1. `generateInterviewQuestions(titre, description, compétences, « Résumé screening IA : <summary> », 8)` : questions
      génériques activées (badge « Par défaut », identifiants `gq-…`) puis questions de l'IA ;
   2. `createInterviewSession(…)` : document `interviews` (questions comprises) et candidature passée au statut
      `interview`. La session existe donc dès l'ouverture de la fenêtre, même si l'on annule ensuite.
2. Relecture : modifier, supprimer, ajouter des questions (état du navigateur), lien `/interview/<session>` à copier.
3. « Envoyer l'invitation par email » : `sendInterviewInvitationEmail` avec `applicationId`, e-mail, `sessionId`, titre,
   nom ; aucune question n'est transmise à ce moment.

### E-mails (Appwrite Messaging)

Tous par `messaging.createEmail(…, users: [<compte Auth>], html: true)` dans `wrapEmailHtml`. Destinataire résolu par
`getCandidateAuthUserId` : candidature → document `users` du candidat → `notificationUserId` (le compte du candidat,
ou celui du chasseur pour un profil `hunter_profile` de son vivier).

| E-mail | Fonction | Objet | Particularités |
|---|---|---|---|
| Candidature retenue (automatique) | `sendAutoScreeningEmail` | « Votre candidature pour <offre> a retenu notre attention » | score /100, `plainSummary`, premier point fort |
| Invitation à l'entretien | `sendInterviewInvitationEmail` | « Invitation à un entretien IA — <offre> » | lien `NEXT_PUBLIC_APP_URL` (sinon `https://mybestconsultant.fr`) + `/interview/<session>`, `?mode=video` en vidéo ; destinataire par la candidature ; sans candidature (entretien créé à la main), ou si elle ne donne pas de compte (erreur comprise), par l'adresse e-mail (`users.list`, Users API) |
| Message personnalisé | `sendCustomMessage` | saisi par le recruteur | chaque ligne du message devient un paragraphe (ligne vide : `&nbsp;`) |

## Actions serveur

Toutes les fonctions exportées de `actions.ts` (`'use server'`) sont des actions serveur, donc appelables par une
requête POST. Aucune n'a de validation par schéma.

| Action | Fichier | Rôle | Contrôles (auth, rôle, organisation, validation) | Écritures et effets (collections, e-mails, IA, appels externes) |
|---|---|---|---|---|
| `getApplicationsForJob` | `actions.ts` | données de `/recruiter/screening/<offre>` | rôle `recruiter` ; pas d'organisation | lecture `jobs`, `applications`, `screenings`, `users` |
| `screenAllApplications` | `actions.ts` | « Analyser N CV », « Lancer le screening » du pipeline | rôle `recruiter` (et dans `screenApplication`) ; pas de lien vérifié entre candidatures, offre et organisation | jusqu'à 2 appels d'IA par candidature (`screening`, puis `matching` s'il y a des intitulés à comparer), lecture `recommendations` ; création `screenings`, mise à jour `applications` ; e-mail automatique |
| `screenApplication` | `actions.ts` | notation d'une candidature fournie en entier | rôle `recruiter` | appels d'IA ; aucune écriture |
| `autoScreenApplication` | `actions.ts` | analyse automatique d'une candidature reçue | aucun (appelée côté serveur sans session) | comme `screenAllApplications`, pour une candidature |
| `exportScreeningCSV` | `actions.ts` | texte CSV des résultats affichés | aucun | aucune |
| `prepareInterviewFromScreening` | `actions.ts` | questions et session d'entretien | aucun contrôle propre ; `createInterviewSession` vérifie le rôle `recruiter` | appel d'IA (module `interview`) ; création `interviews`, statut `interview` sur la candidature |
| `sendInterviewInvitationEmail` | `actions.ts` | invitation à l'entretien (aussi pages entretiens et pipeline) | rôle `recruiter` | e-mail ; lecture `applications`, `users`, Users API |
| `sendCustomMessage` | `actions.ts` | « Message personnalisé » | rôle `recruiter` | e-mail ; lecture `applications`, `users` |

Collection `screenings` (`APPWRITE_COLLECTION_SCREENINGS`, sans permission client) : `applicationId`, `jobId`,
`tenantId`, `score`, `recommendation`, `summary` (3 000), `skills` (JSON, 6 000), `strengths` / `concerns` (tableaux,
500 par élément), `provider`, `scoredAt` ; index `applicationId`. Un document par analyse : l'historique est gardé.
La page Matching IA y lit la date de la dernière analyse (`getJobMatches`, `matching-core.ts`).

## Erreurs et cas limites

- Réponse de l'IA sans objet JSON ou sans jugements lisibles : « Réponse LLM invalide » dans la liste d'erreurs, pas
  de score. Tous les modèles en échec : message de `LLMChainError`.
- Comparaison des intitulés impossible : journalisée, métiers à « partiel » au plus (score plafonné à 75 au plus par
  `ROLE_CAP`).
- Recommandations ou pondération illisibles : score de l'IA sans mélange, sans journal.
- `screenAllApplications` : écriture de `screenings`, mise à jour de la candidature ou e-mail en échec ignorés ; le
  résultat s'affiche quand même. `autoScreenApplication` : toute erreur avalée, sans journal.
- CV absent ou illisible : texte de remplacement noté comme un CV (voir « Lecture du CV »).
- Offre de plus de 100 candidatures : les plus anciennes ne sont pas listées ; au-delà de 25, les suivantes n'ont ni
  analyse relue ni nom (« Candidat #… »). Classement : au-delà de 100 candidats, identifiant à la place du nom.
- Profil du vivier d'un chasseur : les e-mails partent au chasseur (`notificationUserId`) ; l'écran d'une offre affiche
  `users.email`, le classement `displayEmail` (vide).
- Invitation sans compte trouvé : « Aucun compte candidat associé à cet email » ; message personnalisé : « Candidat
  introuvable ».
- La fenêtre d'entretien affiche le lien sans `?mode=video` et envoie l'invitation sans `mediaMode` (audio).

## Tests

- [match-scoring.test.ts](../../../lib/match-scoring.test.ts) : consignes, jugements vérifiés, barème, plafonds,
  bonus, recommandation, description envoyée à l'IA.
- [score-breakdown.test.ts](../../../lib/score-breakdown.test.ts) : le résumé des jugements redonne `judgedScore`.
- [description-sections.test.ts](../../../lib/description-sections.test.ts), [sourcing-rules.test.ts](../../../lib/sourcing-rules.test.ts).
- [recruiter-trail.test.ts](../../../lib/recruiter-trail.test.ts) (noms des pages),
  [recruiter-nav.test.ts](../../../lib/recruiter-nav.test.ts) (`/recruiter/screening/best` dans « Entretiens IA »).
- Aucun test pour `actions.ts`, les pages ni les e-mails.

Commande : `npm test` (`node --import tsx --test "src/**/*.test.ts"`) ; un fichier :
`node --import tsx --test src/lib/match-scoring.test.ts` ; types : `npm run typecheck`.

## Modifier cette page

- **Règles de notation** : `match-scoring.ts` sert aux quatre notations (candidature, base candidats, vivier d'une
  offre, vivier général) ; un changement de barème, de plafond, de consigne ou du format de `judgementSummary` passe
  par `score-breakdown.ts` et son test (AGENTS.md), et par l'ADR 0028.
- **Signatures des actions** : `autoScreenApplication` (`api/apply`, `(public)/jobs/actions.ts`, `hunter.ts`, Matching
  IA), `screenAllApplications` (pipeline), `sendInterviewInvitationEmail` (`interviews/new`, `interviews/[sessionId]`,
  pipeline) sont appelées hors de ce dossier.
- **Champs écrits** : bornes de `screenings` (ci-dessus) et `applications.aiSummary` (5 000) dans
  `appwrite.config.json` ; `aiScore` / `aiSummary` / `aiRecommendation` sont lus par le tableau de bord, le pipeline,
  la fiche candidat et le Matching IA.
- **Libellés en double** : `RECO` dans `screening-client.tsx` et `best/page.tsx` ; `ScreeningCriteria` dans
  `actions.ts` et `screening-client.tsx`.
- **Navigation** : noms des trois pages dans `PAGE_LABELS` de [recruiter-trail.ts](../../../lib/recruiter-trail.ts)
  (« Screening IA », « Meilleurs candidats », « Screening de l’offre », dans cet ordre : `best` avant l'expression
  générale) et leur test ; rubrique « Entretiens IA » (`also: ['/recruiter/screening']`) dans
  [recruiter-nav.ts](../../../lib/recruiter-nav.ts) et son test ; lien « Screening CV » de
  [interviews-index-client.tsx](../interviews/interviews-index-client.tsx) ; `fallbackHref` des `BackLink`.
- **Chargement** : une page dont la mise en page s'écarte de `SectionPageSkeleton` reçoit son propre `loading.tsx`
  construit dans `page-skeletons.tsx`.
- **Aide de l'assistant** : la ligne « Screening IA » de [knowledge.ts](../../../lib/assistant/knowledge.ts).
