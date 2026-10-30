# 0020 — Offres AO : publication non anonymisée, au choix de la personne qui publie

- Statut : accepté
- Date : 2026-10-30
- Complète : 0013 (version publiée anonymisée et validée par une personne)

## Contexte

Toute offre AO publiée était anonymisée (ADR 0013) : client, expéditeurs, références et coordonnées retirés. Demande du
2026-10-30 : pouvoir aussi publier une offre « telle quelle », après l'avoir relue et modifiée si besoin, comme la
version anonymisée.

## Décision

- Bouton **« Publier sans anonymiser »** dans le panneau de l'offre, à côté de « Préparer la publication » : même
  formulaire de relecture, rempli avec l'offre telle que reçue (sans IA, donc sans quota), avertissement visible (le
  client sera nommé sur l'offre publique, la publication LinkedIn et les e-mails aux candidats), case « J'ai relu »
  obligatoire. Admin et recruteurs, chacun pour les offres de ses boîtes, avec les mêmes contrôles que la publication
  anonymisée.
- **Seules les coordonnées personnelles sont retirées** (`rawPublicOffer`, `anonymize.ts`) : e-mails (même déguisés),
  téléphones et lignes « Contact : … ». Nom du client, client final, références et liens restent. Retirées à la
  préparation et de nouveau à la publication (texte modifié dans le formulaire).
- **Noms de personnes signalés** : les noms connus des expéditeurs et de l'interlocuteur lu dans l'e-mail sont surlignés
  en rouge pendant la relecture s'ils restent dans le texte (`findNames`) ; ils ne sont pas retirés d'office, la
  personne qui publie décide. Les références et le client, gardés volontairement, ne sont pas signalés.
- **Anonymisée par défaut** : le serveur ne publie sans anonymiser que si la version envoyée porte
  `anonymized: false` (`publication-input.ts`, testé) ; valeur absente ou autre que « raw » à la préparation : version
  anonymisée.

## Conséquences

- Le nom du client devient public : décision de la personne qui publie, signalée par l'avertissement.
- Les coordonnées de l'interlocuteur ne sont jamais publiées, quelle que soit la version.
