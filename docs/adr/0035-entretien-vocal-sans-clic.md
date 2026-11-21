# 0035 — Entretien vocal sans clic (/interview/<session>/v2)

- Statut : accepté (page livrée le 2026-11-14, non reliée aux invitations) ; voix d'Alex revue par l'[ADR 0052](0052-voix-de-l-entretien-vocal-google-et-preparee.md) ; relance et réponse de l'IA retirées, transcription en arrière-plan : [ADR 0053](0053-entretien-vocal-sans-attente.md) ; toutes les invitations y mènent : [ADR 0055](0055-invitations-vers-l-entretien-vocal-et-nombre-de-questions.md)
- Date : 2026-11-14

## Contexte

Dans la salle d'entretien du candidat (`/interview/<session>`), la réponse orale passe par la reconnaissance vocale du
navigateur (Web Speech API) : le candidat clique sur le micro, parle, clique pour arrêter, puis sur « Envoyer ». Le
2026-11-14, en test : la reconnaissance écoutait sans rien transcrire puis s'arrêtait seule, sans message ; réponse vide,
« Envoyer » grisé, entretien bloqué. Cette reconnaissance n'existe que dans Chrome et Edge (Safari en partie), dépend du
service de chaque navigateur et ne dit pas pourquoi elle échoue.

Demande du 2026-11-14 : un entretien « fluide, sans action du candidat jusqu'à la fin », sur le modèle de micro1, dans une
nouvelle page `/v2`, **sans modifier la salle actuelle**.

## Décision

Choix de l'utilisateur (2026-11-14), parmi trois moteurs (reconnaissance du navigateur envoyée automatiquement ; voix
temps réel d'OpenAI de bout en bout ; transcription serveur + IA actuelle) :

- **Transcription côté serveur** (API de transcription d'OpenAI, modèle `gpt-transcribe` par défaut,
  `OPENAI_TRANSCRIBE_MODEL` pour en changer ; clé OpenAI de Config IA ou `OPENAI_API_KEY`) + **l'IA et la voix
  actuelles** (relance de `getCandidateAIFollowUp`, question de clôture de `answerClosingQuestion`, voix Henri de
  `generateInterviewSpeech`). Marche dans tout navigateur récent ; 2 à 4 s entre la fin d'une réponse et la suite.
- **Questions préparées + une relance au plus**, comme la salle actuelle : durée, coût et analyse inchangés.
- **Adresse** : `/interview/<session>/v2`, même identifiant d'invitation, `?mode=audio` / `?mode=video` comme aujourd'hui.

Déroulé (`src/app/(public)/interview/[sessionId]/v2/voice-interview-room.tsx`) : le candidat active caméra et micro
(jauge de test), clique sur « Commencer » ; Alex dit chaque question ; le navigateur écoute et décide seul de la fin de
la réponse (`src/lib/voice-turn.ts`, pur, testé : bruit de fond mesuré au début de chaque écoute, seuil de parole,
**2 s de silence** après au moins 0,6 s de parole ; rien entendu en 20 s : une relance orale puis la suite ; réponse
coupée à 3 min ; bouton facultatif « J'ai terminé ma réponse ») ; la réponse part au serveur, revient en texte, l'IA
décide d'une relance ; l'entretien enchaîne jusqu'au mot de la fin. Enregistrement continu (micro + voix d'Alex +
caméra) envoyé à la fin vers le bucket des enregistrements et rattaché, comme dans la salle actuelle.

**Contrôles** de la nouvelle action `transcribeInterviewAnswer` (`v2/actions.ts`), comme les autres actions de la salle
(`interview-room-access.ts`) : entretien en cours seulement ; audio de 1,5 Mo au plus (`MAX_ANSWER_AUDIO_BYTES` : 3 min
au débit de la page avec de la marge) dont le format est lu dans ses premiers octets (WebM, MP4 de Safari, Ogg ; tout
autre contenu refusé avant OpenAI) ; contexte de la transcription (poste, question désignée par son identifiant) lu sur
l'entretien, jamais un texte du navigateur ; formule de l'organisation comprenant les entretiens IA ; plafonds du jour
**propres aux transcriptions** (`takeTranscriptionSlot`) : par session (`roomTranscriptionCap` : 4 par question + 10,
compteur `interviewRoomStt`), par organisation (300) et pour toutes (3 000) (`TRANSCRIPTION_DAILY_LIMITS`, compteurs
`interviewSttOrg` / `interviewSttAll`) — pas le quota `interviewAi` des recruteurs, qu'un candidat ne doit pas pouvoir
épuiser. Cause d'un échec d'OpenAI (crédits, clé, modèle) dans le journal seulement ; le navigateur reçoit
« Transcription impossible ». Le plafond des autres appels de la salle (`roomCallCap`) et `takeRoomSlot` sont inchangés.
La fin de l'entretien est vérifiée (`interviewCompleted`) avant de l'annoncer au candidat : `saveInterviewProgress` ne
dit pas s'il a refusé ; un second essai, puis un message qui lui demande de prévenir le recruteur.

**Pannes** : aucune ne bloque l'entretien. Voix d'Alex indisponible : voix du navigateur (sous-titre affiché, délai de
lecture en filet). Transcription impossible ou micro qui ne s'enregistre plus : champ de réponse écrite pour cette
réponse, puis l'entretien reprend à la voix. Micro refusé avant le début : message et lien vers l'entretien avec
réponses écrites (`/interview/<session>`). Chaque panne est signalée une fois par visite (fichier
`interview-<id>-ERROR.txt` du bucket des enregistrements, `reportRecordingFailure`) et journalisée.

## Conséquences

- **Données personnelles** : la voix du candidat part chez OpenAI (sous-traitant, comme les scans des AO et les photos
  des affiches) le temps de la transcription ; rien n'est gardé côté plateforme hors de l'enregistrement continu, déjà
  conservé par la salle actuelle. L'écran d'accueil de `/v2` le dit au candidat ; la politique de confidentialité
  (`/legal`) doit aussi le citer avant d'envoyer des invitations vers `/v2`.
- **Coût** : une transcription par réponse et par relance, facturée à la minute de son par OpenAI, en plus des appels
  d'IA de la salle actuelle ; le nombre d'appels est borné par les plafonds ci-dessus.
- **Risque restant (revue de sécurité du 2026-11-14)** : OpenAI facture la durée, le serveur ne borne que la taille. Le
  navigateur coupe une réponse à 3 min, mais un appel fabriqué à très bas débit (Opus à 6 kbit/s) loge environ 35 min
  dans 1,5 Mo ; OpenAI ne renvoie pas la durée facturée (rien à décompter après coup). Un recruteur inscrit sans adresse
  vérifiée peut créer des entretiens (`createInterviewSession`) et s'en servir de service de transcription, dans la
  limite de 300 appels par organisation et 3 000 pour toutes par jour. Pour fermer : compter la durée réelle avant
  OpenAI (trames Opus du WebM / Ogg, échantillons AAC du MP4 de Safari ; refus au-delà d'environ 200 s), et/ou exiger
  l'adresse vérifiée pour créer un entretien, comme pour les autres fonctions d'IA des recruteurs.
- **Mise en place** : une clé OpenAI (Config IA ou `OPENAI_API_KEY`) sur l'environnement ; aucune structure Appwrite.
  Sans clé, chaque réponse passe en champ écrit (l'entretien reste possible, la panne est signalée).
- **Pas encore fait** : les invitations (screening, pipeline, nouvel entretien) pointent toujours vers la salle actuelle ;
  passer à `/v2` se fera là, après des essais réels. Pas d'interruption d'Alex par le candidat (écoute à l'alternat) :
  il faudrait l'API temps réel, écartée ici.
- Le seuil de silence (2 s) et les autres valeurs sont dans `TURN_RULES` ; tout changement passe par ses tests.
