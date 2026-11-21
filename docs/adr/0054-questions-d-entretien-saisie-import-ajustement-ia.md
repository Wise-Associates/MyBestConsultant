# 0054 — Questions d'un entretien IA : saisie, import PDF / TXT et ajustement par l'IA

- Statut : accepté (2026-11-21)
- Date : 2026-11-21

## Contexte

Demande du 2026-11-21 : dans le pipeline, préparer un entretien IA avec le même écran que
`/recruiter/interviews/new`. Le recruteur doit pouvoir ajouter ses questions dans un champ ou les importer d'un fichier
PDF ou TXT, ce qui demande un lecteur de questions. L'IA doit ensuite pouvoir les ajuster.

Avant :

- La fenêtre « Entretien IA » du pipeline faisait générer les questions par l'IA dès l'ouverture, et créait tout de
  suite l'entretien. Le recruteur pouvait seulement modifier ou supprimer les questions.
- `/recruiter/interviews/new` avait sa propre présentation, sans import ni ajustement.

Choix de l'utilisateur :

- **une fenêtre dans le pipeline**, de même présentation que `/recruiter/interviews/new`, avec des composants partagés ;
- **« Retravailler et compléter »** pour l'ajustement ;
- **« Découpage intelligent »** pour le lecteur de fichiers.

## Décision

- **Composants partagés** (`src/components/interviews/`) : `InterviewConfigForm` (candidat, poste, CV, nombre de
  questions, format audio / vidéo) et `InterviewQuestionsEditor` (cartes des questions avec leur catégorie).
  - Ils servent à `/recruiter/interviews/new` et à la fenêtre du pipeline.
- **Deux départs** après la configuration :
  - « Générer les questions » : l'IA, comme avant ;
  - « Écrire ou importer mes questions » : les questions par défaut de l'organisation, puis celles du recruteur.
- **Ajouter** : un champ et une catégorie. 30 questions au plus par entretien (`sessionInputSchema`), 1 000 caractères
  au plus par question.
- **Importer un fichier** (`importInterviewQuestionsFile`, `question-tools-actions.ts`) :
  - Contrôles : recruteur dont la formule comprend les entretiens IA, 2 Mo au plus, PDF ou TXT, type vérifié par les
    premiers octets.
  - Lecture d'un PDF : `extractTextFromFile` en mode strict, 50 pages et 60 000 caractères au plus.
  - Lecture d'un TXT : UTF-8, sinon Windows-1252.
  - Lecteur pur `parseInterviewQuestions` (`src/lib/interview-question-parser.ts`, testé) :
    - les éléments numérotés ou à puces deviennent des questions (`1.`, `2)`, `(3)`, `Q4 :`, `Question 5 -`, `a)`,
      `-`, `•`, `*`), ainsi que les lignes terminées par « ? ».
    - Un élément continue sur les lignes suivantes tant qu'il ne se termine pas par une ponctuation. Une question sans
      numéro peut reprendre les deux lignes non terminées qui la précèdent.
    - Un titre court (« Questions techniques », « ## Motivation », « Pour finir : ») donne la catégorie des questions
      qui suivent. Une phrase n'est jamais prise pour un titre, même si elle contient un mot de catégorie.
    - Les numéros de page et le texte d'introduction sont ignorés.
    - Les doublons sont retirés. 30 questions au plus, de 8 à 1 000 caractères. Catégorie par défaut : « Technique ».
  - Les questions importées s'ajoutent à la liste, sans doublon. Le recruteur les relit avant d'envoyer.
- **Ajuster avec l'IA** (`tuneInterviewQuestions`, règles `src/lib/interview-question-tuning.ts`, testées) :
  - L'IA reformule les questions du recruteur : claires, en français avec « vous », neutres, adaptées au poste et au
    résumé du CV.
  - Elle garde leur sens et leur ordre, et donne à chacune sa catégorie.
  - Elle n'en ajoute que pour atteindre le nombre choisi.
  - Les questions par défaut de l'organisation (`gq-`) ne lui sont pas envoyées et restent telles quelles.
  - Une réponse qui perd une question, en ajoute trop ou est illisible est refusée : les questions restent inchangées.
  - Module « Entretiens IA » de Config IA. Une place sur le quota du jour des entretiens IA (`takeInterviewAiSlot`),
    prise avant l'appel.
  - Les questions et les textes fournis sont donnés à l'IA comme des données, pas comme des consignes.
  - « Annuler l'ajustement » remet la liste d'avant.
- **Pipeline : l'entretien n'est créé qu'à l'envoi** (`sendPipelineInterviewAction`). Cette action remplace
  `prepareInterviewAction`, `cancelInterviewAction` et `sendInterviewInviteAction`. Dans l'ordre :
  1. candidature de l'offre que le recruteur ouvre, et règle du compte rendu (`funnelMoveRefusal`), vérifiées avant
     tout ;
  2. `createInterviewSession`, avec ses propres contrôles ;
  3. titre facultatif ;
  4. invitation par e-mail au format choisi.
  - Invitation partie : la carte passe dans la colonne de l'entretien.
  - Invitation en échec : la candidature reprend son statut, l'entretien reste, et son lien est affiché à copier.
  - Fermer la fenêtre avant l'envoi ne laisse rien. Un clic à côté de la fenêtre ne la ferme pas pendant la rédaction
    des questions.

## Revue de sécurité du 2026-11-21

- **Lecteur linéaire.** Garder toute la liste des lignes en attente rendait la lecture quadratique : 7,6 s de blocage du
  serveur pour un TXT de 30 000 lignes courtes. Seules les deux dernières lignes sont gardées, et un élément n'est plus
  allongé au-delà de 1 000 caractères. Test de temps sur des textes hostiles.
- **PDF refusé avant pdf.js s'il se décompresse trop** (`src/lib/pdf-inflate-guard.ts`, testé). C'est une faille plus
  ancienne de `extractTextFromFile`, partagée avec l'import d'offres et l'export des CV : un PDF de 1 Mo décompressé en
  1 Go prenait 1,6 Go de mémoire.
  - Chaque flux Deflate est décompressé une fois par zlib, en tâche de fond et avec un plafond : 64 Mo par flux,
    192 Mo pour le document, 4 couches au plus. Toutes les tailles de fenêtre sont mesurées.
  - Sont refusés : un PDF chiffré (pdf.js le déchiffre seul), les filtres LZW, RunLength, ASCII85 et ASCIIHex, et un
    filtre donné par référence.
  - Vérifié sur un vrai PDF : celui de LibreOffice est toujours lu, un PDF de 299 Ko qui se décompresse en 300 Mo est
    refusé en 0,45 s.
- **Import limité** : adresse e-mail vérifiée, 50 fichiers par organisation et 1 000 pour toutes, par jour
  (`INTERVIEW_IMPORT_DAILY_LIMITS`, compteurs `interviewImportOrg` / `interviewImportAll`).
- **Envoi depuis le pipeline** :
  - Le candidat (nom, adresse) et le poste sont lus sur la candidature et l'offre, pas dans la demande. Ils sont en
    lecture seule dans la fenêtre.
  - Le titre est vérifié avant la création.
  - Toute erreur après la création de l'entretien rétablit le statut de la candidature et rend le lien à copier.
- **Restes, hors de ce changement** (signalés, non corrigés) :
  - les e-mails de fin d'entretien (`src/app/(public)/interview/[sessionId]/actions.ts`) insèrent le nom du candidat
    et le poste sans les échapper ;
  - une candidature directe à une offre partagée par la plateforme peut changer de statut depuis n'importe quelle
    organisation (`visibleApplication`, comme avant) ;
  - le contrôle des PDF ne couvre pas un flux image JPEG détourné. L'isolement de la lecture des PDF dans un processus à
    part (délai et mémoire) reste la protection complète.

## Conséquences

- Le format audio / vidéo, d'abord proposé dans le pipeline, en a été retiré le jour même : le pipeline envoie toujours en vidéo ([ADR 0055](0055-invitations-vers-l-entretien-vocal-et-nombre-de-questions.md)). Le lien n'est montré
  qu'après l'envoi.
- Certains PDF sont refusés par l'ancienne version de pdf.js du projet (`pdf-parse` 1.1.1), par exemple un PDF de test
  produit par ReportLab (« Command token too long »). Le recruteur voit « PDF illisible » et peut passer par un TXT. Un
  PDF exporté par LibreOffice est lu correctement : c'est la même lecture que pour les autres imports de l'application.
- Un PDF scanné, sans texte, ne donne aucune question et un message le dit. La lecture des images n'est pas prévue ici.
- Un PDF protégé (chiffré, même sans mot de passe d'ouverture) ou très lourd une fois décompressé (au-delà de 192 Mo,
  par exemple de nombreuses pages scannées en couleur) est refusé partout où l'application lit un PDF. Hors mode strict
  (import d'offres), le repli ne lit que les octets bruts.
- Retour arrière : `git revert`. Aucune donnée ni variable : les entretiens créés gardent le même format.
