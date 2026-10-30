# 0021 — Parcours consultant : de l'appel d'offres à la facture

- Statut : accepté
- Date : 2026-10-30

## Contexte

Le product owner décrit le métier en une suite d'étapes : importer les appels d'offres, les publier, les comparer aux
CV avec un score, faire avancer le candidat dans le funnel, organiser les entretiens, valider le CV, le mettre au format
du cabinet, l'envoyer au client, proposer un contrat, demander le timesheet, puis faire la facture. Les premières étapes
existent déjà dans l'application (AO Offers, publication, matching, pipeline, entretiens IA, CV format cabinet), mais
rien ne suit un consultant d'un bout à l'autre, et rien ne couvre l'après-recrutement (client, contrat, timesheet,
facture). Demande du 2026-10-30 : un suivi sur le modèle d'un outil de gestion de contrats (bandeau d'étapes
horizontal, panneau « Actions », pièces avec un statut).

## Décision

- **Un parcours par candidature** (un candidat sur une offre) : collection `consultant_journeys`, document de même
  identifiant que la candidature (deux parcours pour une candidature sont impossibles), sans permission client.
  Attributs : organisation, offre, candidat, étape, statut (`active` / `abandoned`), pièces (JSON), historique (JSON,
  200 derniers événements), version.
- **Onze étapes** (`src/lib/consultant-journey.ts`, règles pures testées) : AO importé, Publié, Matching & score,
  Funnel, Entretiens, CV validé, CV format cabinet, Envoyé au client, Contrat, Timesheet, Facture. Les trois premières
  ont lieu avant la candidature : elles sont **lues** sur l'offre (identifiant `ao<offre>` = publiée depuis un AO,
  sinon « Offre directe ») et sur la candidature (score IA), jamais enregistrées. Le parcours enregistré commence au
  funnel.
- **Pièces et règles de passage** : chaque étape à partir de « CV format cabinet » a une pièce dont le premier statut
  est posé en entrant dans l'étape. On ne passe à l'étape suivante que si la pièce a le statut attendu : CV prêt pour
  l'envoyer au client, consultant retenu par le client pour proposer un contrat, contrat signé pour demander le
  timesheet, timesheet validé pour préparer la facture. Facture payée = parcours terminé. Retour à l'étape précédente
  possible (les pièces gardent leur statut), abandon avec un motif facultatif, puis reprise.
- **Écran** : `/recruiter/parcours` (rubrique « Parcours » du sous-menu, liste des parcours de l'organisation) et
  `/recruiter/parcours/<candidature>` (bandeau, pièces, historique, panneau « Actions » avec des liens vers les outils
  existants de l'étape : AO, pipeline, entretien IA, fiche candidat, CV Thèque). Le parcours se démarre depuis la fiche
  candidat (bouton « Parcours consultant »).
- **Sécurité** : chaque Server Action vérifie le recruteur et que la candidature est de son organisation (sinon
  « introuvable ») ; entrées validées par zod. Supprimer une candidature supprime son parcours.
- **Concurrence** : version relue juste avant l'écriture, action refusée si elle a changé. Appwrite 1.7 n'a pas de
  mise à jour conditionnelle : la fenêtre est réduite, pas fermée.

## Conséquences

- Le suivi est déclaratif : le recruteur indique « contrat signé », « timesheet reçu »… L'application ne génère pas
  encore le contrat, ne collecte pas le timesheet auprès du consultant et n'émet pas la facture : ce sont les suites
  prévues, chacune pourra remplir la pièce de son étape.
- Mise en place : `npm run schema:push -- dev`, variable `APPWRITE_COLLECTION_CONSULTANT_JOURNEYS=consultant_journeys`
  (portée Preview). Production : `npm run schema:check -- prod` puis `schema:push -- prod` par un humain, après
  sauvegarde, avant la mise en production du code. Sans la collection, les pages l'indiquent et rien d'autre ne change.
- Les CV du vivier (sans candidature) n'ont pas de parcours : il faut d'abord les ajouter au pipeline d'une offre.
