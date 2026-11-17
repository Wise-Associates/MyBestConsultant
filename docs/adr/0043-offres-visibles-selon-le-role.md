# 0043 — Offres visibles selon le rôle dans l'organisation

- Statut : accepté
- Date : 2026-11-17

## Contexte

Demande de l'utilisateur du 2026-11-17 : dans « Tableau de bord », un recruteur ne doit voir que les offres qui lui sont
affectées, sauf le premier recruteur de l'organisation, qui les voit toutes, « comme un admin de l'organisation ».
Jusque-là, tout recruteur voyait et gérait toutes les offres de son organisation (et celles partagées par la plateforme).
Les rôles existent depuis l'ADR 0033 : propriétaire (`tenants.recruiterId`, le premier recruteur), administrateurs
(`tenants.adminUserIds`), membres. Le recruteur affecté d'une offre est `jobs.recruiterId` (profil, ADR 0023 ; une offre
créée est affectée à son auteur).

Choix de l'utilisateur aux questions posées :

1. **Le propriétaire et les administrateurs** voient toutes les offres ; les membres seulement les leurs.
2. La règle vaut **pour le tableau de bord et pour les pages et actions d'une offre** (contrôle d'accès côté serveur),
   pas seulement pour la liste.

## Décision

- Règle pure `viewerCanOpenJob` / `viewerCanSeeApplication` (`src/lib/job-ownership.ts`, testée) : ce que permettait
  `recruiterCanOpenJob` à l'organisation, et pour un membre seulement les offres de son organisation qui lui sont
  affectées (`recruiterId` = son profil, ou son compte Auth pour une valeur d'avant l'ADR 0023). Une offre partagée par
  la plateforme n'est affectée à personne : un membre ne la voit pas.
- `loadOfferViewer(user)` (`src/lib/offer-viewer.ts`) relit le rôle dans l'organisation (une lecture par requête). Rôle
  illisible : **vue d'un membre** (fermé par défaut), erreur journalisée.
- Appliquée :
  - au tableau de bord (`/recruiter/dashboard`) : un membre ne charge que ses offres et leurs candidatures, les
    indicateurs portent sur elles, le filtre « Recruteurs » n'est pas proposé ; et à la bibliothèque des anciennes offres
    de « Publier un job » ;
  - aux pages d'une offre : détail, Matching IA, funnel, réponse client et fiches, rapport (`/recruiter/annonces/<id>`),
    vivier de l'offre, page d'une candidature (refus : retour au tableau de bord ou « introuvable ») ;
  - aux actions : `applicationOfOrganisation` (screening, entretiens, pipeline, réponse client) prend désormais la vue
    du recruteur au lieu de son organisation ; contrôles des actions de « Mes offres » (archiver, modifier, supprimer,
    affecter, publier sur les réseaux), du funnel (déplacer, étapes, compte rendu, e-mails au candidat, entretiens liés à
    une candidature), du Matching IA et du vivier de l'offre.

## Conséquences

- Un membre ne voit plus une offre qu'on ne lui a pas affectée ; pour la lui ouvrir, le propriétaire ou un administrateur
  la lui affecte (« Mes offres », recruteur affecté). Un membre qui réaffecte sa propre offre à un collègue la perd.
- Une offre sans recruteur affecté n'est visible que du propriétaire et des administrateurs.
- **Hors périmètre, à décider** (listes qui montrent encore toutes les offres de l'organisation à un membre) : Reporting,
  Mon équipe, Screening (`/recruiter/screening`, `/recruiter/screening/best` : les actions refusent déjà les offres d'un
  autre), choix d'une offre dans le Vivier, liste des annonces, réglages des pipelines (« Étapes »), entretiens IA sans
  candidature. Les entretiens IA eux-mêmes restent ceux de l'organisation.
- Pas de changement de structure ni de variable.

## Revue de sécurité du 2026-11-17, corrigé

- Un membre s'affectait l'offre publiée d'un collègue depuis la page de son appel d'offres (« Recruteur affecté »), puis
  l'ouvrait partout. `viewerCanUseAoOffer` (`src/lib/offer-viewer.ts`) : une offre AO publiée ne s'affecte, ne montre ses
  candidats (Sourcing, « Recalculer ») et n'arrête ses tâches (« Tout arrêter ») que pour qui ouvre son offre ; le bloc
  « Recruteur affecté » est masqué sinon. Une offre AO pas encore publiée reste à toute l'organisation.
- Les écritures du funnel par `ownApplication` (funnel du candidat, étapes, validation, compte rendu), le statut de phase
  et la trace WhatsApp refusent de nouveau une candidature directe à une offre partagée par la plateforme (commune à
  toutes les organisations), comme avant le changement et comme la réponse client.
- Le rôle est lu sur le document entier de l'organisation (un select nommant `adminUserIds` échouerait là où l'attribut
  n'est pas encore poussé, et le propriétaire perdrait ses offres).

À décider : les entretiens IA (`/recruiter/interviews`, une séance et son analyse) restent ceux de toute l'organisation,
alors que le funnel n'ouvre plus à un membre l'entretien d'une candidature d'une autre offre : une seule règle à choisir.
