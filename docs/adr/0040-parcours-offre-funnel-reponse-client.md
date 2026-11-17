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
