# 0044 — Matching : cache, classification des CV et préfiltre avant l'IA

- Statut : accepté (phases 1 à 3 faites ; restent le texte gardé des CV et la recherche par le sens)
- Date : 2026-11-18
- Complète : [0029](0029-une-seule-notation.md) (une seule notation), [0036](0036-matching-et-score-final.md) (deux barèmes)

## Contexte

Demande de l'utilisateur du 2026-11-17 : ne plus repasser sur tous les CV à chaque matching, réduire les jetons envoyés à
l'IA, préfiltrer avant toute notation, et tirer des statistiques des CV (compétences, métiers…). Question posée :
Elasticsearch, Meilisearch, ou autre ?

État du matching au 2026-11-18 :

- Une notation = un appel d'IA par CV (`cvScorer`, `src/lib/sourcing-core.ts`) : consignes (≈ 5 600 caractères pour le
  barème « matching »), offre, CV (fichier relu et retranscrit à chaque fois, coordonnées masquées, 12 000 caractères au
  plus) ; réponse jusqu'à 8 000 jetons (une citation du CV par jugement), puis une seconde question courte sur les
  intitulés (`withCheckedTitles`). Le code calcule le score (ADR 0028, 0036).
- **Base candidats sans préfiltre** : chaque passage note les **30 candidats inscrits le plus récemment** ;
  « Rafraîchir » renote jusqu'à 120 candidats déjà notés puis prend les 30 suivants. Un bon profil inscrit il y a
  longtemps n'est atteint qu'après plusieurs passages payés.
- **Rien n'est réutilisé** : consignes et offre, identiques pour tous les CV d'un passage, renvoyées à chaque appel ;
  « Recalculer » repaie des CV et des offres qui n'ont pas changé. Le profil structuré extrait au dépôt d'un CV
  (`cvProfileJson` : compétences, expériences, années, langues) ne sert pas à choisir qui noter.

## Décision

Trois phases.

### Phase 1 — sans nouvelle infrastructure (en cours)

1. **Cache des notations** (fait) : collection `score_cache`, un document par notation, d'identifiant déduit de tout ce
   qui la détermine — version du cache, modèle du module « matching » (fournisseur et nom du modèle), barème, consignes,
   offre et texte du CV tels qu'envoyés (`scoreCacheId`, `src/lib/score-cache.ts`, testé). Le même CV pour la même offre
   inchangée, avec les mêmes consignes et le même modèle, n'est plus renoté : « Rafraîchir », « Recalculer » et
   « Relancer » ne repaient que ce qui a changé. Tout changement (offre modifiée, consignes, modèle, extraction du CV)
   donne un autre identifiant : jamais un score périmé.
   - Gardé seulement s'il vient du modèle choisi (pas d'un modèle de repli) et que sa réponse a été lue ; un échec
     n'est jamais gardé (la notation suivante réessaie).
   - **30 jours** au plus (`SCORE_CACHE_TTL_DAYS`) : au-delà, ignoré à la lecture et effacé par la purge faite au fil
     des écritures (au plus une fois par heure et par serveur, 100 documents à la fois) : le cache contient des
     citations des CV (données personnelles, coordonnées masquées).
   - Panne du cache (lecture ou écriture) : journalisée, la notation se fait normalement (simple économie).
   - `npm run matching:explain` ne lit jamais le cache (il sert à voir ce que l'IA répond).
   - Variable `APPWRITE_COLLECTION_SCORE_CACHE` ; vide : pas de cache.
2. **Mise en cache du préfixe chez Claude** (fait) : consignes et offre forment le début, identique, de chaque appel
   d'un passage ; il est marqué pour le cache de prompt d'Anthropic (`cachePrefix` de `callLLM`, bloc de texte séparé
   devant le CV). Les appels suivants le paient environ 10 % du prix (écriture : 1,25×, 5 minutes). Sans effet sur les
   autres fournisseurs (texte envoyé identique). Les 5 premiers appels d'un passage, simultanés, écrivent chacun le
   cache ; les suivants le lisent.
3. **Classification des CV** (fait le 2026-11-18, choix de l'utilisateur : **Claude Haiku**, `claude-haiku-5-5`, effort
   bas ; **GPT-4o mini** quand Claude ne répond pas — élargi le même jour à la demande de l'utilisateur, d'abord limité
   aux crédits épuisés : crédits, clé refusée, modèle introuvable, Claude non configuré, service saturé ou en panne,
   injoignable, sans réponse dans le délai (`claudeUnavailableReason`, `src/lib/ao/ai-failures.ts`, testé) ; une requête
   refusée pour elle-même (400, 413…) n'est pas rattrapée par l'autre modèle, qui ne la réparerait pas : le CV reste à
   classer ; les deux modèles en échec : `LLMChainError`, cause de chacun dans le journal). Le repli envoie le texte du
   CV (coordonnées masquées) chez OpenAI pendant une panne de Claude. Champs normalisés (`src/lib/cv-classification.ts`, testé) :
   métiers exercés, famille de métiers, années d'expérience et séniorité (déduite par le code : moins de 3 ans junior, 3 à
   7 confirmé, 8 à 14 senior, 15 et plus expert), compétences, secteurs, clients, langues et niveaux, ville, pays, TJM,
   disponibilité, niveau d'études, certifications, résumé de 3 phrases sans nom ni coordonnées. Listes fermées (famille,
   secteurs, niveaux) pour des statistiques comparables ; toute valeur hors liste est ramenée à « autre » / « non
   précisé ».
   - Une fois par **version de CV** : l'identifiant du fichier (immuable), ou l'empreinte du texte d'un profil sans
     fichier ; `CLASSIFICATION_VERSION` à changer quand les consignes changent (tout est alors refait).
   - Texte envoyé : celui de la notation (coordonnées masquées). Les CV partent chez Anthropic, ou chez OpenAI en repli,
     comme pour la notation aujourd'hui.
   - Collection **`cv_classifications`** (une par CV source, identifiant déduit de la source) plutôt que `cvProfileJson`
     (20 000 caractères déjà pris par le profil, et réécrit par plusieurs dépôts) : `src/lib/appwrite/cv-classifications.ts`.
     Organisation (vivier) et propriétaire (recruteur du vivier, chasseur) gardés pour filtrer plus tard.
   - **Au dépôt**, en arrière-plan (`after`, jamais bloquant, `classifySourceInBackground`, `src/lib/cv-classify.ts`) :
     CV d'un candidat, CV ou profil MBC Search ajouté au vivier, profil de chasseur créé, importé ou modifié.
   - **Effacée avec sa source** : compte supprimé (admin), profil de chasseur supprimé, CV du vivier supprimé ; un reste
     (échec) est effacé par le script.
   - **Rattrapage** : `npm run cv:classify -- <env> [--apply] [--prod] [--limit N]` — simulation par défaut (comptes,
     aucun appel d'IA), DEV seulement sans `--prod`, 4 CV à la fois, arrêt après 10 échecs d'affilée, idempotent ; efface
     aussi les classifications sans CV. Production : lancé par un humain.
   - Variable `APPWRITE_COLLECTION_CV_CLASSIFICATIONS` ; vide : rien n'est classé.
   - Reste à faire : garder le texte retranscrit des CV (ne plus relire les fichiers) — utile surtout à l'index (phase 2).

### Phase 2 — index de recherche : Meilisearch

**Meilisearch** auto-hébergé (conteneur sur le VPS, réseau interne, jamais exposé au navigateur), et non
Elasticsearch/OpenSearch : à l'échelle de la plateforme (milliers à dizaines de milliers de CV, un VPS qui porte déjà
Appwrite et l'application), Elasticsearch demande une JVM (2 à 4 Go de RAM) et un réglage dont nous n'utiliserions pas
la force (agrégations complexes). Meilisearch : un binaire, peu de mémoire, français et fautes de frappe, synonymes,
filtres, rayon géographique, comptes par champ (statistiques), recherche hybride mots + embeddings. Typesense
conviendrait aussi (toutes les données en RAM) ; Postgres + pgvector ajouterait une seconde base à synchroniser.

- Un document par CV (base candidats, viviers, profils de chasseurs) avec les champs de la classification et
  l'embedding d'un résumé ; **sans coordonnées** ; filtres d'organisation et de propriétaire (vivier personnel) toujours
  ajoutés par le serveur.
- Appwrite reste la source : index dérivé, mis à jour à chaque dépôt, modification ou suppression de CV, et script de
  réconciliation idempotent (comme `vivier:matches`). Supprimé avec le compte (RGPD).
- **Préfiltre** : l'offre est classée une fois ; une requête (filtres durs + classement mots et sens) donne les 50
  meilleurs de **toute** la base au lieu des 30 plus récents ; un pré-score calculé par le code sur les champs classés
  (mêmes critères que le barème « matching ») garde les 10 à 15 meilleurs pour l'IA. « Rafraîchir » élargit aux suivants.

Mise en œuvre (2026-11-18, phase 2 a) :

- **Meilisearch v1.56.2** (empreinte fixée ; v1.57.0 n'avait que deux jours), conteneur `mbc-search`
  (`deploy/compose.search.yml`) : système en lecture seule, aucun droit, 1 Go de mémoire, réseau interne `mbc` sans port
  publié ; démarré par `mbc-deploy search` (jamais pendant un déploiement) ; clé maîtresse dans
  `/etc/mybestconsultant/search.env`, l'application n'a qu'une clé limitée à l'index `cvs` et à ses actions
  (recherche, documents, réglages, tâches). Mise en place : `docs/deploiement-vps.md`, « Index de recherche ». Essayé
  en local le 2026-11-18 avec des CV fictifs (réglages, filtres, synonymes, suppressions, clé limitée, conteneur en
  lecture seule).
- **Client sans dépendance** (`src/lib/search/meili.ts`, API REST, délais, erreurs avec le message de Meilisearch) ;
  règles pures `src/lib/search/cv-search.ts` (testées) : document d'un CV (la classification, la source, l'organisation,
  le propriétaire, le rôle, la désinscription ; **ni nom ni coordonnée**), réglages (champs cherchés : métiers,
  compétences, certifications, résumé, clients ; français ; synonymes des sigles courants), filtres.
- **Mise à jour** : un CV classé entre dans l'index (`indexClassifiedCv`), une classification effacée en sort
  (`removeCvFromIndex`), sans bloquer ; `npm run search:sync -- <env> [--apply] [--prod]` applique les réglages et remet
  l'index d'accord avec `cv_classifications` (idempotent).
- **Préfiltre de la base candidats** (`prefilterPool`, `src/lib/search/prefilter.ts`) : une requête pour le titre de
  l'offre et une par compétence demandée (12 au plus), filtrées (candidats, non désinscrits, hors candidats qui ont
  postulé ou déjà notés) ; résultats réunis puis classés par un **pré-score du code** (métier 45 %, compétences 45 %,
  ville 10 %) ; les **15** premiers (`PREFILTER_KEEP`, au lieu des 30 plus récents) passent à l'IA, après revérification
  dans Appwrite (CV présent, désinscription, exclusions). Places restantes (moins de CV classés que de places) : les plus
  récents, comme avant. Meilisearch absent ou en panne : comportement d'avant, journalisé.
- Pas encore : recherche par le sens (embeddings, phase 2 b, à décider après les premiers résultats), préfiltre des
  viviers (leurs CV sont notés à l'import, un par un), statistiques (phase 3).

### Phase 3 — statistiques

Page « CV Thèque · Statistiques » par organisation à partir des comptes de l'index : compétences et métiers les plus
présents, séniorité, langues, villes, secteurs, sources, fraîcheur des CV ; tendances par un relevé quotidien.

Mise en œuvre (2026-11-18) : `/recruiter/cvtheque/statistiques` (bouton « Statistiques » de la CV Thèque), deux
périmètres : **base candidats** (candidats de la plateforme, les mêmes pour tous les recruteurs, comme la CV Thèque) et
**mon vivier** (`?perimetre=vivier` : organisation **et** profil de la session, jamais reçus du navigateur ; un vivier
est personnel). Chiffres clés (CV classés, part de seniors et experts, bornes de l'expérience et des TJM indiqués) et
listes : familles de métiers, métiers, compétences (20 premières), séniorité, secteurs, langues, villes, niveau
d'études. Comptes de l'index (facettes, triées par nombre : `faceting` des réglages ; métiers et compétences rendus
filtrables pour être comptés), sans appel d'IA ni nom ; part des CV déjà classés d'après Appwrite pendant le rattrapage.
Règles `src/lib/search/cv-stats.ts` (testées), lecture `src/lib/search/cv-stats-store.ts`. Index absent : message
« pas encore disponibles » ; en panne : « momentanément indisponibles ». Essayé en local avec des CV fictifs (périmètres,
ordres, bornes).

**Fraîcheur et tendances** (2026-11-18, même jour) : chaque document de l'index porte la **date de dépôt du CV**
(`cvDate`, `cvMonth`) — fichier du CV actuel d'un candidat (date du fichier dans le stockage), import d'un CV du vivier,
dernière modification d'un profil sans fichier (`cvDateOf`, `src/lib/cv-classify.ts` ; `search:sync` lit les dates de
tout le bucket des CV en une liste). La date de classement n'aurait rien dit : le rattrapage classe tous les CV le même
jour. La page ajoute : la part des CV de moins d'un an (chiffre clé), les CV déposés chaque mois sur 12 mois (colonnes,
tableau pour les lecteurs d'écran), la fraîcheur (moins de 3 mois, 3 à 12 mois, 1 à 2 ans, plus de 2 ans, date
inconnue) et les **compétences en hausse** : part des CV de moins de 6 mois qui les citent comparée à celle des plus
anciens, s'il y a au moins 10 CV de chaque côté et 3 CV récents qui citent la compétence. Tout se calcule sur les dates
des CV présents : **pas de relevé quotidien** (il ne garderait en plus que l'historique des CV supprimés). Règles pures et
`now` injecté (`cv-stats.ts`, testées). Essayé en local avec des CV fictifs datés.

**Statistiques de la plateforme pour l'admin** (2026-11-18) : `/admin/cvtheque/statistiques` (bouton « Statistiques »
de la CV Thèque de l'admin), périmètres **toute la plateforme**, **base candidats**, **profils de chasseurs**, **viviers
de toutes les organisations** — construits seulement par cette page, après la vérification du rôle d'admin. Même
affichage que la page des recruteurs (`src/components/stats/cv-stats-sections.tsx`, partagé), aux couleurs du
back-office clair (`ADMIN_STATS_VARS` : les jetons `--color-*` pointent vers les `--admin-*`) ; message technique quand
l'index n'est pas configuré. Comptes agrégés, aucun nom. Essayé en local avec des CV fictifs (les quatre périmètres).

**Par organisation** (2026-11-18) : périmètre `tenant`, les viviers de tous les recruteurs d'une organisation.
- Admin : 5e périmètre « Une organisation », choisie dans la liste des organisations (formulaire GET ; seul un
  identifiant de la liste est accepté).
- Page **Organisation** du recruteur (`/recruiter/organisation`, section « Statistiques des CV de l'organisation ») :
  organisation de la session, **propriétaire et administrateurs seulement** (un vivier est personnel ; les comptes
  réunis restent sans nom) ; un membre y trouve le lien vers « Mon vivier ».

## Conséquences

- Phase 1 : `npm run schema:push -- dev` puis prod (avec sauvegarde) pour `score_cache` et `cv_classifications`,
  **puis** les variables `APPWRITE_COLLECTION_SCORE_CACHE=score_cache` et
  `APPWRITE_COLLECTION_CV_CLASSIFICATIONS=cv_classifications` (`.env.example`), puis `npm run cv:classify` (simulation,
  puis `--apply` ; d'abord avec `--limit` pour vérifier une classification). Sans les variables, rien ne change.
- Classification : clés Claude **et** OpenAI dans Config IA pour que le repli fonctionne ; sans clé OpenAI, une panne
  de Claude (ou des crédits épuisés) arrête la classification (journalisé, le script s'arrête après 10 échecs).
- Un recruteur qui « Recalcule » sans que rien n'ait changé obtient le même score (gardé), immédiatement et sans coût ;
  pour une nouvelle réponse de l'IA, il faut changer l'offre (ou attendre 30 jours).
- Gain du cache de prompt à vérifier en production : `usage.cache_read_input_tokens` des réponses de Claude (non
  journalisé aujourd'hui). Le préfixe dépasse le minimum de mise en cache des modèles Claude actuels (≈ 1 500 jetons de
  consignes, plus l'offre).
- Après un déploiement qui change les réglages de l'index (`CV_INDEX_SETTINGS`, ex. phase 3) : `npm run search:sync
  -- <env> --apply` les applique (sinon les statistiques des métiers et compétences restent vides).
- Phases 2 et 3 : un service de plus sur le VPS (mémoire, sauvegarde, mise à jour), décidé quand la phase 1 aura donné
  ses chiffres.
