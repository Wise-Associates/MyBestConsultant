# 0061. Critères de matching d'une offre, réglés avant la publication d'un AO

Date : 2026-11-24. Statut : accepté, phases 1, 2 et 3 livrées. Complète l'ADR 0036 (barèmes), l'ADR 0044
(cache et préfiltre) et l'ADR 0049 (poids par offre et par candidat).

## Contexte

Demande du 2026-11-24 : avant de publier un appel d'offres, régler les critères sur lesquels les CV seront notés —
contexte, poste recherché, secteur, expérience… —, chacun avec un poids. Ces critères sont la pondération **générale**
de l'offre, la même pour tous ses recruteurs. Un recruteur peut ensuite faire la sienne pour l'offre, puis pour un
candidat. Enfin, après le préfiltre de l'index de recherche, filtrer comme MBC Search pour ne noter par l'IA qu'un petit
nombre de CV.

Choix de l'utilisateur (même jour, sur proposition) :

- les dix critères du barème « matching » comme point de départ, avec la possibilité d'en **retirer** et d'en
  **ajouter** ; total des poids **exactement 100** ;
- des **sous-libellés** pondérés dans un critère : pour un poste « développeur Java Angular », Java 70 et Angular 30
  (total 100 dans le critère) ;
- les poids généraux de l'offre servent à l'affichage **et** aux traitements automatiques (top 5 du sourcing à 65 ou
  plus, alertes, correspondances IA) ;
- après la publication, les critères généraux se modifient par ceux qui peuvent modifier l'offre (ADR 0043) ;
- un recruteur pourra changer, pour lui, les poids **et** les libellés ; un changement de libellés renote les candidats
  automatiquement ;
- le filtre après le préfiltre garde **10** CV pour l'IA (15 aujourd'hui) ;
- ordre : 1) critères et notation, 2) filtre, 3) modification après publication et critères propres à un recruteur.

Le résumé enregistré d'un score du barème (« Poids v2 · Poste : oui · Techno : 6 sur 9 · … ») garde le jugement de
chaque métier du titre, mais seulement un compte pour les technologies et les exigences : il ne permet pas de recalculer
un score avec des poids par libellé.

## Décision (phase 1)

**Critères d'une offre** (`src/lib/offer-criteria.ts`, pur, testé) : une liste de critères — clés du barème
(`poste`, `competences`…) ou critères ajoutés (`x1`, `x2`…, nom saisi) —, chacun avec un poids entier (total 100) et 0 à
12 libellés (4 au plus pour le poste, autant que de métiers jugés), chacun avec un poids entier (total 100 dans le
critère) et « requis » (★). Plus jusqu'à 6 autres intitulés du métier, pour la recherche des CV (phase 2). Validés par
`CriteriaSetSchema` à chaque écriture et à chaque lecture : un total faux est refusé, jamais corrigé en silence ; un
ensemble trop long pour son attribut (20 000 caractères) aussi. Les libellés (160 caractères, une exigence de la
description entière) perdent les séparateurs du résumé (`cleanLabel`). Les libellés des critères « rouges » à une valeur
du barème — lieu, séniorité, formation, secteur, langue — sont **requis par défaut** (critères par défaut et proposés par
l'IA, `REQUIRED_BY_DEFAULT`), le métier principal du poste aussi : sans libellé, leur absence plafonne sous 65 ; un lieu
ajouté comme libellé non requis aurait levé ce plafond sans que personne ne le choisisse (revue de code du même jour :
un candidat d'une autre ville passait de 60 à 78). Retirer ★ reste possible, c'est alors un choix.

**Notation sur critères (format v3)** (`src/lib/criteria-scoring.ts`, pur, testé) :

- L'IA juge **chaque libellé** (oui / partiel / non, ou la valeur neutre des critères à une valeur), avec les mêmes
  preuves vérifiées dans le CV et la même comparaison des intitulés que le barème (ADR 0028). Un critère sans libellé est
  jugé d'ensemble, comme avant ; un critère ajouté sans libellé est jugé sur son nom.
- **Seuls les libellés partent à l'IA**, jamais les poids ni ★ : une notation (et le cache de l'ADR 0044) vaut pour
  toute pondération des mêmes libellés.
- Le code calcule le score : part de chaque critère = somme des poids de ses libellés × points du jugement ; plafonds :
  un libellé ★ jugé « non » plafonne à 50 (métier du poste) ou 60 (autre), un métier ou un secteur ★ seulement
  « partiel » à 75 / 80, des technologies listées couvertes à moins d'un tiers à 60 ; un critère sans libellé garde les
  plafonds du barème.
- **Résumé enregistré compact** : `Critères v1#<empreinte> · on · op · o · o — <phrase de l'IA>`, une lettre par
  jugement (o oui, p partiel, n non, r non requis, s non précisé), un groupe par critère, dans l'ordre. Les raisons sont
  coupées à 300, 500 ou 1 000 caractères selon l'endroit : répéter les libellés aurait dépassé, et un résumé coupé ne se
  relit plus. 14 critères de 12 libellés tiennent en moins de 250 caractères (testé). L'**empreinte** des libellés
  (`criteriaFingerprint`) dit si le résumé vaut pour les critères en vigueur : même empreinte, le score se recalcule
  pour d'autres poids ou ★ sans IA (`criteriaBreakdown`) ; autre empreinte, il est à renoter.
- `criteriaScorer` / `matchingScorer` (`sourcing-core.ts`) : la notation « matching » d'une offre qui a des critères
  passe par eux — base candidats (« Rafraîchir », sourcing automatique), vivier de l'offre, correspondances IA d'un
  nouveau candidat, section Sourcing d'un AO pas encore publié, `npm run matching:explain`. Une offre sans critères est
  notée comme avant (`cvScorer`). Cache : `CachedCriteriaScore` (`score-cache.ts`), relu pour la même empreinte.
- Le score enregistré est celui des poids généraux de l'offre : les seuils automatiques (65, 70) les appliquent donc
  sans autre calcul. Les poids du barème d'un recruteur (globaux, par offre, par candidat) ne s'appliquent pas aux scores
  notés sur critères (`personalScore` rend le score enregistré) : leurs réglages sont masqués sur le Matching IA d'une
  telle offre, qui montre à la place les critères de l'offre et le détail de chaque score par critère.

**Stockage** :

- AO pas encore publié : `ao_offer_details.matchingCriteria` (texte de 20 000, 10/16 attributs).
- Offre publiée : un document de `job_scoring_weights` (ADR 0049) d'identifiant `jc` + sha256(offre), `userId` =
  « @offre » (« @ » n'est pas permis dans un identifiant Appwrite : aucun compte ne peut la porter, et la suppression
  des poids d'un compte la refuse ; il n'apparaît dans aucune lecture des poids d'un recruteur), `weights` = « {} »,
  `criteria` (texte de 20 000, nouvel attribut, 5/16) ; effacé avec les poids de l'offre (`deleteWeightsOfJob`).
  Lecture : `loadOfferCriteria` (`offer-criteria-store.ts`) ; une panne est levée (noter sur le barème une offre qui a
  des critères donnerait des scores d'une autre pondération).

**Avant la publication** (`offer-actions.ts`, page d'un AO des deux espaces) :

- « Préparer la publication » propose les critères : ceux déjà enregistrés pour l'AO, sinon ceux de l'IA (ligne
  « Matching IA » de Config IA ; consigne `criteria-proposal.ts` : libellés, importance relative, ★ pour ce que l'AO dit
  indispensable, autres intitulés ; poids des critères par défaut), en parallèle de la rédaction de la version et **sur
  la même place du quota** ; IA refusée ou en échec, ou « Publier sans anonymiser » (sans IA) : critères par défaut
  (métier du titre requis, compétences, exigences de la description).
- Éditeur « Critères de matching » (`src/components/ao/criteria-editor.tsx`) dans le formulaire de relecture : poids,
  libellés, ★, critères ajoutés ou rétablis ; ajouter ou retirer garde le total à 100 (les autres en proportion) ; « Ramener
  à 100 ». « Enregistrer les critères » (`saveCriteria`, appelant vérifié dans les deux fichiers d'actions, AO de son
  organisation, pas encore publié) les garde pour la section Sourcing. « Publier » attend des critères valides ; ils ne
  sont jamais publiés, les modifier ne décoche pas « J'ai relu ».
- À la publication, les critères sont validés (`parsePublishInput`), puis enregistrés pour l'offre publique et pour l'AO
  **avant** le sourcing automatique, qui note sur eux. Enregistrement impossible : l'offre reste publiée, notée sur le
  barème, et la page le dit.

**Confidentialité** : les critères sont montrés à ceux qui ouvrent l'offre publiée (son organisation ; pour un AO de la
plateforme, publié sous l'organisation « admin », l'admin seulement à ce jour). Une version anonymisée ne doit pas y
laisser le client, pour le jour où l'offre serait montrée plus largement : l'IA qui les propose reçoit l'AO aux noms du
client remplacés (« le client »), comme celle de la version publiée ; la relecture signale en rouge un nom du client
dans les critères ; la publication est refusée si un libellé, un nom de critère ou un autre intitulé nomme encore le
client — noms connus et noms retirés par l'IA de la version, comme pour le texte publié (revue de sécurité du même
jour). Le nom d'un critère ajouté, saisi dans le navigateur, ne va pas dans les consignes de la notation, seulement dans
les critères de l'offre du message (données).

**Correctif lié** : le dernier sourcing d'un AO était enregistré coupé à 5 000 caractères, au milieu du JSON : illisible,
il passait pour jamais fait. Il est maintenant raccourci (raisons, puis derniers candidats) et toujours entier
(`sourcing-json.ts`, testé).

## Décision (phase 2) : filtre des CV après le préfiltre

« Appliquer l'approche de MBC Search pour n'avoir qu'un minimum de candidats à noter » : `prefilterPool`
(`src/lib/search/prefilter.ts`) passe par `src/lib/search/offer-filter.ts` (pur, testé) pour la base candidats.

- **Recherches** (une requête groupée à l'index) : le titre de l'offre, les métiers du poste et leurs autres intitulés
  (6 au plus), puis les technologies, ★ d'abord (12 au plus). Comme MBC Search (ADR 0037) : plusieurs recherches réunies
  sans doublon.
- **Filtre** sur les champs classés de chaque CV (ADR 0044), d'après les ★ des critères. Chaque vérification répond
  oui, non ou **inconnu** : une valeur absente du CV (ville, années, secteurs, langues, métiers, compétences), ou un
  libellé que le code ne sait pas lire (« France », « Hybride », « Télétravail »), n'écarte jamais et compte pour moitié
  dans le pré-score. Un CV écarté à tort n'est jamais noté : les comparaisons sont tolérantes (revue de code du même
  jour) :
  - métier : un intitulé de deux mots ou moins retrouvé entier dans un métier exercé, les deux tiers au-delà (pluriel
    ramené au singulier, « C » et « R » gardés) ; les autres intitulés valent pour le premier métier ;
  - technologies : forme compacte (« Spring Boot » = « SpringBoot », « Node.js » = « NodeJS ») et synonymes de l'index
    (« JS » = « JavaScript ») ; un libellé composé (« Java/Angular ») demande chacune de ses parties ;
  - ville : même ville ou une ville de la même région (`regions.ts`, comme le jugement de l'IA), ville du CV comparée
    entière (« Saint-Denis » ≠ « Saint-Étienne ») ;
  - séniorité : années minimales (« 5 ans et plus » ; borne basse d'une fourchette, « 3-5 ans » ; « Senior » 8), une de
    moins tolérée, l'IA jugeant « partiel » ;
  - secteur (clés de l'index) et langue (noms anglais ramenés au français).
  Plusieurs villes ou secteurs ★ sont des alternatives (l'un suffit) ; plusieurs métiers, technologies ou langues ★
  sont tous exigés.
- **Assouplissement**, comme MBC Search garde ses compétences ★ partout : ★ tous ; puis sans la ville ; puis sans la
  séniorité ; puis sans le secteur ni la langue ; puis sans le métier. Les **technologies ★ ne sont jamais assouplies** :
  absentes, elles plafonnent le score sous 65, noter le CV paierait un appel pour un candidat qui ne correspondra pas.
- **Pré-score aux poids de l'offre** (libellés compris : Java 70 / Angular 30) sur ce que l'index mesure (poste,
  technologies, lieu, séniorité, secteur, langue) ; les CV sont classés par niveau d'assouplissement, puis par pré-score.
- **10 CV** (`PREFILTER_KEEP`, 15 avant) passent à l'IA, revérifiés dans Appwrite. **Seuls ceux-là sont notés** : les plus
  récents ne complètent plus la liste (ils auraient repris des CV que le filtre écarte), sauf si l'index ne connaît aucun
  CV pour l'offre (index vide, CV pas encore classés ; quand tous les CV trouvés sont déjà notés, une requête d'un
  résultat le vérifie : personne de nouveau, rien n'est complété). Messages : tous écartés faute d'une technologie ★,
  « Aucun candidat de la base n'a les technologies requises (★) de l'offre » ; CV retenus devenus indisponibles
  (supprimés, désinscrits), « Les CV retenus pour cette offre ne sont plus disponibles ». Préfiltre absent ou en panne :
  comme avant (30 plus récents).
- Une offre sans critères est filtrée sur ses critères par défaut (métier du titre et ville requis, poids du barème).
- Le recalcul des candidats déjà notés (« Rafraîchir », mode `all`) ne passe pas par le filtre : il renote ceux qui le
  sont.

Non concernés : les viviers (CV notés un à un à leur import), le choix des offres d'un nouveau candidat (correspondances
IA, `preScore`), le vivier général.

## Décision (phase 3) : critères après la publication, critères propres d'un recruteur

Sur le Matching IA d'une offre (`/recruiter/pipeline/<offre>/matching`), colonne de droite (`CriteriaPanel`,
`criteria-detail.tsx`) :

- **Critères de l'offre** (onglet « De l'offre ») : modifiables par ceux qui peuvent modifier l'offre (même règle que
  « Modifier » : offre de l'organisation, un membre seulement les siennes ; `saveOfferCriteriaAction`), en lecture pour
  les autres. Une offre publiée sans critères (AO d'avant, offre saisie, importée) en reçoit ainsi, à partir de ses
  critères par défaut. Après l'enregistrement, en arrière-plan (`rescoreGeneral`, `src/lib/criteria-rescore.ts`) :
  libellés changés, **renotation automatique** (choix de l'utilisateur) des candidats déjà notés de la base et des CV
  des viviers de l'offre (120 au plus chacun) ; elle ne trouve rien dans le cache des notations (autres consignes) et
  coûte un appel d'IA par candidat : adresse vérifiée et une place du quota ci-dessous (revue de sécurité du même jour :
  sans quota, des enregistrements répétés faisaient payer l'IA sans limite) ; poids ou ★ seuls, gratuits, scores enregistrés recalculés
  sans IA avant la réponse (`rescoredStored`) pour que les seuils automatiques (65, 70) suivent. Tant qu'un score est
  noté sur les anciens libellés (renotation en cours, ou interrompue par la durée de la requête), il reste affiché, marqué
  « Score calculé sur les anciens critères de l'offre » (`criteriaStale`) : « Rafraîchir » termine la renotation.
- **Mes critères** (onglet « Les miens ») et **critères pour un candidat** (détail d'un candidat, « Critères pour ce
  candidat ») : propres au recruteur, poids, ★ **et libellés** (choix de l'utilisateur). Ordre : candidat, sinon les
  miens pour l'offre, sinon ceux de l'offre (`rowCriteria`, `src/lib/criteria-view.ts`, testé). Gardés dans
  `job_scoring_weights`, documents `jk…` (à part des poids `jw…` : retirer ses poids ne retire pas ses critères),
  lus avec les poids (`loadWeightsForJob`). Pas pour une candidature (score final).
- **Mêmes libellés que l'offre** : score recalculé à l'affichage sur le jugement enregistré, sans IA.
  **Autres libellés** : il faut un jugement de l'IA pour eux. Collection **`criteria_judgements`** (un document par
  offre, empreinte des libellés et candidat ; résumé v3 et phrase de l'IA ; partagé par les recruteurs aux mêmes
  libellés ; `criteria-judgements-store.ts`), remplie en arrière-plan à l'enregistrement (`judgeOnCriteria` : base
  candidats notés pour l'offre et CV du vivier de l'offre de ce recruteur, 40 au plus par passage ; un seul candidat pour
  des critères de candidat), puis « Noter la suite » (`judgeOwnCriteriaAction`). En attendant, le score de l'offre est
  affiché, marqué « Notation sur vos critères en cours » (`criteriaPending` ; un candidat de la base sans CV, jamais
  jugeable, ne l'est pas). Chaque notation sur des libellés propres exige l'adresse e-mail vérifiée et une place du quota
  du jour : 20 par organisation, 200 pour toutes (`CRITERIA_JUDGE_DAILY_LIMITS`, compteurs `criteriaJudgeOrg` /
  `criteriaJudgeAll`, partagés avec les changements de libellés de l'offre) ; seulement pour des libellés nouveaux pour
  ce recruteur (`needsJudging` : changer un poids ou ★ de
  ses libellés ne coûte rien), rendue si l'enregistrement échoue ou s'il n'y a personne à juger ; « Noter la suite » ne la
  prend que s'il reste quelqu'un à juger. La page reprend la liste du serveur après chaque enregistrement ou « Actualiser »
  (sans se remonter : onglet et messages gardés).
- Les scores enregistrés (seuils automatiques, e-mails, alertes, top 5 du sourcing) restent ceux des critères de l'offre ;
  les critères propres ne changent que ce que voit le recruteur (comme ses poids, ADR 0049).
- Jugements effacés avec l'offre (les deux chemins de suppression) et avec le candidat (compte : `p:`, CV du vivier :
  `v:`) ; un jugement écrit pendant la suppression de son candidat ou de l'offre est retiré aussitôt. Un candidat
  désinscrit des approches (ou sans CV) n'est jamais jugé (`isAutoMatchable`, comme les autres notations de la base).
- Critères propres : seulement sur une offre de l'organisation du recruteur ; ses jugements ne sont donc jamais partagés
  avec une autre organisation.

L'éditeur (`src/components/ao/criteria-editor.tsx`) sert aux deux pages : chaque couleur lit le jeton du back-office
clair (`--admin-*`), sinon celui du site.

## Limites connues

- Le score final (candidatures, screening, candidats ajoutés au funnel) reste sur son barème.
- Le vivier général (lots de 5 offres, `scoreCvAgainstOffers`) reste sur le barème : ses correspondances (65 ou plus)
  d'une offre à critères sont jugées sans eux.
- L'e-mail d'alerte au recruteur garde la phrase de l'IA, sans les critères faibles, pour un score noté sur critères.
- Les offres publiées avant ce changement n'ont pas de critères : notées sur le barème tant que personne ne leur en
  donne (Matching IA, phase 3).
- Critères propres : les CV du vivier général (correspondances de lots, barème) et les candidatures (score final) ne sont
  pas renotés sur eux ; un recruteur voit leur score habituel.
- Les jugements des anciens libellés propres (après un changement) restent jusqu'à la suppression de l'offre.

## Mise en place (ordre impératif)

1. **DEV, avant de pousser `pre-dev`** (la preview se déploie seule) : `npm run schema:check -- dev` doit montrer
   exactement ces lignes « + » et aucune ligne « ✗ », « · » ou « ! » :
   `+ ao_offer_details.matchingCriteria`, `+ job_scoring_weights.criteria`, `+ criteria_judgements : collection créée`
   (`$permissions : []`, `documentSecurity : false`). Puis `npm run schema:push -- dev` dans un terminal ; dans la
   console, les deux attributs, les quatre attributs de `criteria_judgements` et ses deux index « available »
   (`schema:check` ne regarde l'état que des index) ; le fichier repris de DEV montre les mêmes ajouts.
2. **Ensuite seulement** la variable `APPWRITE_COLLECTION_CRITERIA_JUDGEMENTS=criteria_judgements` (fichier local,
   portée Preview de Vercel), puis `git push origin pre-dev`.
3. **Production, avant « Déployer en production »**, par un humain : sauvegarde de la base ; `schema:check -- prod` ne
   doit montrer que les ajouts ci-dessus — si `job_scoring_weights` n'existe pas encore en production, la ligne est
   `+ job_scoring_weights : collection créée` (ADR 0049) ; toute autre ligne : s'arrêter ; `schema:push -- prod`,
   « available » dans la console ; `APPWRITE_COLLECTION_JOB_SCORING_WEIGHTS` et `APPWRITE_COLLECTION_CRITERIA_JUDGEMENTS`
   dans `/etc/mybestconsultant/app.env` ; déploiement ; `schema:check -- prod` ne montre plus aucune différence.

**Code déployé avant la structure** :

- sans `job_scoring_weights.criteria`, la lecture des poids d'un recruteur (qui lit cet attribut) échoue : ses poids par
  offre et par candidat (ADR 0049) ne s'appliquent plus et la page les dit illisibles ; la publication d'un AO enregistre
  ses critères en vain (« Unknown attribute ») — l'offre est publiée, notée sur le barème avec un avis, **ses critères
  sont perdus** ;
- sans la collection mais avec sa variable : les libellés propres sont enregistrés, leur notation échoue (place du quota
  rendue), les scores restent « en cours » ; les suppressions journalisent l'erreur.

**Ne pas vider `APPWRITE_COLLECTION_CRITERIA_JUDGEMENTS`** tant que la collection contient des jugements : leur
suppression avec l'offre, le compte du candidat et son CV du vivier en dépend (ce sont des appréciations de l'IA sur des
CV).

**Retour arrière** (dans la même opération que le retour sur le code) : exporter si besoin, puis supprimer tous les
documents de `criteria_judgements` (données dérivées, recalculables) et les documents `jk…` de `job_scoring_weights` —
l'ancien code lirait leurs poids « {} » comme illisibles. Laisser les attributs et la collection (l'ancien code les ignore
; les supprimer avec leurs données demanderait une sauvegarde). Avec l'ancien code, les raisons au format « Critères v1#… »
s'affichent brutes jusqu'à leur prochain calcul (« Rafraîchir »).

**Risques acceptés** : l'empreinte des libellés fait 32 bits (FNV-1a, `criteriaFingerprint`) ; deux jeux de libellés
différents qui la partageraient partageraient leurs jugements (affichage seulement, au sein de l'organisation de l'offre :
les offres partagées par la plateforme n'ont pas de critères). L'attribut `fingerprint` est dimensionné à 16 caractères
pour l'élargir plus tard sans recréation. Les jugements propres ne sont pas refaits quand le CV d'un candidat ou le texte
de l'offre change ; ceux d'anciens libellés restent jusqu'à la suppression de l'offre. Plusieurs changements de libellés
de l'offre rapprochés lancent chacun leur renotation (chacun prend sa place du quota).
