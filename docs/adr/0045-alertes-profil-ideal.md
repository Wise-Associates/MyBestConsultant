# 0045. Alertes « profil idéal » du recruteur

Date : 2026-11-18. Statut : accepté, modifié par l'[ADR 0047](0047-correspondances-ia-nouveaux-candidats.md) : seuil
réglable par recruteur (70 par défaut) à la place du 85 fixe, alertes du vivier retirées.

## Contexte

Demande du 2026-11-18 : ajouter une rubrique « Alertes » au menu de l'espace recruteur, sous « Mon vivier ». Quand un
candidat a le profil idéal pour une offre, le recruteur doit recevoir un e-mail. Jusqu'ici, il ne voyait un bon profil
qu'en ouvrant le Matching IA de l'offre.

Choix de l'utilisateur :

- **profil idéal** = score de 85 ou plus, le niveau « top » des recommandations (`recommendationFor`) ;
- **les quatre origines d'un score** déclenchent l'alerte : candidature reçue, base candidats, vivier général, vivier de
  l'offre ;
- **destinataire** : le recruteur affecté à l'offre ;
- **page** : l'historique des alertes et un interrupteur pour les e-mails.

## Décision

- **Seuil** : `IDEAL_SCORE = 85` (`src/lib/recruiter-alerts.ts`). Il s'applique au score enregistré, calculé avec les
  poids par défaut. Les poids personnels d'un recruteur ne changent que l'affichage (ADR 0036), pas l'alerte.
- **Points de déclenchement** : juste après l'écriture du score, par `alertIdealCandidates`
  (`src/lib/recruiter-alerts-store.ts`, `server-only`).
  - Candidature : `autoScreenApplication` (`screening-core.ts`) et `screenAllApplications` (screening). Pas pour un
    candidat que le recruteur vient d'ajouter au funnel depuis le Matching IA (`notify: false`).
  - Base candidats : `runPoolMatching` (`matching-core.ts`), à la publication de l'offre et par « Rafraîchir ».
  - Vivier de l'offre : `matchVivierCvAgainstJob` (`matching-core.ts`).
  - Vivier général : `compareWithNewOffers` (`vivier/actions.ts`), une alerte par offre.
- **Destinataire** :
  - candidature et base : le recruteur affecté à l'offre (`jobs.recruiterId`), sinon son auteur (`postedBy`) ;
  - vivier : le recruteur qui a importé le CV, puisqu'un vivier est personnel et qu'aucun collègue ne peut ouvrir le CV.
  - Dans tous les cas, seulement un compte de rôle `recruiter` de l'organisation de l'offre **qui peut ouvrir l'offre**
    (`viewerCanOpenJob`, ADR 0043). Un membre qui importe dans son vivier général un CV noté 85 sur l'offre d'un
    collègue n'est donc pas prévenu : l'e-mail lui apprendrait l'intitulé de cette offre.
  - Offre partagée de la plateforme (`tenantId` vide) et AO de la plateforme (admin) : pas d'alerte.
  - Sur la page, même règle : une offre que le recruteur n'ouvre plus (réaffectée depuis) apparaît « Offre non
    accessible ».
- **Une seule fois** par offre, recruteur et personne.
  - L'identifiant du document est tiré des trois (`alertDocId`). Une seconde création échoue en 409 : deux notations,
    même simultanées, n'envoient qu'un e-mail.
  - Une même personne qui postule après avoir été trouvée dans la base n'est pas alertée deux fois (`alertSubjectKey`).
  - Une offre réaffectée peut alerter son nouveau recruteur.
- **Stockage** : collection `recruiter_alerts` (aucune permission client, index `recipientId`). Elle a 12 attributs sur
  16 depuis l'ADR 0046, qui y range aussi les alertes des recherches enregistrées : `jobId` et `score` sont facultatifs,
  et `searchId`, `emailedAt`, `emailError` et `emailAttempts` sont ajoutés.
  - Elle ne contient que des identifiants (organisation, recruteur, offre, personne), la source, le score et l'état de
    l'e-mail : `pending`, puis `sent`, `failed` ou `off`.
  - Le nom du candidat et l'intitulé de l'offre sont relus à l'affichage. Une personne supprimée apparaît « Profil
    supprimé », sans lien. Un CV du vivier n'est montré qu'au recruteur qui l'a importé.
- **E-mail** : Appwrite Messaging, adressé au compte Auth du recruteur, avec le contenu de `idealCandidateEmail`
  (textes échappés, lien vers le profil et vers la page des alertes).
  - Le recruteur peut couper les e-mails : préférence `alertEmails` de son compte, comme ses poids. Les alertes restent
    alors enregistrées, à l'état « Sans e-mail ».
  - Préférence illisible : pas d'e-mail, alerte à l'état « E-mail non envoyé », cause journalisée.
- **Une alerte ne fait jamais échouer une notation** : chaque erreur est journalisée (`[alertes]`). Sans la variable
  `APPWRITE_COLLECTION_RECRUITER_ALERTS`, rien n'est enregistré ni envoyé, et la page le dit.
- **Page** `/recruiter/alertes` : interrupteur des e-mails, puis les 100 dernières alertes (date, candidat, offre,
  source, score, état de l'e-mail, « Voir le profil », « Matching IA »).

## Conséquences

- Une notation qui donne un profil idéal fait quelques lectures de plus et envoie un e-mail. `runPoolMatching` peut en
  produire plusieurs, traités 3 à la fois.
- **Pas d'alerte pour les scores déjà enregistrés** : seules les notations faites après la mise en place en créent.
- **Conservation** : pas encore de purge. Les alertes ne contiennent que des identifiants et un score. Elles restent
  après la suppression du candidat ou du recruteur, la page ne montrant plus la personne. Une purge (par exemple après
  12 mois) est à décider.
- **Mise en place**, dans cet ordre :
  1. `npm run schema:push -- dev` (collection `recruiter_alerts`), puis vérifier dans la console que les attributs sont
     « available » ;
  2. la variable `APPWRITE_COLLECTION_RECRUITER_ALERTS=recruiter_alerts` (fichier local, portée Preview de Vercel) ;
  3. le déploiement.
  - Production, par un humain : sauvegarde, `schema:check -- prod`, `schema:push -- prod`, puis la variable dans
    `/etc/mybestconsultant/app.env`, avant la mise en production du code.
  - Avant la variable, le code est sans effet.
