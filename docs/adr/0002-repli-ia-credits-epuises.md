# 0002 — AO Offers : repli et reprise quand l'IA n'est plus utilisable (crédits épuisés, panne)

- Statut : accepté
- Date : 2026-10-20

## Contexte

Le traitement des e-mails d'appels d'offres (`src/lib/ao/`) utilise l'IA à deux endroits :

- **le texte de l'e-mail** (corps + pièces jointes déjà lues) → offres structurées, via `callLLM` : le modèle
  de Config IA, puis automatiquement les autres modèles configurés (TeckiA, GPT-4o, modèles open source) ;
- **les images et PDF scannés** → texte, via Claude appelé directement (`extractors/vision.ts`), sans repli.

Quand le compte Claude n'a plus de crédits, l'API répond par une erreur 400 (« credit balance is too low »)
ou `billing_error`. Avant cette décision :

- une pièce jointe scannée était **ignorée en silence**, avec une raison trompeuse (« document refusé par
  l'API ») : l'e-mail était traité sans elle, et les offres qu'elle contenait étaient perdues ;
- si aucun autre modèle ne prenait le relais pour le texte, l'e-mail était **abandonné après ses essais**,
  alors qu'il n'y était pour rien.

## Décision

1. **Échecs sans frais reconnus** (`ai-failures.ts`, règles pures testées) : la requête a été refusée avant
   tout traitement, rien n'a été facturé.
   - Compte ou configuration : crédits épuisés (402, `billing_error`, 400 « credit balance », 429
     `insufficient_quota` d'OpenAI), clé refusée (401, 403), modèle inconnu (404), modèle non configuré. Côté
     API compatible OpenAI, un refus du compte ne compte que dans une réponse d'erreur JSON : une page HTML de
     pare-feu ou de proxy ne doit pas faire réessayer un e-mail indéfiniment.
   - Panne du service : saturé (429, 529), erreur 5xx (sauf 504), injoignable.
   Un délai dépassé (504, pas de réponse) ou une réponse illisible ont pu être facturés : ils suivent la règle
   normale des essais.
2. **Images et PDF scannés** : Claude d'abord, puis le modèle OpenAI de Config IA (GPT-4o par défaut) quand
   Claude échoue sans frais. GPT-4o lit les images et les PDF ; l'appel passe par `fetch`, comme le routeur IA
   (aucune dépendance ajoutée), et la réponse est validée (zod).
3. **Texte des e-mails** : le repli existant de `callLLM` est conservé ; en cas d'échec il lève désormais
   `LLMChainError`, qui garde l'échec de chaque modèle (le message, lui, ne change pas pour les autres modules),
   avec des erreurs typées pour « injoignable » / « sans réponse dans le délai » et « non configuré ».
4. **Tous les services en échec sans frais** : `AiUnavailable`. L'e-mail reste « en erreur » avec la cause par
   service (« Claude : crédits épuisés ; OpenAI : service saturé ou indisponible (503) »), il est repris à
   chaque synchronisation **sans user sa reprise** (une erreur ordinaire n'est reprise qu'une fois :
   `MAX_ATTEMPTS = 2`, `attempts.ts`), et traité dès que le service ou les crédits reviennent. Si un des
   échecs a pu être facturé (délai, réponse illisible), l'e-mail suit la règle normale, avec toutes les causes
   dans son message : un contenu piégé ne peut pas provoquer de refacturation sans fin.
5. **Portée** : si seule la lecture des scans est impossible, le passage continue (les e-mails sans scan sont
   traités) et les e-mails à scan suivants attendent aussitôt, sans nouvel appel ni réservation. Si
   l'extraction des offres est impossible, le passage s'arrête (tous les e-mails échoueraient de même). Le
   compte rendu l'indique (`aiUnavailable`) : avertissement dans les logs du cron, message sur
   `/admin/ao-offers`, et les planificateurs ne relancent pas plus tôt.
6. Une lecture refusée sans frais est **rendue au compteur quotidien** des lectures par l'IA (50 par jour),
   sinon les e-mails en attente l'épuiseraient en quelques passages. Un compteur injoignable ne masque jamais
   la vraie cause.
7. Le **courrier nouveau passe avant les e-mails à réessayer**, et l'expéditeur et l'objet sont enregistrés
   avant la lecture des pièces jointes : un e-mail en attente reste reconnaissable dans la liste des e-mails
   non traités.
8. **Bouton « Réessayer »** (admin) sur chaque e-mail non traité : remet ses essais à zéro, y compris pour un
   e-mail abandonné ou enregistré avant ces règles (crédits épuisés alors comptés comme des essais). Il est
   traité à la synchronisation suivante, ou tout de suite avec « Synchroniser maintenant ».

## Options écartées

- **Ignorer la pièce jointe et traiter le corps seul** : des offres présentes seulement dans la pièce
  jointe seraient perdues sans que personne ne le voie.
- **OCR local (Tesseract)** : pas de coût d'IA ni de tiers, mais deux dépendances lourdes (moteur OCR et
  rendu des pages PDF) pour des fonctions Vercel limitées en taille et en durée, et une qualité nettement
  inférieure sur les tableaux et mises en page d'appels d'offres.

## Conséquences

- **Données personnelles** : en repli, les pièces jointes (qui peuvent contenir noms et coordonnées) sont
  envoyées à OpenAI au lieu d'Anthropic, sous un nom de fichier générique, y compris pendant une simple panne
  de Claude (saturé, erreur 5xx). C'est déjà le cas du texte des
  e-mails quand `callLLM` se replie sur GPT-4o. Supprimer la clé OpenAI de Config IA (et `OPENAI_API_KEY`)
  désactive ce repli. OpenAI doit figurer comme sous-traitant dans le registre des traitements.
- Cas résiduel accepté : si les scans sont lus (facturés) mais que l'extraction des offres attend (tous les
  modèles de texte en échec sans frais, par exemple une panne passagère), les scans sont relus au passage
  suivant. Ce cas demande des échecs différents entre les deux étapes, en général passagers ; il reste borné
  par les 3 lectures par e-mail et les 50 par jour.
- Sans clé OpenAI, un échec sans frais de Claude (crédits épuisés, panne) met en attente les e-mails à pièce
  jointe scannée jusqu'au retour du service ; le message affiché sur `/admin/ao-offers` en donne la cause.
- Une clé Claude refusée (401/403) met désormais aussi l'e-mail en attente (ou passe à OpenAI) au lieu
  d'ignorer la pièce jointe.
- Le veilleur temps réel (`workers/ao-idle`, branche `ao-realtime`) devra lire `aiUnavailable` comme
  `ao:poll` : ne pas relancer toutes les 30 s un passage arrêté faute d'IA.
