# 0063. Affinage multi-tâches de Ministral 3 3B pour toutes les fonctions d'IA

Date : 2026-11-25. Statut : accepté (adaptateur v3 entraîné et mesuré ; passage en production à décider par un humain).

## Contexte

Ministral 3 3B affiné sur la classification des CV (ADR 0058) répond juste sur 85 % des familles (60 CV de test), en
5 s, sur une RTX 3090 ou 4090 louée chez Nosana. Demande de l'utilisateur (2026-11-25) : **le même 3B pour toutes les
fonctions d'IA de MBC**, affiné là où il le faut, plutôt qu'un modèle plus gros. Sans affinage, le 3B échoue l'export CV
(82–87 % du CV repris), la lecture des appels d'offres (réponse vide) et une partie des notations (JSON illisible) :
banc d'essai du 2026-11-23 (ADR 0057).

Décisions de l'utilisateur (2026-11-25) :
- données : **toutes les tâches, DEV et production** (CV, offres, appels d'offres, entretiens, briefs ; masqués),
  extension de l'accord du DPO du 2026-11-24 ;
- réponses attendues écrites par un **modèle enseignant, Claude Sonnet 5.5**, coût montré avant tout envoi ;
- facturées sur une **clé Anthropic dédiée** (`FT_ANTHROPIC_API_KEY`, dans le `.env` du déployeur), jamais la clé de
  Config IA, partagée par DEV et la production (plafond de dépenses atteint le 2026-11-23).

## Décision

- **`npm run finetune:mbc-dataset`** (`scripts/finetune-mbc-dataset.mts`) :
  - `collect <fichier .env> [--prod] [--tasks …] --out <dossier>` (lecture seule) ;
  - `teach --out <dossier>` : estimation du coût ; avec `--apply --max-usd N`, envoi en lot (Batch API, moitié prix) ;
    relancé, il lit le résultat ;
  - `split --out <dossier> [--classification <dossier>]` : répartition.
- **Un exemple = exactement ce que l'application envoie** : consignes et message construits par les fonctions mêmes de
  l'application (`scoringSystemPrompt`, `scoringUserMessage`, `extractionPrompt`, `buildSystemPrompt`…), jamais
  recopiés. Les consignes écrites dans des actions serveur ou des modules `server-only` sont déplacées, à l'identique
  (vérifié octet par octet), dans des modules purs que l'action et le script importent.
- **Réponse de l'enseignant gardée seulement si la lecture de l'application l'accepte** (`teacherAnswer`,
  `src/lib/finetune/mbc-dataset.ts`, testé) : `parseJudgements`, `parseVivierMatching`, `parseExtraction`,
  `parseTranslation`, `cleanAnswer`… ; réécrite en JSON compact, la forme que l'élève apprend. Un lot du vivier dont une
  offre n'est pas jugée, une réponse plus longue que la limite de l'application (l'élève ne réfléchit pas avant de
  répondre), un refus ou une réponse coupée sont écartés.
- **Demandes qui suivent une réponse** (`followUpItems`), comme dans l'application : comparaison des intitulés après
  une notation (`withCheckedTitles`), traduction après la lecture d'un CV (`exportCv`), question suivante d'une
  conversation avec l'assistant.
- **Noms remplacés par des noms inventés**, pas par « [NOM] » (`src/lib/finetune/pseudonymize.ts`, testé) : l'export CV
  et l'analyse d'entretien doivent apprendre à anonymiser un nom qu'ils voient. Mêmes règles de recherche que le
  masquage de l'ADR 0058 (mot entier, lettres espacées, collé à un autre mot), un faux nom stable par partie de nom,
  jamais le vrai nom d'une autre personne du texte. Un texte où une partie du vrai nom (4 lettres ou plus) reste après
  le remplacement est écarté (`keepsRealName`). Coordonnées restantes masquées (`maskLeftoverContacts`). L'enseignant
  ne voit que le texte remplacé et masqué.
- **Données inventées là où rien n'est enregistré** : questions de l'assistant (`assistant-questions.ts` : questions
  couvertes, hors du contenu d'aide, situations personnelles, suites de conversation), critères de matching par défaut
  (`defaultCriteriaSet`) tant que peu d'offres ont les leurs.
- **Répartition par groupe** (`splitOf` : 80 / 10 / 10 d'après l'empreinte du texte du CV ou de la source) : un même CV,
  présent en DEV et en production, n'est jamais à la fois en entraînement et en test d'une même tâche. Les exemples de
  classification déjà répartis (ADR 0058) sont ajoutés tels quels : test inchangé, mesures comparables.
- **Hors du jeu** : la cartographie des modèles CV (un modèle par organisation, trop peu d'exemples ; reste sur Claude),
  la lecture des documents scannés (vision, Claude) et la voix des entretiens (hors Config IA).

## Tâches couvertes

| Famille (`--tasks`) | Tâches | Sources |
|---|---|---|
| `scoring` | notation matching, score final, notation sur critères (critères par défaut tant que peu d'offres ont les leurs), vivier général (CV × 5 offres), comparaison des intitulés | `jobs`, CV de `users` et `vivier_cvs`, `job_matches`, `applications` |
| `cv-export` | lecture du CV, traduction du dossier | CV (20 000 caractères au plus : longueur d'entraînement) |
| `content` | profil extrait d'un CV (nom, e-mail et téléphone inventés : le profil les recopie), publication sociale d'une offre | CV, `jobs` |
| `interviews` | analyse de fin d'entretien, analyse de la salle recruteur, relances des deux salles, réponse à la question du candidat, génération et ajustement des questions | `interviews.transcript` et `questions`, `jobs`, `applications.aiSummary` |
| `jobs` | rédaction et amélioration d'une offre, import d'un texte d'offres et amélioration, message d'approche, demande de recommandation, compte rendu d'étape | `jobs`, `applications` (`funnelJson`, screening), `interviews.analysis` ; besoins, demandes d'amélioration, textes collés et destinataires écrits d'après des offres réelles (rien n'est enregistré) |
| `ao` | version publique anonyme, critères de matching proposés | `ao_offers`, `ao_emails`, `ao_offer_details.contact`, `ao_sources.ownDomains` |
| `mbc-search` | critères d'un besoin, questions de précision, stratégies et ajustement (à la suite), évaluation d'un profil, message d'approche | `mbc_searches`, `mbc_reveals` (sans nom, e-mail, lien ni photo) ; besoins écrits d'après des offres |
| `assistant` | assistant IA (un ou deux tours) | questions inventées, `assistant_turns` |

Pas encore couvert : **lecture des e-mails d'appels d'offres** (corps et pièces jointes jamais enregistrés : à relire dans
les boîtes, avec l'accord de l'utilisateur du 2026-11-25) et lecture d'une page d'annonce. L'import manuel d'appels
d'offres de l'admin (`/api/admin/extract-jobs`) appelle Claude sans passer par `callLLM` quand Claude est le modèle par
défaut : Config IA ne peut pas l'envoyer au 3B sans modifier cette route.

Consignes déplacées dans des modules purs pour cet export (à l'identique, vérifié octet par octet ; un changement de
ces consignes oblige à refaire l'export) : `interview-prompts.ts`, `job-draft-prompts.ts`, `job-import-prompts.ts`,
`step-report-prompt.ts`, `recommendation-prompt.ts`, `outreach-prompt.ts`, `cv-profile-prompt.ts`, `cv-profile-text.ts`,
`social-copy-prompt.ts`, `ao/ai-input.ts`, `ao/manual-import.ts`, `mbc-search/prompts.ts` ; `extractionRequest`,
`translationRequest` et `cvTextForExport` (`cv-export/prompt.ts`) ; `ASSISTANT_RETENTION_DAYS`
(`assistant/knowledge.ts`) ; `DEFAULT_GENERIC_QUESTIONS` (`interview-rules.ts`).

**Mesure** (`src/lib/finetune/mbc-eval.ts`, testé) : la réponse de l'élève à chaque demande de test, lue par
`teacherAnswer`, puis comparée à celle de l'enseignant — même décision « correspond » (65) et écart de score pour les
notations, mêmes relations pour les intitulés, part du CV reprise pour l'export ; temps médian.

## Conséquences

- Le dossier de sortie contient des textes de CV (noms remplacés, coordonnées masquées) : hors de tout dépôt (refusé
  sinon), 0700, fichiers 0600, supprimé après l'entraînement. Rien n'est affiché que des nombres.
- Coût de l'enseignant estimé avant tout envoi, plafonné par `--max-usd` ; lot à moitié prix, consignes en cache.
- Un même CV peut figurer en entraînement pour une tâche et en test pour une autre (groupes calculés par tâche) : fuite
  faible, à garder en tête en lisant les mesures.
- Le passage d'une fonction au 3B se fait dans Config IA, fonction par fonction, quand la mesure sur le test montre
  qu'il vaut le modèle actuel ; en production, par un humain.

## Résultats (2026-11-25)

- Enseignant : 3 409 réponses gardées sur 3 413 (lot Batch API), **23,57 $** sur la clé dédiée.
- Entraînement : affinage `20261125-1730-0239` (rang 32, 2 passages, 16 384 jetons au plus, aucun exemple écarté),
  7 568 s sur une RTX A6000 (≈ 0,85 $) ; perte d'entraînement 0,32, de contrôle 0,43.
- Mesure sur 463 demandes de test (RTX 4090, cache KV 16 bits, température 0,15) : **100 % de réponses lisibles par
  l'application sur les 32 tâches** (3B sans affinage : notation sur critères 14 %, comparaison des intitulés 31 %,
  traduction des dossiers 0 %, analyses d'entretien 75 %…) ; même décision « correspond » que Sonnet : score final
  63 → 81 %, vivier général 92 → 98 % ; écart de score matching 13 → 4 points ; plus rapide. Classification : 49/60
  (v2 : 51/60, écart non significatif). **Export CV : 75 % du CV repris contre 84 % pour Sonnet** : Claude garde cette
  ligne.
- Adaptateur copié dans le dépôt privé Hugging Face `herilala19/ministral-3-3b-mbc-classification-cv-lora` (version 3,
  commit `59469654`).
- Page de résultats : https://claude.ai/artifact/HwLfx2bVALon2rPN5BeXAu ; exploitation (déployer, brancher dans Config
  IA, arrêter, refaire) : [docs/modele-3b-affine.md](../modele-3b-affine.md).
- Reste à faire : juger la qualité des textes libres (par Sonnet, sur les mêmes demandes) ; vérifier les conditions
  d'Anthropic et d'OpenAI sur l'entraînement à partir de leurs réponses ; lecture des e-mails d'appels d'offres.

