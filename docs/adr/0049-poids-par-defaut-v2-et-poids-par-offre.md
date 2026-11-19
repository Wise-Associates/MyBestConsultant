# 0049. Nouveaux poids par défaut, poids par offre et par candidat

Date : 2026-11-19. Statut : accepté. Complète l'ADR 0036 (deux barèmes, poids personnels).

## Contexte

Demande du 2026-11-19 :

1. Nouveaux poids par défaut, pour le matching et pour le score final : poste 35, techno 20, localisation 12,
   secteur 11, séniorité 10, le reste réparti entre les autres critères.
2. Des poids **par offre et par recruteur**, en plus des poids personnels de l'ADR 0036 (qui deviennent ses poids
   « globaux »), réglés dans la colonne de droite du Matching IA de l'offre (`/recruiter/pipeline/<offre>/matching`).

Les scores sont enregistrés aux poids par défaut, puis recalculés à l'affichage avec ceux du recruteur
(`personalScore`). Ce calcul retrouve l'écart des recommandations en refaisant le score enregistré à partir du résumé
des jugements : si les poids par défaut changent, il faut savoir avec quels poids chaque score enregistré a été calculé.
Sinon, l'écart serait faux de plusieurs points pour tout recruteur qui a ses propres poids.

## Décision

**Poids par défaut v2** (choix de l'utilisateur du même jour, sur proposition) :

- matching : poste 35, techno 20, localisation 12, secteur 11, séniorité 10, contexte 3, projet 3, formation 2,
  langue 2, TJM 2. Les 12 points restants sont répartis 3/3/2/2/2 : un poids est un entier.
- score final : poste 35, techno 20, localisation 12, client 11, séniorité 10, contexte 6, projet 6. Ce barème n'a pas
  de secteur ; l'environnement du client (son secteur, sa taille, ses outils) prend les 11 points du secteur.

Les plafonds des critères essentiels ne changent pas. Formation et langue (2 points) gardent leur plafond de 60 quand
elles manquent : un poids faible ne retire pas le caractère éliminatoire (ADR 0036).

**Versions des poids** (`WEIGHT_VERSIONS`, `CURRENT_WEIGHTS_VERSION`, `src/lib/match-scoring.ts`) :

- v1 : les poids du 2026-11-15 ;
- v2 : les poids ci-dessus.

Le résumé d'un score note sa version en tête : « Poids v2 · Poste : oui · … · TJM : non précisé ». `scoreBreakdown`
relit un score enregistré avec les poids de sa version ; un résumé sans version date d'avant et utilise v1. Une version
inconnue ne donne pas de détail : le score enregistré est affiché.

La version est notée plutôt que les poids eux-mêmes. La raison d'un CV du vivier général tient en 300 caractères
(`REASON_MAX`), et noter un poids par critère allongerait le résumé d'environ 50 caractères.

Elle est en tête et non à la fin (revue de code du même jour). Une raison coupée à 300 caractères juste avant une marque
finale ressemblerait à un résumé v1 : le score v2 serait relu aux poids v1, avec un faux écart de recommandations.

Pour changer à nouveau un poids par défaut : ajouter une version et y faire pointer `CURRENT_WEIGHTS_VERSION`. Une
version existante ne doit jamais être modifiée. Un test vérifie que chaque version fait 100 dans l'ordre des critères.

**Cache des notations** (ADR 0044) : une notation reprise du cache est recalculée à partir de ses jugements gardés
(`scoredFrom`, `sourcing-core.ts`). Une notation gardée avant le changement donne donc le score v2, sans nouvel appel
d'IA.

**Poids par offre** :

- **Stockage** : collection `job_scoring_weights` (choix de l'utilisateur, plutôt que les préférences du compte dont la
  taille est bornée). Un document par compte et par offre, d'identifiant `jw` + sha256(compte:offre), et un par candidat
  de l'offre (voir « Poids par candidat »). Attributs `userId`, `jobId`, `candidate` (vide pour l'offre) et `weights`
  (JSON des poids par barème, `{ "matching": {…} }`, validé à l'écriture et à la lecture). Index sur `jobId` et sur
  (`userId`, `jobId`).
  Aucune permission client. Variable `APPWRITE_COLLECTION_JOB_SCORING_WEIGHTS` ; vide, le réglage par offre n'apparaît
  pas et seuls les poids globaux s'appliquent.
- **Ordre de priorité** : poids de l'offre, sinon poids globaux, sinon poids par défaut (`withOverride`,
  `loadWeightsForJob`). Seul le barème du matching se règle par offre ; le score final garde les poids globaux.
- **Pages qui l'appliquent** : le Matching IA, le pipeline et « Réponse client » de l'offre. Un candidat a ainsi le
  même score sur les trois pages d'une offre.
- **Écran** : section repliable « Pondération de l’offre » en tête de la colonne de droite du Matching IA
  (`job-weights-panel.tsx`) ; sous 90rem, au-dessus de la liste.
  - Une pastille indique « Propre à l'offre » ou « Poids globaux ».
  - Un champ par critère, avec le poids global rappelé à côté ; total de 100 exigé.
  - Actions : « Enregistrer pour cette offre », « Annuler », « Revenir à mes poids globaux pour cette offre ».
  - Le bouton du bandeau devient « Pondération globale ».
- **Écriture** : `saveJobScoringWeightsAction(offre, poids | null)` (`matching-actions.ts`). L'offre doit être ouverte
  par le recruteur (`requireJobAccess`, ADR 0043), les poids sont validés par `ScaleWeightsSchemas.matching`, et ils
  sont écrits pour le compte de la session seulement.
**Poids par candidat** (demande du même jour : « une pondération par candidat et par offre ») :

- **Niveau le plus précis** : poids du candidat, sinon de l'offre, sinon globaux, sinon par défaut. Ils sont propres au
  recruteur, comme les autres niveaux.
- **Barème** : celui du score du candidat (lu dans son résumé) : le matching pour un candidat de la base ou du vivier,
  le score final pour une candidature. Un candidat peut avoir des poids pour chacun des deux barèmes.
- **Clé du candidat** (`candidateWeightsKey`) :
  - `a:<candidature>`, la même au Matching IA et au pipeline ;
  - `p:<profil du candidat>` pour la base candidats (la ligne du matching change d'identifiant à chaque calcul) ;
  - `v:<CV du vivier>`.

  Un candidat de la base ajouté au funnel devient une candidature : ses poids de matching ne la suivent pas, le score
  final étant un autre barème.
- **Document** : identifiant `jw` + sha256(compte:offre:clé), attribut `candidate` = la clé, `weights` = les barèmes
  réglés (`mergeOverride`). Retirer le dernier barème supprime le document. L'enregistrement relit puis réécrit le
  document sans verrou : deux enregistrements simultanés des deux barèmes d'un même candidat (deux onglets) peuvent en
  perdre un. La perte reste limitée aux poids de ce recruteur pour ce candidat ; c'est accepté.
- **Poids illisibles** (critère du barème changé depuis, panne de lecture) : ceux du niveau au-dessus s'appliquent, et
  le Matching IA comme le pipeline l'annoncent (`candidatesUnreadable`, `jobUnreadable`).
- **Où** (choix de l'utilisateur : Matching IA et pipeline) :
  - Matching IA : section « Pondération de ce candidat » dans le détail du candidat (colonne de droite ; sous 90rem,
    dans sa carte).
  - Pipeline : dans la fenêtre « Modifier » de la carte (« Tags, note, pondération » du panneau du candidat), à toutes
    les largeurs.
  - Composant commun : `weights-override-panel.tsx` (`CandidateWeightsPanel`, `JobWeightsPanel`).
- **Comparaison** (choix de l'utilisateur) : la liste trie par le score de chacun, même calculé avec ses propres poids.
  Une pastille « Pondération propre » le signale : au score de la ligne et du détail au Matching IA, et sur la carte et
  le panneau au pipeline.
- **Recalcul sans rechargement** :
  - au Matching IA, la liste est relue (`getMatchesAction`), le candidat choisi reste ouvert ;
  - au pipeline, le score et l'avis de la carte sont recalculés sur place à partir du score et de l'avis enregistrés
    (`storedScore`, `displayedScreening`).
- **Écriture** : `saveCandidateScoringWeightsAction(offre, clé, barème, poids | null)`. L'offre doit être ouverte par
  le recruteur (`requireJobAccess`), la clé bien formée (`isCandidateWeightsKey`) et les poids valides.
- **Garde-fous** (revue de sécurité du même jour) :
  - Le candidat doit être l'un de ceux que la page montre pour cette offre (`candidateOfJob`), avec les mêmes règles
    que la page : sa candidature à l'offre, sa ligne de la base candidats, ou un CV du vivier du recruteur.
  - Au plus 200 candidats pondérés par recruteur et par offre (`MAX_WEIGHTED_CANDIDATES`). La lecture est une seule
    requête bornée.

  Raison : chaque clé crée un document lu à chaque affichage de l'offre, et l'inscription d'un recruteur est libre.
  Une lecture paginée avec `Query.select` sans `$id` relisait la même page sans fin ; `listAllDocuments` échoue
  désormais dans ce cas au lieu de boucler.

- **Suppressions** : les poids d'une offre supprimée le sont aussi (`deleteWeightsOfJob`, à côté de
  `deleteJobClients`), ainsi que ceux d'un compte supprimé par l'admin ou retiré d'une équipe (`deleteWeightsOfUser`).
  Ces deux suppressions ne bloquent jamais : un échec est journalisé.
- **Identifiant d'offre validé** (revue de sécurité du même jour) : le SDK colle l'identifiant dans l'URL sans
  l'encoder. Un identifiant reçu du navigateur contenant « # », « ? » ou « ../ » passait donc le contrôle d'accès en
  faisant lire un autre document avec la clé d'administration. `getJobById` refuse désormais tout ce qui n'est pas un
  identifiant Appwrite (`isDocumentId`), ce qui protège toutes les pages et actions qui l'utilisent.

## Conséquences

- **Affichage** : tous les scores affichés aux recruteurs (Matching IA, pipeline, « Réponse client ») sont recalculés
  aux nouveaux poids sans nouvel appel d'IA, y compris ceux enregistrés avant le changement.
- **Scores enregistrés** : ils ne changent qu'au prochain calcul (« Rafraîchir », nouvelle candidature, passage du
  vivier général). C'est le cas du seuil de 65, des e-mails automatiques (70 et plus), du sourcing des AO, du tableau
  de bord et du reporting.
- **Écart avec les poids du tableau des recruteurs** : le poste pèse désormais plus que tout le reste, et l'ADR 0036
  (« rouge = poids fort ») ne s'applique plus à la formation ni à la langue.
- **Mise en place** :
  1. `npm run schema:push` sur DEV puis sur la production (création de `job_scoring_weights`) ;
  2. `APPWRITE_COLLECTION_JOB_SCORING_WEIGHTS=job_scoring_weights` dans l'environnement de chaque serveur ;
  3. déploiement.

  Sans les étapes 1 et 2, tout marche sauf le réglage par offre.

## Retour arrière

- **Poids par défaut** : revenir à `CURRENT_WEIGHTS_VERSION = 1`. Les résumés notés « Poids v2 » restent lisibles tant
  que la version 2 reste dans `WEIGHT_VERSIONS`.
- **Poids par offre** : vider la variable ; la collection peut rester.
