# 0055 — Invitations vers l'entretien vocal /v2, nombre total de questions, format audio

- Statut : accepté (2026-11-21)
- Date : 2026-11-21
- Modifie :
  - [ADR 0035](0035-entretien-vocal-sans-clic.md) : les invitations pointaient encore vers l'ancienne salle ;
  - [ADR 0054](0054-questions-d-entretien-saisie-import-ajustement-ia.md) : le format se choisissait dans le pipeline.

## Contexte

Demandes du 2026-11-21, après un essai :

1. Toute nouvelle invitation doit mener à l'entretien vocal `/interview/<id>/v2`.
2. Le nombre de questions choisi sur `/recruiter/interviews/new` « ne marche pas ». Les questions par défaut de
   l'organisation (5 par défaut) s'ajoutaient au nombre choisi : 8 demandées, 13 obtenues. Le nombre de questions
   rendues par l'IA n'était pas non plus vérifié.
3. Le format choisi à la création (audio ou vidéo) doit valoir dans `/v2`. En audio, seule l'onde de la voix est
   montrée ; en vidéo, la caméra comme avant. L'entretien du pipeline reste en vidéo.
4. La liste `/recruiter/interviews` doit être plus moderne, et l'en-tête de la liste des questions prend trop de place.

## Décision

- **Lien unique** `interviewPath(sessionId, format)` (`src/lib/interview-room.ts`, testé) :
  `/interview/<id>/v2?mode=audio|video`.
  - Il est employé par l'e-mail d'invitation (`sendInterviewInvitationEmail`), par l'écran de fin de
    `/recruiter/interviews/new`, par la fenêtre du pipeline et par le module d'entretien du screening.
  - Sans format choisi (renvoi d'une invitation, module du screening), le format est la vidéo, comme la salle sans
    format. Le texte de l'e-mail (« vidéo » ou « audio ») suit désormais le format du lien. Avant, un lien sans format
    ouvrait la vidéo pendant que l'e-mail annonçait de l'audio.
  - Le format n'est pas enregistré sur l'entretien : la collection a 14 attributs sur 16, et l'ajout demanderait une
    mise à jour de la structure avant le déploiement. Un renvoi d'invitation part donc en vidéo.
- **Nombre de questions = tout l'entretien**, questions par défaut comprises (`aiQuestionPlan`,
  `src/lib/interview-rules.ts`, testé).
  - L'IA n'écrit que les questions manquantes, avec une répartition par catégorie qui ne refait pas une introduction ou
    une clôture déjà posées. Les questions par défaut lui sont données pour ne pas les répéter.
  - Sa réponse est coupée au nombre demandé.
  - Quand les questions par défaut suffisent, l'IA n'est pas appelée et le quota n'est pas pris.
  - « Ajuster avec l'IA » complète jusqu'au même total : questions par défaut de la liste déduites.
  - Le module d'entretien du screening (`prepareInterviewFromScreening`, 8 questions) suit la même règle : 8 questions
    en tout, et non plus 8 en plus des questions par défaut.
- **Pipeline : vidéo seulement.** Le choix du format est retiré de sa fenêtre (`InterviewConfigForm` sans
  `mediaMode`), et `sendPipelineInterviewAction` envoie toujours en vidéo. `/recruiter/interviews/new` garde le choix.
- **Entretien audio dans `/v2`** : sans caméra (format audio, ou caméra indisponible), la tuile « Vous » et le test du
  micro montrent l'onde de la voix.
  - Elle est dessinée dans un canvas par la boucle de la jauge, en vert quand il y a de la voix (`drawWave`,
    `voice-interview-room.tsx`).
  - En vidéo, rien ne change.
  - L'écran d'accueil cite aussi le service de synthèse vocale (Google ou OpenAI), en plus de la transcription par
    OpenAI.
- **Liste des entretiens** (`interviews-index-client.tsx`) :
  - en-tête d'une ligne, comme les autres pages de l'espace recruteur ;
  - onglets de statut avec leur nombre (« Passés » par défaut, puis « En attente », « En cours », « Terminés »,
    « Analysés ») et recherche ;
  - une liste en tableau à partir de 1024 px (candidat, format, questions, avis de l'IA avec son score coloré, statut,
    date), en lignes empilées en dessous.
  - Le bouton « Questions génériques » devient « Questions par défaut ».
- **En-têtes de `/recruiter/interviews/new`** :
  - une ligne à chaque étape (`StepHeader`), au lieu d'un bandeau et d'un grand titre ;
  - tailles des titres écrites en ligne, car la règle globale des titres (`globals.css`) l'emporte sur les classes.
  - Même correction pour les titres de la fenêtre du pipeline.

## Conséquences

- **Données personnelles** : chaque candidat invité passe désormais par `/v2`. Sa voix part chez OpenAI (transcription)
  et le texte dit (avec son nom) chez Google ou OpenAI (voix).
  - L'écran d'accueil le dit.
  - **`/legal` ne liste aucun sous-traitant** (page provisoire : SIRET et responsable à compléter). La politique de
    confidentialité est à mettre à jour par un humain.
- Les invitations envoyées avant ce changement mènent toujours à l'ancienne salle, qui reste en service.
- Non vérifié dans un navigateur : les pages du recruteur demandent une connexion, et `/v2` une vraie session
  d'entretien.
- Retour arrière : `git revert`. Aucune donnée ni variable.
