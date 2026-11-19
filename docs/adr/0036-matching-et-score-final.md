# 0036 — Deux barèmes : matching des CV disponibles et score final de l'AO

- Statut : accepté
- Date : 2026-11-15
- Modifie : [0028](0028-notation-par-jugements.md) (poids et plafonds), [0029](0029-une-seule-notation.md) (point 6 : le
  score du Matching IA n'est plus repris sur la candidature)

## Contexte

Les recruteurs ont fourni un tableau en deux colonnes (2026-11-15) : les critères du **matching avec les CV
disponibles** et ceux du **scoring** de l'AO, qui donne le score final au screening (`/recruiter/pipeline/<offre>`).
Les critères en rouge du tableau sont les plus importants.

| Matching (CV disponibles) | Score final (AO) |
|---|---|
| **Intitulé du poste** | **Intitulé du poste** |
| Contexte ou description | Contexte ou description |
| Typologie du projet | Typologie du projet |
| **Techno + expertise outil** | **Techno + expertise outil** |
| **Localisation** | **Environnement client** (ex. AO BNP) |
| **Séniorité** | Localisation |
| **Formation** + certificat | Séniorité |
| **Secteur** | Scoring sur l'expérience, pas sur le diplôme |
| **Langue** | |
| TJM | |

Jusqu'ici, une seule notation (5 critères : poste 30, exigences 30, compétences 20, domaine 15, niveau 5) servait au
Matching IA et au screening, et « Ajouter dans le funnel » reprenait le score du Matching IA (ADR 0029).

## Décision

Choix de l'utilisateur du 2026-11-15, sur proposition :

1. **Deux barèmes, poids fixés dans le code** (`SCALES`, `src/lib/match-scoring.ts`), en gras ci-dessus = rouge = poids
   fort (poids d'origine, « v1 » ; remplacés le 2026-11-19 par les poids v2 de l'ADR 0049) :
   - **matching** (base candidats, vivier de l'offre, vivier général, sourcing des AO) : poste 20, techno 20, contexte 10,
     séniorité 10, secteur 10, localisation 8, formation 6, langue 6, projet 5, TJM 5 ;
   - **score final** (candidature : candidat qui postule, candidat ajouté au funnel, screening, « Relancer ») : poste 25,
     techno 25, contexte 15, client 15, projet 10, localisation 5, séniorité 5. La consigne interdit de juger les
     diplômes ; la formation n'est pas un critère.
2. **Un critère rouge qui manque plafonne le score sous 65** : poste non exercé 50 (voisin 75), secteur absent 60
   (voisin 80) comme avant ; techno sous un tiers de ses points, localisation, séniorité, formation, langue,
   environnement du client absents : 60. Les critères blancs ne plafonnent rien.
3. **« Ajouter dans le funnel » calcule le score final** (`scoreAddedCandidates`, `matching-actions.ts`) : un appel d'IA
   par candidat, 5 à la fois, sur le quota du screening (formule avec entretiens IA, adresse vérifiée, place du jour),
   **sans e-mail au candidat** (`autoScreenApplication(…, { notify: false })`). Candidat noté : phase « screening »,
   historique « Score final : 72/100 · Matching IA : 81/100 ». Échec : candidat sans score dans la 1re colonne, raison
   affichée.
4. **L'IA juge toujours, le code note** (ADR 0028) : chaque critère est oui / partiel / non, ou neutre (« non requis »,
   « non précisé » : toute la part, un candidat n'est pas pénalisé pour ce que personne ne demande ni ne dit). Preuves
   par citation du CV pour le contexte et les technologies, comparaison des intitulés pour le poste : inchangées.
5. **Données de l'offre** (`offerDetails`) : lieu, télétravail et rémunération de l'offre sont envoyés à l'IA
   (localisation, TJM). Score final d'une offre publiée depuis un AO (`ao<offre>`) : le client de l'AO et les clients
   que cite l'e-mail (client final d'un intermédiaire), noms réels lus par l'IA de la notation, jamais publiés
   (`finalOfferDetails`, `sourcing-core.ts`). Autre offre : l'entreprise de l'offre. Séniorité, langue, secteur,
   formation et type de projet sont lus dans la description (la collection `jobs` est à 16/16 attributs).
6. **Détail du score** : le résumé des jugements en tête de la raison suit l'ordre et les noms du barème (« Poste : oui ·
   Contexte : 4 sur 6 · Projet : oui · Techno : … »). `score-breakdown.ts` reconnaît le barème aux noms des critères et
   relit aussi les scores enregistrés avec l'ancien barème (barème `legacy`, lecture seule).

## Conséquences

- Les scores déjà enregistrés ne changent pas tant qu'ils ne sont pas recalculés (« Rafraîchir », « Relancer », import
  ou synchronisation du vivier) ; leur détail reste lisible.
- Un candidat de la base ou du vivier ajouté au funnel a un score final différent de son score de matching : c'est
  voulu (autre barème) ; le score de matching reste dans son historique et sur la page Matching IA.
- « Ajouter dans le funnel » prend environ une minute pour 5 candidats et consomme le quota du screening.
- Localisation et TJM du candidat ne sont lus que dans le CV (ni la ville du profil ni un TJM saisi) : souvent
  « non précisé », donc sans effet.
- Vivier général : le résumé des dix critères prend environ 260 des 300 caractères de `vivier_offer_matches.reason` ;
  un titre à plusieurs longs métiers coupe le résumé et la carte perd son détail (le score reste juste).
- Reste ouvert (avant ce changement) : une candidature ajoutée au funnel restée sans score est notée de nouveau à
  l'ouverture du Matching IA ou par « Relancer », et le candidat reçoit alors l'e-mail des scores de 70 et plus alors
  qu'il n'a pas postulé.

## Poids personnels (2026-11-16)

Depuis le 2026-11-19 (ADR 0049) : ce sont les poids **globaux** du recruteur (bouton « Pondération globale » du Matching
IA) ; il peut aussi régler le matching d'une offre précise, qui l'emporte pour elle.

Demande du 2026-11-16 : des poids **propres à chaque recruteur**, pas à l'organisation, les poids par défaut gardés, et
réglables depuis le pipeline d'une offre.

- Bouton « Pondération » du bandeau, **un barème par page** (demandes du même jour) : le Matching IA d'une offre
  (`…/matching`) règle les poids du matching, son pipeline (`/recruiter/pipeline/<offre>`) ceux du score final
  (screening) (`scoring-weights-dialog.tsx`, prop `scale`) : un champ par critère, total de 100 exigé, « Revenir aux
  poids par défaut ». Les poids valent pour toutes les offres du recruteur ; enregistrer un barème garde l'autre.
- Gardés dans les **préférences du compte Appwrite** du recruteur (`scoringWeights`, `scoring-weights-store.ts`) : ni
  collection ni attribut à créer. Les préférences peuvent être écrites par l'utilisateur lui-même : relues et validées
  (`parseRecruiterWeights` ; un barème invalide garde ses poids par défaut), et elles ne changent que ses propres
  affichages. Enregistrement par `saveScoringWeightsAction(scale, poids)` (recruteur de la session, poids validés par
  `ScaleWeightsSchemas`), l'autre barème et les autres préférences gardés (jeton d'invitation).
- **Recalcul à l'affichage, sans appel d'IA** (`personalScore`, `scoring-weights.ts`) : le score est refait d'après le
  résumé des jugements enregistré en tête de la raison, avec les poids du recruteur, puis l'écart du score enregistré
  (recommandations) est rajouté. Appliqué au pipeline de l'offre (cartes, tri, filtre, recommandation) et à son
  Matching IA (`getJobMatches(…, weights)` : scores, classement, filtres, détail et guide du calcul).
- **Inchangé** : les scores enregistrés (poids par défaut) et tout ce qui les lit sans recruteur — e-mails automatiques
  (70 et plus), seuil de 65 du vivier général et de ses correspondances, sourcing et suivi des AO, tableau de bord,
  page Screening, reporting. Les plafonds des critères essentiels ne dépendent pas des poids. Un score sans résumé
  lisible (barème d'avant le 2026-11-15, résumé coupé du vivier général) garde son score enregistré.

## Retour arrière

`git revert` du commit. Aucune donnée ni structure n'est modifiée ; les scores calculés entre-temps gardent leur
résumé (nouveaux noms de critères), qu'un code revenu en arrière ne détaillerait plus.
