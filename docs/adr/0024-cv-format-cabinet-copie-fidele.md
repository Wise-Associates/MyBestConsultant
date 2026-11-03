# 0024 — « CV format cabinet » : contenu du CV recopié mot pour mot, identité anonymisée

- Statut : accepté
- Date : 2026-11-02
- Modifie : 0009 (export au format ESN)

## Contexte

Essai du 2026-11-02 sur un CV du vivier général (`/recruiter/vivier?vue=general`), modèle « version courte » de Wise
Associates. Comparé au CV d'origine, le document généré résumait le contenu au lieu de le reprendre :

- profil réécrit en trois paragraphes (le troisième fabriqué à partir de la formation), noms des clients et chiffres du
  profil perdus, rubriques de compétences raccourcies, tableau « Environnement technique » absent ;
- **3 réalisations gardées sur 5 à 9 par expérience**, ligne de contexte (« Direction Data et Digital ») perdue,
  intitulé recomposé en « Équipe / programme — Rôle » ;
- **années inventées** : « Master … (2012) », chaque certification « (2020) », alors que le CV n'en donne aucune, et
  « [À COMPLÉTER] » à la place d'un établissement que le CV ne cite pas.

Causes, toutes dans les consignes de l'IA (`prompt.ts`) : l'exemple de la réponse JSON contenait des valeurs réalistes
(`"annees": "2012"`, `"annee": "2020"`, `"Janv 2021 – Aujourd'hui"`…) que le modèle recopiait quand le CV n'en avait
pas ; la consigne demandait un résumé de « 2 ou 3 paragraphes courts » (§3 : diplôme), de « reformuler en phrases
courtes », des mois abrégés et des rôles « Équipe / programme — Rôle ».

Demande de l'utilisateur (2026-11-02) : le nom du candidat reste anonymisé, le contenu du CV est recopié mot pour mot
dans le modèle.

## Décision

- **Copie mot pour mot**, dans les deux anonymisations : profil (chaque paragraphe), dates telles qu'écrites (durée
  comprise), intitulé du poste, ligne de contexte, chaque puce, environnement, toutes les rubriques de compétences
  (tableaux compris, une ligne = un élément avec son libellé), formations et certifications telles qu'écrites (une ligne
  qui en cite plusieurs = un élément par certification). Ni résumé, ni reformulation, ni correction. Seule exception :
  l'anonymisation, inchangée (initiales calculées par le code, coordonnées, données personnelles et personnes citées
  retirées ; en renforcée, clients et employeurs remplacés).
- Années, établissement, organisme : seulement s'ils sont écrits. « [À COMPLÉTER] » réservé à la date et au client
  d'une expérience, et à la durée d'expérience.
- Exemple JSON aux valeurs neutres (« … »), testé (`prompt.test.ts`).
- Traduction phrase par phrase, mois traduits sous la même forme (complète ou abrégée), durées traduites.
- La consigne de cartographie des modèles (`template-mapping.ts`) parle d'une liste de paragraphes de résumé, plus de
  « 2 ou 3 ».

## Conséquences

- Un CV long donne une réponse de l'IA plus longue qu'avant (plus rien n'est résumé) : la limite de 16 000 jetons peut
  être atteinte plus tôt (« CV trop long pour une seule réponse » : exporter une seule langue).
- Les versions déjà enregistrées ont été générées avec les anciennes consignes et peuvent être résumées : les régénérer.
- La fidélité repose sur la consigne : aucun contrôle automatique ne compare le dossier au CV (le texte d'un PDF coupe
  les lignes, et les rubriques du modèle réordonnent le contenu). Le recruteur relit le document, comme avant.
- Écart avec la skill `cv-esn-anonymise`, qui demande encore un résumé : à reporter si la skill doit produire la même
  copie.
