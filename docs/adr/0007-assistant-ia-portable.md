# 0007 — Assistant IA : module portable, réponses d'aide seulement, un seul modèle

- Statut : accepté
- Date : 2026-10-22

## Contexte

Les candidats et recruteurs posent au support des questions d'utilisation (« comment postuler ? », « comment
inviter un collègue ? »). Un assistant IA dans leur espace peut y répondre tout de suite. Wise Associates veut
réutiliser le même assistant sur d'autres sites (Wise Assurances Pro, wise-associates.fr, sites clients) : il doit
pouvoir être déplacé sans réécriture. Les conversations sont du texte libre : elles peuvent contenir des données
personnelles.

## Décision

**Module portable `src/assistant/`**, qui n'importe rien de l'application (règle ESLint `no-restricted-imports`) :

- `core/` (sans framework) : contrat `AssistantHost`, règles pures testées, points d'entrée `runTurn`, `loadLatest`,
  `handoffToSupport`. Chaque point d'entrée vérifie lui-même l'utilisateur auprès du site : un site ne peut pas
  oublier ce contrôle.
- `react/` (sans Next.js) : la fenêtre de chat, stylée seulement par ses variables `--assistant-*`.
- Le site fournit ses adaptateurs : session, stockage, quotas, appel au modèle, contenu d'aide, transmission au
  support. MyBestConsultant : `src/lib/assistant/`. Extraction en paquet quand un deuxième site l'adopte ; un service
  hébergé avec un script d'intégration viendra ensuite pour les sites qui ne sont pas en Next.js.

**Périmètre v1 :**

- Candidats et recruteurs connectés **dont l'adresse e-mail est vérifiée** (ni chasseurs, ni admin, ni visiteurs).
  L'inscription est libre : sans cette condition, des comptes jetables épuiseraient le quota de la plateforme.
- Réponses tirées uniquement du contenu d'aide (`src/lib/assistant/knowledge.ts`) ; l'assistant n'a accès à aucune
  donnée de l'utilisateur et ne peut rien modifier. Aucun outil : un texte hostile (CV, offre) ne peut rien
  déclencher. Bouton « Transmettre au support » : ticket du Help Desk avec la conversation, à la demande de
  l'utilisateur, après confirmation. Dans la transcription, les lignes suivantes d'un message commencent par « › »
  (un utilisateur ne peut pas écrire une fausse réponse « Assistant : … ») et l'en-tête rappelle que les réponses de
  l'IA n'engagent pas l'équipe.
- Modèle : celui de la ligne « Assistant IA » de Config IA, **sans repli** (`callLLM` strict). Le repli habituel
  enverrait les conversations à tous les modèles configurés, y compris des hébergeurs sans contrat de
  sous-traitance. En mode strict, `callLLM` refuse aussi d'appeler un autre modèle quand Config IA est illisible
  (valeurs par défaut) ou quand le modèle choisi a été retiré ou désactivé. En cas de panne, l'assistant affiche une
  erreur.
- Pas de diffusion progressive de la réponse (streaming) en v1 : `callLLM` renvoie la réponse entière.
- Coût borné : message de 2 000 caractères, 10 derniers échanges et 12 000 caractères d'historique au plus par appel ;
  quotas en compteurs atomiques (`takeDailySlot`, collection AO_STATE) de 30 messages par utilisateur et par jour et
  1 000 pour toute la plateforme, avec un message différent selon la limite atteinte.

**Données :** collection `assistant_turns` (conversation, utilisateur, question, réponse, modèle), un document par
échange, enregistré après la réponse (jamais de question sans réponse), sans permission client. Conservation **30 jours**
(décision du 2026-10-23, `ASSISTANT_RETENTION_DAYS` ; annoncée dans la fenêtre de chat et dans le contenu d'aide) :
de quoi reprendre une conversation ou la transmettre au support dans le mois, sans garder plus longtemps du texte libre
qui peut contenir des données personnelles. Purge quotidienne `/api/cron/assistant-purge`, qui purge aussi les places
de quota de plus de 7 jours. Supprimées
avec le compte, par l'admin (`deleteUserAccount`, avant puis après la suppression du compte) comme par le retrait
d'un membre d'équipe (`removeMember`).

**Activation séparée du stockage :** `ASSISTANT_ENABLED=true` affiche l'assistant ;
`APPWRITE_COLLECTION_ASSISTANT_TURNS` désigne la collection, dont dépendent la purge et la suppression avec le compte.
Masquer l'assistant = retirer `ASSISTANT_ENABLED`, jamais la variable de la collection (les conversations ne seraient
alors plus jamais supprimées).

## Conséquences

- Le contenu d'aide doit suivre les évolutions du site : l'assistant répète ce qui y est écrit, et dit qu'il ne
  sait pas pour le reste.
- Une panne du modèle choisi rend l'assistant indisponible (pas de bascule).
- Limites connues de la v1 :
  - un message refusé par une panne du modèle compte quand même dans les quotas (pas de restitution des places) ;
  - si l'enregistrement échoue après la réponse, celle-ci est affichée avec un avertissement, sans pouvoir être
    reprise ni transmise ;
  - `callLLM` renvoie le raisonnement d'un modèle Qwen quand sa réponse est vide (comportement commun à tous les
    modules) ; l'appel à Claude n'a pas de délai propre (délai de la plateforme Vercel).
- Une conversation transmise au support devient un message de ticket : elle suit la conservation du Help Desk, qui
  n'a pas encore de règle de suppression (à définir par le responsable du traitement), et non les 30 jours.
- La politique de confidentialité doit mentionner l'assistant, le fournisseur du modèle choisi et la durée de
  conservation (à faire par le responsable du traitement).
- **Mise en service et retour arrière :** créer la collection sur DEV (`--apply`), variable en portée Preview, tester ;
  en production, la variable n'est définie qu'après `--prod --apply`. Retour arrière complet (abandon de la
  fonction) : exporter si besoin, puis supprimer la collection dans la même opération que le retrait de la variable
  ou de ce code.
- Une fenêtre de chat sur un autre site = ses adaptateurs, sa collection ou table, son contenu d'aide, ses
  variables de style : voir `src/assistant/README.md`.
