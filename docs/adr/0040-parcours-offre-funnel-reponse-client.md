# 0040 — Parcours d'une offre : détail, funnel avec compte rendu obligatoire, réponse client

- Statut : accepté
- Date : 2026-11-17

## Contexte

Demande de l'utilisateur du 2026-11-17, avec maquettes (« Parcours recruteur : du Job board à la réponse client ») :

- « Mes offres » : indicateurs en haut, filtres dans un panneau ouvert par un bouton « Filtres » (le rail de gauche
  disparaît), « Voir pipeline » dans les actions ; le titre d'une offre ouvre son détail, plus son matching.
- Une offre a trois onglets : Matching IA | Funnel | Réponse client. « Funnel » est le pipeline actuel.
- Dans le funnel, chaque étape a un compte rendu (« pourquoi le candidat avance ») ; sans lui, on ne passe pas à
  l'étape suivante.
- Les candidats retenus sont envoyés au client ; ses réponses sont enregistrées.

Choix de l'utilisateur le même jour, aux questions posées :

1. « Envoyer une sélection au client » **note l'envoi et donne une synthèse imprimable** (PDF du navigateur) que le
   recruteur transmet lui-même. MBC n'envoie aucun e-mail et ne stocke aucune adresse du client.
2. Un candidat est envoyable s'il a **au moins une étape validée avec un compte rendu** (la synthèse n'est jamais vide).
3. Réponse « Retenu » : le candidat **passe dans « Embauchés »** automatiquement.
4. Le compte rendu est exigé pour **tout déplacement** hors de l'étape en cours, refus et mise en vivier compris.

## Décision

- **Détail d'une offre** : `/recruiter/offres/<id>` (description, suivi, informations clés, diffusion). Mêmes règles
  d'accès que le funnel (`recruiterCanOpenJob`, `recruiterCanSeeApplication`). Pas de « Démarrage » : la date n'existe
  pas dans `jobs` (16/16 attributs).
- **Onglets** (`JobTabs`) : à toutes les largeurs, « Réponse client » n'ayant pas d'autre lien. Pastilles du funnel et
  des envois ; pas de pastille sur « Matching IA » : son nombre exige tout le calcul du matching (dédoublonnage, viviers),
  trop coûteux pour les autres onglets.
- **Compte rendu obligatoire** : règle pure `stepBlockingMove` (`src/lib/candidate-funnel.ts`, testée). Un candidat ne
  quitte l'étape en cours de son funnel que si elle a un compte rendu ; rejoindre la colonne de l'étape en cours
  (arrivée en Screening) et un parcours terminé restent libres. Vérifiée par le pipeline (message immédiat) **et** par le
  serveur dans chaque action qui déplace une carte : `moveApplicationStage`, `launchScreeningAction` (avant l'analyse
  payante), `sendInterviewInviteAction` (avant l'e-mail), et `validateStepAction` exige résultat **et** compte rendu.
  « Étape suivante » sur la carte valide l'étape avec ce qui est enregistré, sinon ouvre le funnel du candidat.
- **Réponse client** : un champ `applications.clientJson` (chaîne de 2 000, JSON validé par zod :
  `src/lib/client-response.ts`, testé) plutôt qu'une collection : une candidature n'est envoyée qu'une fois, et la
  réponse se lit avec elle. L'envoi garde les **identifiants des étapes** envoyées : elles sont validées, donc figées
  (une étape validée ne se modifie ni ne se supprime), et la synthèse reste celle envoyée même si le funnel avance.
- **Synthèse imprimable** : `/recruiter/pipeline/<id>/client/synthese?ids=…`, nom du candidat et comptes rendus
  envoyés seulement (ni score, ni coordonnées).
- **« Retenu »** : `retainedFunnel` passe les étapes non faites, valide l'étape « Embauché » avec la réponse du client
  comme compte rendu (la décision vient du client : la règle du compte rendu ne la bloque pas) et déplace la carte, en
  une seule écriture avec la réponse. Un funnel sans étape « Embauché » est clos (étapes restantes « passées ») : sinon
  son étape en cours, sans compte rendu, empêcherait la carte de quitter « Embauchés ».

## Conséquences

- **Mise en production** : `npm run schema:push -- dev` puis prod (avec sauvegarde) **avant** le déploiement, pour
  `clientJson`. Sans lui, l'onglet s'affiche mais « Envoyer » et les réponses renvoient « La réponse client n'est pas
  encore activée » (erreur journalisée), et les pastilles des onglets de la page Matching IA restent masquées.
- Un candidat dont l'étape en cours n'a pas de compte rendu ne peut plus être refusé ni mis en vivier d'un clic : il faut
  d'abord rédiger le compte rendu (choix 4).
- Changer la réponse d'un candidat retenu ne le sort pas d'« Embauchés » : le recruteur le déplace lui-même.
- Le nom du candidat figure sur la synthèse imprimée, comme sur l'écran de la maquette. Le « Format ESN » du CV, lui,
  reste anonymisé (ADR 0024) : à aligner si le client ne doit pas voir les noms avant un entretien.
- Revue de sécurité du même jour, corrigés au passage (code plus ancien qui contournait la règle) :
  - `setApplicationStatusAction` (boutons Retenir / Refuser / Vivier de la fenêtre « Candidatures ») changeait le statut
    de n'importe quelle candidature, de toute organisation : supprimée, la fenêtre appelle `moveApplicationStage`.
  - « Personnaliser le funnel » acceptait du navigateur des étapes validées ou passées (règle contournée, synthèse
    falsifiable) : `customizedFunnel` garde les étapes validées enregistrées et refuse toute nouvelle validation.
  - `createInterviewSession` déplaçait la carte en « Entretien IA » sans compte rendu : l'entretien est créé, la carte ne
    bouge que si la règle le permet (`funnelMoveRefusal`, `src/lib/appwrite/funnel.ts`).
  - Les actions de la réponse client écartent une candidature directe à une offre partagée (son `clientJson` serait
    commun à toutes les organisations).
- Corrigé aussi : « Modifier » une offre dans « Mes offres » appelait l'action de l'admin (`updateJob`, réservée aux
  admins) et échouait toujours pour un recruteur. Nouvelle action `updateOwnJobAction` (offre de l'organisation, champs
  validés par zod, ni statut ni expiration). Et les étiquettes et la note des cartes du funnel n'étaient pas relues
  (`docToApp`).

## Mise à jour du 2026-11-17 (après-midi) : fiche candidat pour le client, envoi élargi, CV des embauchés

Demande de l'utilisateur : « Réponse client » doit proposer les candidats du funnel, pas seulement ceux déjà avancés ; le
PDF doit être une vraie fiche candidat à proposer au client ; un candidat embauché doit pouvoir sortir son CV au format du
cabinet. Choix aux questions posées :

1. **Envoyables : tous les candidats du funnel, sauf ceux de « Refusé »** (`newSubmission`, `REJECTED_COLUMN`). Le compte
   rendu n'est plus exigé pour l'envoi (remplace le choix 2) ; les étapes validées avec un compte rendu restent notées
   à l'envoi et forment la rubrique « Avis du cabinet ».
2. **Fiche anonymisée** : initiales, sans e-mail, téléphone ni lien, comme le « CV format cabinet » (ADR 0024). Remplace
   la conséquence « le nom figure sur la synthèse » ci-dessus.
3. **Contenu** : profil (dernier poste, années d'expérience, ville, résumé, compétences clés, langues), parcours et
   formation (CV analysé, `users.cvProfileJson`), adéquation au poste (score aux poids du recruteur, part de chaque
   critère, avis de l'IA), comptes rendus validés, interlocuteur (recruteur qui a noté l'envoi).

Mise en œuvre :

- Règles pures `src/lib/client-sheet.ts` (testées) : `buildClientSheet` lit le CV analysé sans confiance (zod, champ
  abîmé laissé vide) et passe **chaque texte imprimé** par `scrubIdentity`. Noms retirés : celui du compte **et** celui lu
  sur le CV (`cvProfileJson.candidateName` : nom d'usage, profil de chasseur au nom tiré du fichier ; les valeurs de
  remplacement « Profil sans nom », « CV » ignorées). Nom complet ou composé remplacé par les initiales quelle que soit la
  casse, sans tenir compte des accents ni des apostrophes ou tirets (« HELENE LEFEVRE », « d’Artagnan », « Jean Pierre
  Martin », « La Tour ») ; mot seul (3 lettres au moins, hors particules) seulement s'il porte une majuscule, pour ne pas
  toucher « le » ou « petit ». Retirés aussi : mot contenant le nom collé (« marie-durand-42 », « mariedurand.dev »),
  e-mails (même « [at] »), liens (liste de `leak-check.ts`), toute suite de 9 à 15 chiffres sauf une suite d'années,
  adresse postale, date de naissance. Filet : un mot du nom resté en minuscules (`namesLeft`) affiche à l'écran, sans
  l'imprimer, « À vérifier avant de transmettre » avec la rubrique. Revue de sécurité du même jour : ces cas venaient de
  ses essais ; aucun accès d'une organisation aux données d'une autre trouvé.
- Page `/recruiter/pipeline/<id>/client/synthese?ids=…` (même adresse) : une fiche par page A4 à l'impression ;
  `loadClientSheets` (`client/data.ts`) reprend les règles d'accès de l'onglet et ne lit le compte que des candidatures
  envoyées demandées (50 au plus).
- **« CV format cabinet » sur les cartes d'« Embauchés »** et dans le panneau d'un candidat envoyé de « Réponse client »
  (à côté de « Fiche PDF ») : la fenêtre d'export de la CV Thèque (`EsnExportDialog`,
  `/api/recruiter/cv-export/<candidat>`, mêmes droits, quota et versions enregistrées). Sans modèle déposé, le bouton mène
  à la CV Thèque. Absent pour le profil d'un chasseur (pas de compte candidat : l'export ne le connaît pas).
- Une candidature directe à une offre de la plateforme n'est plus proposée à l'envoi (le serveur la refusait déjà : son
  envoi serait commun à toutes les organisations).

## Mise à jour du 2026-11-17 (soir) : client de l'offre

Demande : pouvoir indiquer le nom et l'e-mail du client. Choix aux questions posées : **un client par offre** (renseigné une
fois dans « Réponse client », modifiable) ; MBC **l'enregistre et prépare le message**, sans rien envoyer lui-même
(remplace « ne stocke aucune adresse du client » du choix 1).

- Société (200), contact (120), e-mail (facultatif, validé) : `jobClientSchema` (`src/lib/client-response.ts`, testé).
  « Écrire au client » (`clientMailto`) ouvre la messagerie du recruteur avec l'adresse, un objet et un court texte
  (après un envoi : « les fiches des N candidats ») ; le recruteur joint le PDF.
- Collection **`job_clients`** (tenantId, jobId, company, contactName, email ; index `jobId`) : `jobs` est à 16/16
  attributs. Un document par offre **et** organisation (une offre de la plateforme est partagée), d'identifiant déduit des
  deux (`src/lib/appwrite/job-clients.ts`) : lecture sans index ni requête. Écriture par `saveJobClientAction` (recruteur,
  offre visible de son organisation, zod) ; tout vide : le client est retiré.
- Sur les fiches : « À l'attention de <contact>, <société> » (pas l'e-mail).
- Données personnelles du contact du client : gardées tant que l'offre existe ; **supprimées avec l'offre**
  (`deleteJobClients` dans la suppression recruteur et admin, jamais bloquant, échec journalisé).
- Mise en production : `npm run schema:push -- dev` puis prod (création de `job_clients`), **puis** la variable
  `APPWRITE_COLLECTION_JOB_CLIENTS=job_clients` (`.env.example`). Sans elle, l'onglet affiche « Client de l'offre : pas
  encore activé » et le reste marche.
