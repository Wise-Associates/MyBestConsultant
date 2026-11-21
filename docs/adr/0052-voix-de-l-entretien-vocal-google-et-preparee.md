# 0052 — Voix de l'entretien vocal : Google Cloud Text-to-Speech, préparée à l'avance

- Statut : accepté (2026-11-20, à valider avec une clé Google sur la preview)
- Date : 2026-11-20
- Modifie : [ADR 0035](0035-entretien-vocal-sans-clic.md) (voix d'Alex de `/interview/<session>/v2`)

## Contexte

Retours du 2026-11-20 sur l'entretien vocal `/v2` :

- **Délai** : la question s'affiche, puis Alex ne la lit que 5 à 10 s plus tard.
- **Voix** : elle n'est pas assez professionnelle ; l'utilisateur propose une voix de Google.

Causes relevées :

- La voix était demandée seulement au moment de poser la question, par la Server Action `generateInterviewSpeech`.
  Cette action relit la session et prend une place sur le plafond de la session (Appwrite). Elle fait ensuite lire
  tout le texte par la voix gratuite de Microsoft Edge (`node-edge-tts`), écrit le MP3 dans un fichier temporaire et
  le renvoie en base64.
- Le texte de la question était affiché avant cette attente.
- Le navigateur exécute les Server Actions une par une : une voix demandée pendant une autre action attend derrière
  elle.
- Le 2026-11-20, le service de Microsoft refuse les connexions de `node-edge-tts` 1.2.10 (HTTP 403, en 1,1 s,
  constant). La voix venait donc du relais : `tts-1` « onyx » d'OpenAI, une voix anglophone qui parle français, après
  l'échec de Microsoft. Ce service non officiel n'est de toute façon couvert par aucun contrat, alors que le texte dit
  contient le nom du candidat.

## Décision

- **Voix de Google Cloud Text-to-Speech**, par `fetch` sans SDK, avec une clé d'API.
  - Variables `GOOGLE_TTS_API_KEY` et `GOOGLE_TTS_VOICE` (`fr-FR-Chirp3-HD-Charon` par défaut).
  - Chirp 3 HD est la gamme la plus naturelle de Google. Elle coûte 30 $ le million de caractères au-delà d'un million
    gratuit par mois, soit environ 3 000 caractères par entretien.
  - Règles pures : `src/lib/interview-voice-rules.ts` (testé). Appel : `src/lib/interview-voice.ts`, délai de 10 s.
- **Ordre des voix** : Google, sinon la voix d'OpenAI (`tts-1` « onyx », délai de 15 s), sinon la voix du navigateur.
  - La voix de Microsoft n'est plus essayée dans `/v2`.
  - Un échec de Google est journalisé même quand OpenAI prend le relais.
  - L'en-tête `X-Voice-Provider` de la réponse dit quel service a lu la phrase.
- **Route `POST /api/interview/<session>/speech`**, au lieu de la Server Action, pour que la voix ne se mette pas en
  file derrière les autres actions. Elle renvoie le MP3 lui-même.
- **Contrôles de la route**, renforcés après la revue de sécurité du 2026-11-20. La voix est payante au caractère et la
  route est publique : le lien de l'entretien suffit, et n'importe quel compte gratuit peut créer des entretiens.
  - **Pas de texte libre.** La demande désigne la phrase (`SpeechLine`, `voice-turn.ts`) :
    `{ kind: 'question', index }`, `{ kind: 'closing' }` ou `{ kind: 'reprompt' }` (`parseSpeechLine`,
    `src/lib/interview-speech-request.ts`, testé).
    - Le serveur construit les questions, le mot de la fin et la relance à partir de la session (`lineText`,
      `questionTexts`).
    - Une réponse de l'IA (relance d'une question, réponse à la question de clôture) était d'abord acceptée en texte,
      bornée à 800 caractères. Elle a été retirée avec ces réponses ([ADR 0053](0053-entretien-vocal-sans-attente.md)).
  - **Pendant l'entretien seulement** (`roomSession(…, 'live')`) : toutes les phrases de `/v2` sont dites avant que
    l'entretien soit marqué terminé.
  - **Quotas propres aux voix** (`takeSpeechSlot`, sur le modèle des transcriptions) :
    - la formule de l'organisation doit comprendre les entretiens IA ;
    - par session, `roomSpeechCap` = 5 par question + 10 ;
    - 600 par organisation et 6 000 pour toutes, par jour (`SPEECH_DAILY_LIMITS`) ;
    - compteurs `interviewRoomTts`, `interviewTtsOrg` et `interviewTtsAll`.
  - **Pas de relais vers OpenAI quand Google refuse pour quota** (429, `googleFailureAllowsFallback`) : un plafond de
    dépenses réglé chez Google arrête la dépense.
  - **Demande de la page du site** (`Sec-Fetch-Site`), corps lu par morceaux et abandonné au-delà de 4 000 octets
    (`readBoundedBody`, même sans `Content-Length`).
  - Le texte n'est jamais journalisé, l'identifiant de session seulement une fois vérifié, et le navigateur ne reçoit
    que des erreurs génériques.
- **Voix préparée à l'avance** (`prepareSpeech`, `voice-interview-room.tsx`) :
  - la première question dès que le micro est activé, pendant son test et avant « Commencer » ;
  - la question suivante, ou le mot de la fin, pendant que la question en cours est posée et que le candidat répond.
  - Les phrases dites viennent de `spokenQuestion` et `closingLine` (`voice-turn.ts`, testées), pour que la phrase
    préparée soit exactement celle qui est dite.
  - Une préparation qui a échoué est redemandée quand vient son tour.
- **Texte affiché avec la voix** : le texte de la question, le compteur « Question n / N » et le type de question
  changent quand la voix commence. Pendant l'attente, l'écran affiche « Alex réfléchit… ».
  - Les relances de l'IA et la réponse à la question de clôture ne peuvent pas être préparées : elles dépendent de la
    réponse. Elles gardent ce délai, plus court avec Google.
- **Salle actuelle** (`/interview/<session>`) inchangée : elle garde `generateInterviewSpeech`, donc Microsoft puis
  OpenAI.

## Compléments après l'essai du 2026-11-20

L'utilisateur a testé l'entretien en local, sans clé Google : enregistrements et lectures ralentissaient l'entretien,
et la première phrase avait une voix féminine, les suivantes une voix masculine.

- **Une seule écriture pendant l'entretien.** La progression n'est plus enregistrée à chaque question (une Server
  Action, que la transcription suivante attendait).
  - L'entretien est noté « en cours » une fois, pendant la première question.
  - La retranscription n'est enregistrée qu'à la fin (`completeInterview`).
  - Conséquence : un candidat qui ferme l'onglet en cours de route ne laisse aucune retranscription. L'entretien ne
    pouvait déjà pas reprendre en cours de route.
- **Lectures gardées en mémoire** (`src/lib/interview-room-access.ts`) pour les appels répétés de l'entretien :
  transcription et voix.
  - La session est gardée 60 s (`liveRoomSession`), puis relue. Elle est oubliée quand la fin est enregistrée
    (`forgetRoomSession`). La vérification de la fin et l'enregistrement lisent toujours la base (`roomSession`).
  - La formule de l'organisation est gardée 5 min.
  - La clé OpenAI de Config IA est gardée 60 s (`getRecentLLMConfig`), et effacée quand Config IA est enregistrée.
  - Cache par instance : `src/lib/ttl-cache.ts`, testé.
- **Places de quota prises ensemble** (`takeAllSlots`, `src/lib/daily-slots.ts`, testé) : session, organisation et
  plateforme en parallèle, toutes ou aucune.
  - Un appel attend environ 2 allers-retours vers Appwrite au lieu de 7 à 9.
  - Les plafonds sont inchangés.
  - La formule est vérifiée avant de prendre une place : avant, une place de la session restait prise quand la formule
    refusait.
- **Voix d'une seule couleur.**
  - Une voix en échec ou trop lente est redemandée une fois (12 s au plus) avant la voix du navigateur. Cause probable de
    l'essai : la première demande à la route, en `next dev`, comprend sa compilation.
  - La voix du navigateur prend une voix française masculine quand l'appareil en a une (`fallbackVoiceIndex`,
    `voice-turn.ts`, testé : Thomas, Paul, Henri…). Sinon, sa voix française par défaut.

## Conséquences

- La voix d'une question préparée mais jamais dite (candidat parti) est générée pour rien. C'est au plus une phrase
  par entretien, et elle est comptée sur le plafond de la session comme avant.
- **Données personnelles** : le texte dit, qui contient le nom du candidat dans l'accueil et le mot de la fin, part
  chez Google, sous-traitant couvert par les conditions de Google Cloud.
  - `/legal` doit le mentionner, avec la transcription par OpenAI (ADR 0035), avant d'envoyer des invitations vers
    `/v2`.
  - Le point d'accès européen (`eu-texttospeech.googleapis.com`) n'est pas utilisé : la disponibilité des voix
    Chirp 3 HD et l'acceptation d'une clé d'API y sont à vérifier avant de l'adopter.
- **Non vérifié à la décision** : l'acceptation d'une clé d'API par `text:synthesize`, et le nom exact des voix
  françaises. La documentation consultée montre surtout l'authentification OAuth.
  - Une clé refusée ou une voix inconnue sont journalisées (`[entretien] voix Google indisponible`) et la voix d'OpenAI
    est utilisée.
  - À contrôler sur la preview : l'en-tête `X-Voice-Provider: google`.
- **Mise en place** :
  1. Dans Google Cloud : un projet, la facturation, l'API « Cloud Text-to-Speech » activée, puis une clé d'API limitée
     à cette API.
  2. La variable `GOOGLE_TTS_API_KEY` (et `GOOGLE_TTS_VOICE` au besoin) dans le fichier local, la portée Preview de
     Vercel et `/etc/mybestconsultant/app.env`.
  3. Le déploiement. Sans la variable, le code fonctionne avec la voix d'OpenAI.
- **Risque restant**, hors de cette décision : `createInterviewSession` ne demande ni adresse vérifiée ni quota de
  création. Un compte gratuit peut donc multiplier les entretiens, dans la limite des quotas par organisation et pour
  toutes ci-dessus.
  - La salle actuelle (`generateInterviewSpeech`) lit toujours n'importe quel texte et renvoie au navigateur les erreurs
    des services.
  - À faire côté Google Cloud : une alerte de budget et un quota de caractères par minute sur le projet de la clé.
- **Retour arrière** : retirer `GOOGLE_TTS_API_KEY` (voix d'OpenAI), ou `git revert`.
