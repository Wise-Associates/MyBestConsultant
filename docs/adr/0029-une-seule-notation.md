# 0029 — Une seule notation pour tous les candidats (screening et Matching IA)

- Statut : accepté
- Date : 2026-11-10
- Complète : [0028](0028-notation-par-jugements.md) (jugements de l'IA, score calculé par le code)

## Contexte

Signalé le 2026-11-10 : le screening et le score IA ne concordaient pas entre le pipeline d'une offre
(`/recruiter/pipeline/<offre>`) et son Matching IA (`/recruiter/pipeline/<offre>/matching`).

Depuis l'ADR 0028, les quatre notations d'un candidat pour une offre partageaient les jugements et le barème
(`match-scoring.ts`), mais pas le reste. Chacune avait son code :

| | Candidature (screening) | Base candidats | Vivier de l'offre | Vivier général |
|---|---|---|---|---|
| Texte lu | CV joint + lettre de motivation + critères ajoutés (page Screening) | CV du profil | profil extrait du CV | profil extrait, 5 offres par appel |
| Consigne | « expert en recrutement RH » | « expert en sourcing » | sa propre consigne | sa propre consigne |
| Modèle (Config IA) | ligne « Screening CV » | « Matching IA » | « Matching IA » | « Matching IA », Claude par défaut |
| Recommandations | moyenne avec la note en étoiles (15 %, `/admin/scoring`) + bonus | bonus seulement | aucune | aucune |

Conséquences :

- « Ajouter dans le funnel » créait une candidature **sans score**, puis le screening la notait de nouveau avec
  d'autres entrées. Le même candidat avait deux scores sur le Matching IA : celui de la base ou du vivier (ligne grisée
  « déjà dans le funnel ») et celui de la candidature, le seul affiché dans le pipeline.
- Un CV illisible était quand même envoyé à l'IA par le screening (« [PDF sans texte extractible] ») et recevait un
  score bas qui avait l'air réel.

## Décision

Choix de l'utilisateur du 2026-11-10, sur proposition :

1. **Une seule notation** : `cvScorer` (`src/lib/sourcing-core.ts`) pour une candidature, la base candidats et le vivier
   de l'offre, avec la même consigne (`scoringSystemPrompt`, `scoringUserMessage`, `src/lib/match-scoring.ts`) : l'offre
   et le CV, rien d'autre. **Ni lettre de motivation ni critère ajouté** (le panneau de critères de la page Screening
   est retiré). Les notes de l'IA (points forts, vigilances, résumé envoyé au candidat) sont demandées pour tous, jamais
   comptées dans le score.
2. **Le texte du CV pour tous** (`readCvForScoring`) : le fichier, 12 000 caractères, **e-mails, téléphones et liens
   masqués** (`cvTextForScoring`, `src/lib/contact-mask.ts`, repris de l'export CV ; un téléphone doit avoir la forme
   d'un numéro, pour que des périodes « 2016 - 2018 - 2020 » restent lisibles). Le vivier lisait jusqu'ici le profil
   extrait à l'import, sans nom ni coordonnées : il lit maintenant le CV comme les autres ; le profil n'est plus lu que
   pour un CV sans fichier (profil ajouté depuis MBC Search) ou sans texte (PDF scanné), `vivierCvText`. Un fichier qui
   ne peut pas être lu (stockage injoignable, fichier abîmé) n'est pas noté sur le profil : erreur. **Ce que le masquage
   ne reconnaît pas part à l'IA** : le nom, l'adresse postale, la date de naissance écrits dans le CV — pour le vivier
   aussi désormais, comme déjà pour la base candidats et les candidatures (choix assumé de lire le CV ; minimisation
   possible plus tard : retirer le bloc d'identité en tête du CV).
3. **Vivier général** : il garde ses lots de 5 offres par appel (une notation par offre multiplierait par 5 les appels
   d'IA de chaque import), avec les mêmes règles et le même texte du CV. Son score reste un premier tri (« Correspond
   à ») ; repris tel quel s'il entre dans le funnel (point 6).
4. **Un seul modèle** : ligne « Matching IA » de Config IA, Claude si elle est sur « Modèle par défaut » (`SCORING_AI`) ;
   la ligne « Screening CV » est retirée (un choix déjà enregistré pour elle est ignoré).
5. **Une seule règle pour les recommandations** : le bonus des expertises recommandées que l'offre demande
   (`withRecommendationBonus`, `src/lib/recommendation-boost.ts`, + 12 au plus), qui ne baisse jamais un score et ne fait
   pas passer le seuil de 65. Le mélange avec la note en étoiles, qui ne s'appliquait qu'aux candidatures et pouvait les
   baisser, est retiré avec la page « Pondération IA » (`/admin/scoring`). Le réglage enregistré
   (`__scoringWeights` dans `customColors` de `TEMPLATES_CONFIG`) n'est plus lu ; il peut rester.
6. **« Ajouter dans le funnel » garde le score affiché** (`addToFunnelAction`, `keepMatchingScore`, ligne trouvée par
   `matchToCarry` d'après le candidat ou le CV vérifiés par le serveur, jamais d'après l'identifiant de ligne envoyé par
   le navigateur, qui pourrait désigner un autre candidat) : score, raison et
   recommandation recopiés sur la candidature, analyse enregistrée dans `screenings` (date de la note d'origine), carte
   placée dans la phase « screening » du pipeline (une carte notée ne reste pas avant elle). Aucun appel d'IA, aucun
   e-mail au candidat (il n'a pas postulé). Candidat non noté : candidature sans score, analysée comme une autre.
7. **Un CV illisible n'a pas de score** : le screening renvoie une erreur (« CV illisible… »), journalisée pour
   l'analyse automatique.

## Conséquences

- Pour un même CV et une même offre, candidature et base candidats reçoivent la même consigne, le même modèle et le
  même texte : leurs scores ne diffèrent plus que par le non-déterminisme de l'IA (un jugement qui bascule, ADR 0028)
  et par le bonus des recommandations, identique des deux côtés.
- Les scores déjà enregistrés ne changent pas : « Rafraîchir » (base candidats), « Relancer » sur une candidature ; les
  CV des viviers ne sont pas renotés automatiquement.
- La consigne demande points forts, vigilances et résumé pour la base candidats aussi : réponse un peu plus longue.
- Le vivier général envoie le CV (12 000 caractères au plus) au lieu du profil (quelques milliers) : appels plus gros,
  même nombre d'appels et même quota.
- Les recruteurs ne peuvent plus ajouter de critères au screening : pour exiger autre chose, il faut l'écrire dans
  l'offre (profil recherché, compétences), qui est la référence de toutes les notations.
- `npm run matching:explain` note exactement comme une candidature, la base candidats et le vivier de l'offre (sans le
  bonus des recommandations).

## Retour arrière

`git revert` du commit. Aucune donnée ni structure n'est modifiée ; les candidatures créées entre-temps depuis le
Matching IA gardent le score repris.
