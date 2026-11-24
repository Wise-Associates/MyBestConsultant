# 0058. Export des exemples d'affinage pour la classification des CV

Date : 2026-11-24. Statut : accepté.

## Contexte

Le banc d'essai du 2026-11-23 (ADR 0057) a montré que Ministral 3 3B, servi sur une RTX 4090 louée chez Nosana, est
assez rapide pour MBC mais se trompe de famille de métier sur 3 CV sur 4. Décision de l'utilisateur : l'affiner
(LoRA) sur la classification des CV (ADR 0044), avec les classifications déjà enregistrées comme réponses attendues,
avec l'accord du DPO pour les CV de DEV et de production. L'affinage lui-même se fait avec le déployeur
`nosana-llm-deployer` (son ADR 0005) ; ce dépôt fournit les exemples.

## Décision

- **`npm run finetune:cv-dataset`** (`scripts/finetune-cv-dataset.mts`), en lecture seule (aucune écriture dans
  Appwrite, aucun appel d'IA), en deux temps : `collect <fichier .env> [--prod] --out <dossier>` par projet, puis
  `split --out <dossier>`.
- **Un exemple = ce que le modèle a vraiment reçu, et la réponse enregistrée** : consignes `CLASSIFICATION_SYSTEM`,
  texte du CV comme au classement (`readCvForScoring` pour un fichier, `profileText` pour un profil sans fichier :
  la même fonction, exportée de `cv-classify.ts`), et la classification enregistrée remise au format de réponse des
  consignes (`answerFromClassification`, qui redonne la même classification par `parseClassification`, testé).
  Seulement les classifications **faites par l'IA pour la version actuelle du CV** (`isUpToDate`) : une classification
  par les règles ou d'une version remplacée n'irait pas avec ce texte.
- **Masquage supplémentaire** (`src/lib/finetune/cv-classification-dataset.ts`, testé ; renforcé après la revue de
  sécurité du 2026-11-24) : le texte envoyé à l'IA en service garde le nom du candidat ; un modèle affiné garde des
  traces de ses exemples. `maskPersonName` remplace par « [NOM] » chaque partie du prénom et du nom, sans casse ni
  accents (accents décomposés par la lecture du PDF compris), en mot entier, en lettres espacées (« D U P R É ») et
  collée à un autre mot (5 lettres et plus, 4 dans l'en-tête : « Eric » ne masque pas « numérique ») ; particules
  (« de », « la »…) exclues. `maskLeftoverContacts` remplace ce que `contact-mask.ts` laisse passer : liens, e-mails (un
  profil sans fichier ne passe pas par lui), date de naissance, numéro et nom de rue (la ville reste, elle sert au
  matching), téléphones aux formats rares (une suite de chiffres qui contient une année est gardée : les dates servent
  aux années d'expérience). **La réponse est masquée de même** (`maskClassification` : métiers, employeurs, certifications,
  résumé) : c'est elle que le modèle apprend à écrire. **CV sans nom connu écartés** (impossible de masquer) ; CV dont
  le nom n'apparaît pas dans le texte gardés mais comptés.
- **Doublons écartés** par empreinte du texte (`textKey`) : DEV contient des copies de CV de production ; un même CV
  ne doit pas être à la fois dans l'entraînement et dans le test.
- **Répartition** par famille de métier, environ 80 / 10 / 10 (`assignSplits`, déterministe : même répartition à
  chaque export **des mêmes CV** ; si des CV s'ajoutent, un CV du test peut passer à l'entraînement, garder alors la
  liste des clés du test) ; une famille de moins de 3 exemples va entière à l'entraînement.
- **Relecture humaine du test** : `test-review.csv` (clé, projet, source, identifiant, famille, métiers, compétences,
  colonnes à remplir) pour vérifier les réponses de référence du test avant la mesure finale.
- **Fichiers hors de tout dépôt git** (racine de ce dépôt d'après le script, puis `git rev-parse` sur le dossier
  visé), dossier à soi seul (0700, vérifié, pas un lien), fichiers 0600 écrits d'un coup (création exclusive puis
  renommage) ; aucune donnée de CV affichée, seulement des nombres. Le fichier de relecture neutralise les formules de
  tableur (`csvCell`). **Le dossier d'export est à supprimer à la main après l'affinage** : il contient les CV masqués
  et les identifiants des sources (les exemples envoyés dans le seau sont supprimés par le déployeur).
- **Viviers des organisations clientes compris** : décision de l'utilisateur du 2026-11-24, ces CV étant couverts par
  les contrats des clients et l'accord du DPO (MBC est sous-traitant de ces organisations pour leur vivier).

## Conséquences

- Export du 2026-11-24 (masquage renforcé) : 855 exemples (DEV 159, production 696 ; 44 CV sans nom connu écartés),
  265 doublons, 590 CV : 470 d'entraînement, 60 de contrôle, 60 de test ; dans les textes, 68 adresses, 2 dates de
  naissance et 19 téléphones masqués, aucun e-mail ni lien restant. Familles rares (design, RH, commercial) : trop peu
  d'exemples pour bien les apprendre.
- Les réponses de référence viennent de GPT-4o mini (presque toutes les classifications) : le modèle affiné apprend
  aussi ses erreurs, d'où la relecture du test ; l'utilisateur vérifie que les conditions d'OpenAI permettent cet usage.
- Changer les consignes ou le format de la classification (`CLASSIFICATION_VERSION`) rend les exemples périmés : refaire
  l'export et l'affinage.
