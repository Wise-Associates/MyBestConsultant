# 0023 — Recruteur affecté : identifiant du profil (users.$id), comme l'auteur

- Statut : accepté
- Date : 2026-11-02

## Contexte

Un utilisateur a deux identifiants : son compte Auth (Appwrite Auth, `users.userId`) et le document de son profil
(collection `users`, `users.$id`, créé avec `ID.unique()`). Les offres en portaient chacune un :

- `jobs.postedBy` (auteur) : le profil, depuis la v1.0 (imports d'offres) ;
- `jobs.recruiterId` (recruteur affecté, « Mes offres ») et `ao_offer_details.assigneeId` (recruteur affecté d'un appel
  d'offres) : le compte Auth, comme `tenants.recruiterId`.

Demande du 2026-11-02 : qu'à la création d'une offre, le recruteur affecté soit **exactement** l'auteur
(`recruiterId === postedBy`), et que l'un puisse être recopié dans l'autre.

## Décision

- `jobs.recruiterId` et `ao_offer_details.assigneeId` enregistrent le **profil** (`users.$id`), comme `jobs.postedBy`.
  Règle de création : `jobOwnership` (`src/lib/job-ownership.ts`, testé) ; affectation : `recruiter-assignment.ts`
  (`AssignableRecruiter.id` = profil, `userId` = compte Auth).
- Le **compte Auth** ne sert qu'aux appels qui l'exigent : destinataire et copie de l'e-mail d'affectation (Appwrite
  Messaging). Il n'est plus envoyé au navigateur avec la liste des recruteurs (`RecruiterOption`).
- `tenants.recruiterId` (propriétaire de l'organisation, **un seul** par organisation : gestion de l'équipe, e-mails
  « entretien terminé », « le candidat a répondu », « profil proposé par un chasseur ») **reste le compte Auth** : ce
  n'est pas le recruteur d'une offre.
- Données d'avant : `npm run jobs:fill-recruiter` convertit un compte Auth en profil (même personne) dans
  `jobs.recruiterId` et `ao_offer_details.assigneeId`, et affecte à leur auteur les offres sans recruteur, après
  sauvegarde des collections touchées.

## Conséquences

- Toute comparaison du recruteur d'une offre se fait avec `user.$id` (UserProfile), jamais `user.userId`.
- **Branche `feat/parcours-consultant`** : `/recruiter/espace` (ADR 0022) filtre « Mes recrutements » sur
  `jobs.recruiterId === user.userId` et `recruiter-workspace.ts` documente le compte Auth : à passer à `user.$id` en
  fusionnant.
- Mise en production : déployer le code, puis lancer aussitôt `jobs:fill-recruiter -- .env --prod --apply` (par un
  humain). Entre les deux, une offre affectée avant l'ADR s'affiche « Recruteur hors de l'équipe » jusqu'à la conversion ;
  la réaffecter dans « Mes offres » la corrige aussi.
- `vivier_cvs.recruiterId` enregistrait déjà le profil : les recruteurs sont désormais désignés de la même façon partout,
  sauf le propriétaire de l'organisation.
