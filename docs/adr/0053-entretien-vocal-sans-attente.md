# 0053 — Entretien vocal sans attente : transcription en arrière-plan, sans relance de l'IA

- Statut : accepté (2026-11-20)
- Date : 2026-11-20
- Modifie : [ADR 0035](0035-entretien-vocal-sans-clic.md) (questions préparées + une relance au plus) et
  [ADR 0052](0052-voix-de-l-entretien-vocal-google-et-preparee.md) (phrases demandées à la voix)

## Contexte

Essai du 2026-11-20 de `/interview/<session>/v2` : après chaque réponse, l'étape « Je note votre réponse… » est trop
longue.

Cette étape est la transcription de la réponse orale : envoi de l'audio au serveur, puis à OpenAI. L'entretien
l'attendait parce que l'IA lisait le texte aussitôt pour décider d'une relance (« Alex réfléchit… »), ou pour répondre
à la question de clôture du candidat.

Le navigateur ne sait pas transcrire de façon fiable : c'est ce qui bloquait la salle actuelle (ADR 0035). Supprimer
l'attente supposait donc de renoncer aux relances en direct.

L'utilisateur a choisi « No waiting » plutôt que « Keep follow-ups, faster ».

## Décision

- **Plus de relance ni de réponse de l'IA pendant l'entretien.**
  - Alex pose les questions préparées, l'une après l'autre.
  - La relance orale après un silence reste : elle se décide dans le navigateur, sans transcription.
  - Le mot de la fin (`closingLine`) dit que le recruteur répondra aux questions du candidat. Il les lit dans la
    retranscription.
- **Réponse gardée dans le navigateur, transcrite en arrière-plan.** Dès la fin d'une réponse, la question suivante est
  posée (voix préparée, ADR 0052) pendant que la réponse est transcrite (`transcribeInBackground`,
  `voice-interview-room.tsx`).
  - Un second essai en cas d'échec.
  - Après deux échecs, le texte est « (Réponse orale non transcrite : voir l'enregistrement de l'entretien) » : la
    réponse reste dans l'enregistrement continu envoyé à la fin.
  - Une transcription vide (bruit pris pour de la parole) donne « (Pas de réponse) ». Avant, elle déclenchait une
    relance orale.
- **Une seule écriture de la retranscription**, à la fin.
  - Après le mot de la fin, l'écran « Envoi de votre entretien… » attend les transcriptions encore en cours (90 s au
    plus chacune, `TRANSCRIPTION_WAIT_MS`), puis enregistre la retranscription complète (`completeInterview`). Cet
    enregistrement déclenche l'analyse comme avant.
  - L'entretien est toujours noté « en cours » pendant la première question (ADR 0052).
- **Champ écrit** seulement quand le micro n'enregistre pas. Une transcription en échec ne l'ouvre plus : l'entretien
  ne s'interrompt pas.
- **Route de la voix sans aucun texte libre.** Le genre `reply` (texte d'une réponse de l'IA, 800 caractères) est
  retiré de `SpeechLine` et de `parseSpeechLine`. Toutes les phrases sont construites par le serveur.
- **Salle actuelle** (`/interview/<session>`) inchangée : elle garde ses relances (`getCandidateAIFollowUp`,
  `answerClosingQuestion`).

## Conséquences

- Aucune attente entre deux questions, hors la voix d'Alex.
- Coût : plus d'appel à l'IA pour les relances ni pour les réponses de clôture.
- L'entretien ne s'adapte plus aux réponses. L'analyse de fin (rapport au recruteur) est inchangée.
- Un candidat qui ferme l'onglet en cours de route ne laisse aucune retranscription. L'entretien ne pouvait déjà pas
  reprendre en cours de route, et l'enregistrement continu n'est envoyé qu'à la fin.
- Les transcriptions passent toujours par une Server Action (`transcribeInterviewAnswer`). Elles se suivent l'une après
  l'autre en arrière-plan, sans bloquer l'entretien : une réponse dure plus longtemps que sa transcription.
- Retour arrière : `git revert`. Aucune donnée ni variable à reprendre.
