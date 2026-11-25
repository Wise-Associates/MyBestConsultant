# 0061. Classement des offres pour le préfiltre de la base candidats

Date : 2026-11-25. Statut : accepté. Complète l'ADR 0044 (classification des CV, index et préfiltre).

## Contexte

Le préfiltre de la base candidats (`prefilterPool`, ADR 0044 phase 2) choisit les 15 CV notés par l'IA d'après le titre
de l'offre, ses compétences et sa ville. Les CV sont classés (famille de métier, secteurs, métiers), les offres non :
la famille et les secteurs, filtrables dans l'index, ne servaient pas. Le titre d'un appel d'offres est souvent loin du
métier (« Lot 2. Expert… », « Pilotage Risques & Qualité »). Demande de David (2026-11-24) : la classification doit
« donner plus de poids aux offres ».

## Décision

- **Classement de l'offre au moment du matching**, seulement quand le préfiltre tourne (Meilisearch configuré) :
  famille de métier, 0 à 3 secteurs du client, 1 à 3 intitulés usuels du métier, sur les mêmes listes fermées que les
  CV (`JOB_FAMILIES`, `SECTORS`). Consigne et lecture de la réponse : `src/lib/job-classification.ts` (pur, testé) ;
  appel : `classifyOffer` (`src/lib/job-classify.ts`), même modèle que la classification des CV (ligne « Classification
  des CV » de Config IA, Claude Haiku, effort bas, repli habituel), sur l'intitulé, les compétences, la description et,
  pour un AO, son texte d'origine (ADR 0059). Gardé en mémoire du processus une heure par texte d'offre (« Rafraîchir »
  fait deux passages) ; **rien n'est enregistré**.
- **Préfiltre** (`offerSearchQueries`, `preScore`, `cv-search.ts`) : en plus du titre et des compétences, une requête par
  intitulé du classement et le titre limité aux CV de la même famille (famille de la liste fermée seulement, jamais
  « autre ») ; au pré-score, le métier est reconnu par le titre ou un intitulé du classement, avec un bonus de 0,10 pour
  la même famille et de 0,05 pour un secteur en commun (`CLASSIFICATION_BONUS`).
- **Offre non classée** (IA indisponible ou réponse illisible, journalisé `[classification]`) : préfiltre exactement
  comme avant.
- **Pas de collection** : le classement ne sert qu'au préfiltre. Une collection `job_classifications` (classement à la
  création, statistiques sur les offres, critère « secteur » de la notation) reste possible si un usage le demande.
- **Vivier général non concerné** : un CV y est comparé à toutes les offres ouvertes à la fois ; l'ordre des offres n'y
  change rien.
- **Notation non concernée** : donner la famille et les secteurs de l'offre à l'IA de notation touche les mêmes fichiers
  que la tâche « critères du matching visibles », confiée à un autre développeur ; à faire après elle.

## Conséquences

- Un appel d'IA de plus par passage de matching de la base candidats (environ 0,001 $ avec Claude Haiku), seulement là
  où le préfiltre tourne (production ; en local, le service `meilisearch` de `docker-compose.yml`).
- Le classement d'une offre modifiée est refait (autre texte) ; un redémarrage du serveur vide le cache.

## Essai (DEV, 2026-11-25)

Index Meilisearch local, 176 CV classés de DEV (151 candidats de la base) ; 5 offres de DEV (3 AO, une offre de
cybersécurité, une de développement) ; les 15 CV du préfiltre sans puis avec le classement, notés par `cvScorer`
(barème du matching, modèle « Matching IA » de DEV, sans cache, aucune écriture), chaque CV noté une fois par offre.

| Offre | 65 et plus sans | 65 et plus avec | Moyenne sans | Moyenne avec |
|---|---|---|---|---|
| Pilotage Risques & Qualité (AO) | 0 | 0 | 35 | 32 |
| Responsable d'équipe MOE/AMOA (AO) | 1 | 4 | 51 | 56 |
| Chef de projet Data (AO) | 2 | 2 | 52 | 55 |
| Expert sécurité OpenShift | 0 | 0 | 25 | 26 |
| Développeur Fullstack .NET | 0 | 0 | 33 | 36 |
| **Total** | **3** | **6** | **39** | **41** |

Gain réel mais concentré sur une offre : la base de DEV est petite et n'a pas de bon candidat pour trois des cinq
offres, que le préfiltre ne peut pas inventer. À remesurer sur la base de production.
