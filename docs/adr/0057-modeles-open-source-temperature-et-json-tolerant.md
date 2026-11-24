# 0057. Modèles open source : température dans Config IA et lecture tolérante du JSON des réponses

Date : 2026-11-23. Statut : accepté.

## Contexte

Le 2026-11-23, toutes les fonctions IA de MBC ont été essayées avec Ministral 3 14B (modèle open source de Mistral,
servi par vLLM sur un GPU loué chez Nosana, ajouté comme modèle open source de Config IA), puis comparées à Claude et
GPT sur des données réelles de DEV, en lecture seule. Deux défauts venaient de MBC, pas du modèle :

1. **Aucune température n'est envoyée aux API compatibles OpenAI** (`callOpenAICompat`, `llm-router.ts`). vLLM applique
   alors celle du fichier `generation_config.json` du modèle, ou 1,0 s'il n'en donne pas, ce qui est le cas de
   Ministral 3. À 1,0, ses réponses JSON sont souvent abîmées : 21 fonctions sur 37 réussies, contre 31 sur 37 à 0,15.
2. **Le JSON des réponses est lu par `JSON.parse`, qui refuse un retour à la ligne brut dans une chaîne.** Ministral en
   écrit (« Bad control character in string literal ») là où Claude et GPT écrivent `\n` : une réponse complète était
   rejetée. C'était le cas pour « Générer les questions » d'un entretien, « Améliorer une offre » et l'extraction des AO.

## Décision

- **Température par modèle open source**, réglée dans Config IA (champ « Température », 0 à 2, au centième ;
  `temperature` de `OpenSourceModel`, `sanitizeTemperature` dans `src/lib/ai/models.ts`, testé). Elle est envoyée au
  serveur avec chaque appel du modèle. Un modèle ajouté reçoit **0,15** (`DEFAULT_OPEN_SOURCE_TEMPERATURE`), la valeur
  mesurée : les tâches de MBC sont surtout de l'extraction et de la notation. Champ vide (`null`), ou modèle
  enregistré avant ce changement : aucune température envoyée, comme avant. GPT, TeckiA et Claude ne sont pas
  concernés (comportement inchangé). Le champ est un texte (« 0,15 » ou « 0.15 », `parseTemperatureInput`) : un champ
  numérique rend « 0,15 » vide dans un navigateur réglé en anglais, ce qui aurait enregistré « aucune température ».
  Une saisie invalide est signalée et la valeur précédente gardée. « Tester » envoie la température, pour qu'un
  hébergeur qui la refuse échoue au test et pas seulement en service. Elle fait partie de la signature du modèle dans
  le cache des notations (ADR 0044, `primaryModel`) : la changer refait les notations au lieu de reprendre les anciennes.
- **Lecture tolérante du JSON des réponses** : `parseModelJson` (`src/lib/ai/model-json.ts`, testé) remplace
  `JSON.parse` partout où MBC lit le JSON écrit par une IA. Même résultat que `JSON.parse`, avec une seule tolérance :
  quand la lecture échoue, les caractères de contrôle bruts **à l'intérieur des chaînes** sont échappés et la lecture
  est refaite une fois. Tout autre défaut (virgule en trop, réponse coupée) lève l'erreur de `JSON.parse` sur le texte
  reçu, comme avant : rien n'est deviné. Les réponses de Claude et GPT, qui se lisaient déjà, ne changent pas.
  Chaque réparation est journalisée (`[ai] réponse JSON réparée`, sans le texte, qui contient des CV) pour voir son
  volume et repérer un autre modèle qui s'y mettrait.
- **Repli journalisé** : quand `callLLM` obtient la réponse d'un modèle de repli, il journalise les modèles en échec et
  la nature de chaque échec (`[llm] repli : os-… (HTTP 400) → réponse de claude`), jamais le message d'erreur. Avant, un
  modèle choisi qui échouait à chaque appel (paramètre refusé, clé expirée) passait inaperçu tant que le repli répondait.

## Options écartées

- **Sortie JSON contrainte** (`response_format: json_object` ou schéma JSON, que vLLM sait imposer) : elle garantit un
  JSON valide, mais il faudrait marquer chaque appel qui attend un objet (d'autres attendent un tableau), et un serveur
  qui ne la connaît pas refuserait l'appel, qui partirait alors vers un autre modèle par le repli. Les deux correctifs
  ci-dessus suffisent pour les défauts observés ; à reconsidérer si un modèle open source rend encore du JSON invalide.
- **Réparer le JSON dans `callLLM`**, pour tous les appels : le texte des réponses libres (assistant, messages) serait
  modifié lui aussi. La réparation reste à l'endroit où le code sait qu'il lit du JSON.
- **Une température par défaut pour tous les modèles open source déjà enregistrés** : elle changerait sans prévenir le
  comportement d'un modèle en service. Seuls les modèles ajoutés reçoivent 0,15 ; les autres se règlent dans Config IA.

## Conséquences

- Un modèle open source peut être essayé sans réglage particulier du serveur (vLLM, Ollama…) : sa température vient
  de Config IA.
- Tout nouvel appel qui lit le JSON d'une réponse d'IA utilise `parseModelJson`, jamais `JSON.parse`.
- Les défauts restants de Ministral 3 relèvent du modèle (lenteur sur un seul GPU, cartographie des modèles CV,
  intitulés de poste vides dans « Analyser le brief ») : ni ce changement ni un autre réglage de MBC ne les corrige.
