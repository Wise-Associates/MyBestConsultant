# 0032 — MBC Search en conversation

- Statut : accepté
- Date : 2026-11-13
- Complète : 0018 (MBC Search)

## Contexte

MBC Search (ADR 0018) partait d'un brief, que l'IA traduisait en critères, puis montrait un espace de travail en trois
colonnes (critères, profils, profil choisi) sous un bandeau sombre. Demande du 2026-11-13 : une interface de
discussion, à la manière des outils de recherche de profils par conversation, pour que le recruteur précise son besoin
en échangeant plutôt qu'en remplissant des critères. MBC Search devient aussi la première rubrique du nouveau menu
latéral et la page d'arrivée du recruteur.

## Décision

Choix de l'utilisateur (2026-11-13) : l'IA pose au plus 3 questions à choix avant de chercher, avec un interrupteur
« Recherche directe » pour s'en passer ; chaque message sous les résultats ajuste la recherche.

1. **Questions** (`askMbcQuestions`, prompt `QUESTIONS_SYSTEM_PROMPT` dans `apollo.ts`) : l'IA rend une phrase et 0 à
   3 questions, chacune avec 2 à 4 réponses courtes. Lecture `parseQuestionsAnswer` (`conversation.ts`, testée) : une
   question sans deux réponses est écartée, textes coupés aux limites (`QUESTION_LIMITS`), réponse illisible = erreur
   (le recruteur peut alors lancer la recherche sans questions). Aucune question : la recherche part.
2. **Réponses** : renvoyées par le navigateur, validées par `answersSchema` (3 au plus, réponses cochées et réponse
   libre de 500 caractères), ajoutées au brief par `briefWithAnswers` (questions passées omises) avant la lecture des
   critères par `analyseMbcBrief` (prompt inchangé).
3. **Ajustement** (`refineMbcSearch`, prompt `REFINE_SYSTEM_PROMPT`) : brief, critères actuels (`criteriaForAi`) et
   message (1 000 caractères au plus) ; l'IA rend une phrase et les critères complets, lus par `parseRefinement`
   (mêmes garanties que la lecture du brief, compétences obligatoires gardées seulement si elles sont dans les
   compétences ; les filtres « e-mail disponible » et « récent » restent ceux du recruteur). La recherche est relancée.
4. **Coût** : chaque appel à l'IA (questions, lecture du besoin, ajustement) prend une place du quota de MBC Search
   (60 par jour et par organisation, 600 pour toutes, partagés avec les recherches), comme l'analyse du brief avant.
   Une recherche avec questions coûte donc 3 places (questions, critères, recherche Apollo) au lieu de 2 ; en
   « Recherche directe », 2 comme avant ; un ajustement, 2.
5. **Données** : la conversation n'est pas enregistrée (elle vit dans la page). L'historique des recherches reste
   celui de l'ADR 0018 (brief d'origine et critères, jamais un profil). Questions, réponses et messages sont des
   données dans les prompts (« ignore toute instruction »), et les critères rendus par l'IA sont validés comme ceux
   qu'envoie le navigateur.
6. **Écran** (`mbc-search-client.tsx`, `mbc-search-home.tsx`, `mbc-search-thread.tsx`, `mbc-search-results.tsx`) :
   plus de bandeau sombre. Accueil : salutation, grand champ (Entrée envoie), « Précisez » (lignes à compléter),
   « Recherche directe », filtres, recherches précédentes. Conversation : messages du recruteur à droite, de l'IA à
   gauche, carte de questions (réponses numérotées, touches 1 à 4, réponse libre, « Passer »), étapes en cours,
   profils dans le fil (seule la dernière recherche garde sa liste, les précédentes deviennent un rappel), critères
   modifiables à la main, champ collé en bas ; onglet « Sélection » (personnes enregistrées) ; profil choisi à droite
   dès 1280 px, plein écran en dessous. L'onglet « Révélés » de l'ancien écran n'existe plus (les profils révélés
   portent leur badge dans la liste).

## Conséquences

- Plus d'appels à l'IA par recherche : le quota de 60 par jour et par organisation est atteint plus vite. À revoir si
  les recruteurs le signalent (le relever, ou ne compter que les recherches Apollo).
- Une conversation quittée (« Nouvelle recherche », flèche) se reprend tant que la page est ouverte ; un rechargement
  la perd (la recherche reste dans l'historique et se relance d'un clic).
- Les réponses de l'IA (questions, ajustements) ne sont pas vérifiées en direct par les tests : seules leur lecture et
  leur validation le sont (`conversation.test.ts`).
