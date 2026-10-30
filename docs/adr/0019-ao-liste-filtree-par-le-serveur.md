# 0019 — Offres AO : liste filtrée par le serveur (index ao_offer_index)

- Statut : accepté
- Date : 2026-10-30
- Note : le numéro 0018 est pris sur la branche `feat/mcp` (non fusionnée au moment de cette décision).

## Contexte

Le tableau des appels d'offres (`/admin/candidats`, `/recruiter/parametres/boites-ao`) chargeait les 2 000 offres les
plus récentes **de toutes les organisations**, gardait celles de l'appelant (offre → e-mail → boîte → organisation) et
les filtrait dans le navigateur. Au-delà de 2 000 offres sur la plateforme, les plus anciennes disparaissaient de toutes
les listes ; chaque page relisait tout ; le navigateur recevait toutes les lignes.

`ao_offers` est à 16/16 attributs : impossible d'y ajouter l'organisation ou un champ de recherche.

Demande du 2026-10-30 : tous les filtres appliqués par le serveur. Une pagination (50, puis 10 offres par page) a été
essayée le même jour puis retirée à la demande : la liste affiche toutes les offres filtrées.

## Décision

- **Collection dérivée `ao_offer_index`** : un document par offre, de même identifiant, avec l'organisation (`tenantId`)
  et tout ce que la page filtre ou trie : statut, contrat, télétravail, montant, date de réception, nombre d'e-mails,
  ville, compétences, expéditeur, texte de recherche (intitulé, client, ville, objet, compétences, description).
  Collection à part plutôt que dans `ao_offer_details` (qui aurait été pleine) : l'index se reconstruit entièrement
  à partir des données sans rien perdre, les détails non.
- **Requêtes** (`offer-index.ts`, testé) : l'organisation d'abord, puis chaque filtre. Recherche par `Query.contains`
  sur les textes : sur Appwrite 1.7.4, c'est une recherche de sous-chaîne sans casse ni accents (vérifié sur DEV le
  2026-10-30), comme le filtrage fait auparavant dans le navigateur. Tri : date de réception décroissante, puis
  identifiant (lots stables). Liste entière, sans pagination, lue par lots de 500 en parallèle ; Appwrite ne compte ni
  ne décale au-delà de 5 000 documents : plafond de la liste, de l'export et des statistiques (les plus récentes),
  signalé à l'écran.
- **Écritures** : la synchronisation écrit la ligne juste après avoir créé l'offre, avant ses détails (échec : l'offre
  est retirée et l'e-mail repris la recrée) ; statut et nombre d'e-mails recopiés à chaque modification
  (`updateAoOffer`, `incrementAoSources` ; ligne absente : reconstruite ; échec journalisé) ; suppression (offre
  d'abord) et purge des 365 jours emportent la ligne et les détails avec l'offre.
- **Rattrapage automatique** : chaque passage planifié reconstruit les lignes des offres modifiées depuis 48 h dont la
  ligne manque ou diffère (statut, nombre d'e-mails) — recopie qui a échoué, offre écrite par l'ancien code pendant un
  déploiement (`reconcileAoOfferIndex`).
- **Isolation redoublée** : les lignes lues sont gardées seulement si l'e-mail de l'offre vient d'une boîte de
  l'organisation (le contrôle d'avant l'index) : une ligne d'index erronée ne montre jamais l'offre d'une autre
  organisation.
- **Adresse de la page** : les filtres. Chaque offre a sa page (`<liste>/<id>`, demande du 2026-10-30), qui reçoit les
  mêmes filtres et donne les offres précédente et suivante dans l'ordre de la liste. « Synchroniser maintenant »
  renvoie la liste affichée (mêmes filtres).
- **Reconstruction** : `npm run ao:index -- <env> [--apply] [--prod]`, idempotent (crée, corrige, supprime les lignes
  sans offre).

## Conséquences

- Une offre sans ligne d'index n'apparaît nulle part (liste, export, statistiques) : `npm run ao:index` la rétablit.
  Un échec de recopie du statut est journalisé (« index de la liste non mis à jour »), la modification de l'offre
  elle-même est faite.
- Mise en place, sur DEV puis en production (un humain, après sauvegarde de la base) :
  1. `npm run schema:check -- <env>` : exactement 3 ajouts (`ao_offer_details.contact`, `.sourceUrl`, collection
     `ao_offer_index`) ; `npm run schema:push -- <env>`, puis `schema:check` de nouveau : aucune différence.
  2. Simulation `npm run ao:index -- <env> [--prod]` : nombre d'offres, et « e-mail ou boîte introuvable » à 0 ou
     expliqué.
  3. Variable `APPWRITE_COLLECTION_AO_OFFER_INDEX` (portée Preview pour DEV, Production pour la production).
  4. Arrêter les déclencheurs (planificateur externe, `ao:poll:stop`, worker `ao-idle` ; sur DEV, les previews
     d'autres branches qui synchronisent encore avec l'ancien code).
  5. `npm run ao:index -- <env> --apply` (en production : confirmation en tapant l'identifiant du projet), déploiement,
     de nouveau `ao:index --apply` une fois le déploiement en ligne, puis une simulation qui doit afficher
     `+ 0`, `~ 0`, `- 0`.
  6. Relancer les déclencheurs ; vérifier les indicateurs du haut et un export.
- Le script peut tourner pendant une synchronisation : il ne supprime une ligne qu'après avoir vérifié que son offre
  n'existe plus, laisse une ligne écrite entre-temps par l'application et relit l'offre avant de corriger sa ligne.
- Retour arrière : revenir au code précédent suffit (il n'utilise pas l'index) ; la collection peut rester. Avant de
  redéployer ce code ensuite, refaire l'étape 5 (offres créées entre-temps sans ligne).
- Branches non fusionnées qui appellent encore `listAoOfferRows` (supprimée) : à adapter à la fusion (la vérification
  des types le signale).
