# Matching IA d'une offre — `/recruiter/pipeline/[jobId]/matching`

Liste, pour une offre, des candidats venus de trois sources — candidatures reçues, base candidats de la plateforme,
vivier du recruteur connecté — avec un score sur 100 calculé par la même règle pour tous. Le recruteur filtre, lit le
détail de chaque score, relance une analyse, recalcule la base candidats (« Rafraîchir ») et fait entrer les candidats
choisis dans le pipeline (« Ajouter dans le funnel »). On y arrive par le titre d'une offre dans « Mes offres » et
l'aperçu d'une offre du tableau de bord, le suivi des annonces, le vivier d'une offre, l'onglet « Matching IA » et la
première colonne du pipeline ; « Retour » sans page d'origine ramène au pipeline. Le pipeline de l'offre : [../../README.md](../../README.md).
Décisions : [ADR 0028](../../../../../../docs/adr/0028-notation-par-jugements.md) (notation par jugements, écriture des
notes), [ADR 0026](../../../../../../docs/adr/0026-correspondances-vivier-general-indexees.md) (vivier général).
Règles produit : [AGENTS.md](../../../../../../AGENTS.md), section « Vivier général des recruteurs » (« Matching IA d'une
offre », « Notation d'un candidat pour une offre ») et « Design System » (« Pipeline et Matching IA d'une offre sur grand
écran »).

## Fichiers

```
page.tsx              composant serveur : accès, getJobMatches, relance des candidatures non analysées ; maxDuration = 300
loading.tsx           MatchingSkeleton
matching-client.tsx   liste (client) : filtres dans l'adresse, pages de 25, tableau grand écran, panneau, sélection,
                      « Rafraîchir », actualisation pendant une analyse
score-detail.tsx      détail d'un score (ScoreDetail, ScoreCriteriaList), couleur des critères (criterionTone),
                      « Comment le score est calculé » (ScoringGuide)
../matching-actions.ts  actions serveur de la page (requireJobAccess)
```

Code partagé :

- [matching-core.ts](../../../../../lib/matching-core.ts) : `getJobMatches` (lecture des trois sources), `runPoolMatching`
  (notes de la base candidats), `matchVivierCvAgainstJob`, `scoreCvAgainstOffers`, `unmatchedApplicationIds`.
- [sourcing-core.ts](../../../../../lib/sourcing-core.ts) : choix des candidats de la base et notation d'un CV
  (`matchCandidatesForJob`, `matchCandidatesForOffer`, `cvScorer`, `extractCVText`).
- [match-scoring.ts](../../../../../lib/match-scoring.ts) : règles de notation communes (consignes, vérification des
  preuves, barème, plafonds). Pur.
- [title-check.ts](../../../../../lib/title-check.ts) : seconde question à l'IA sur les intitulés (`withCheckedTitles`).
- [score-breakdown.ts](../../../../../lib/score-breakdown.ts) : détail d'un score relu dans sa raison. Pur.
- [pool-matching.ts](../../../../../lib/pool-matching.ts) : écriture ligne par ligne des notes de la base
  (`planPoolRows`, `poolRowId`). Pur.
- [matching-filters.ts](../../../../../lib/matching-filters.ts) : filtres et leur lecture dans l'adresse. Pur.
- [sourcing-rules.ts](../../../../../lib/sourcing-rules.ts) : `SOURCING_MIN_SCORE` (65).
- [screening/actions.ts](../../../screening/actions.ts) : notation d'une candidature (`scoreApplicationInternal`,
  `autoScreenApplication`).
- [appwrite/vivier-offer-matches.ts](../../../../../lib/appwrite/vivier-offer-matches.ts) (`listVivierOfferMatches`),
  [vivier-matching.ts](../../../../../lib/vivier-matching.ts) ; écriture des scores du vivier :
  [vivier/actions.ts](../../../vivier/actions.ts).
- [recommendation-boost.ts](../../../../../lib/recommendation-boost.ts) (`expertiseBoost`) ;
  [appwrite/list-all.ts](../../../../../lib/appwrite/list-all.ts) (`listAllDocuments`, `listAllByValues`) ;
  [concurrency.ts](../../../../../lib/concurrency.ts) (`mapLimit`) ; [job-ownership.ts](../../../../../lib/job-ownership.ts)
  (`recruiterCanOpenJob`) ; [url-list-state.ts](../../../../../lib/url-list-state.ts).

## Accès et périmètre des données

- **Page** : mêmes contrôles que le pipeline, écrits dans `page.tsx` — rôle `recruiter` et organisation, sinon
  `redirect('/login')` ; offre absente → `notFound()` ; offre d'une autre organisation et non partagée par la
  plateforme → `redirect('/recruiter/dashboard')`.
- **Actions** : `requireJobAccess(jobId)` = `requireRecruiter` (rôle et organisation), offre relue, puis
  `recruiterCanOpenJob` (offre de l'organisation ou `tenantId` vide), sinon exception « Non autorisé ». Elle renvoie
  l'organisation et le **profil** du recruteur (`users.$id`).
- **Périmètre** (`getJobMatches(jobId, tenantId, vivierOwner)`, `vivierOwner` = profil du recruteur ; clé API serveur) :

| Source | Lecture | Limité à |
|---|---|---|
| Base candidats (`pool`) | `COLLECTIONS.JOB_MATCHES`, `jobId` | l'offre (les lignes sont par offre) |
| Vivier de l'offre (`vivier`) | `COLLECTIONS.VIVIER_CVS`, `jobId` | organisation de l'appelant et CV qu'il a importés (`recruiterId`) |
| Vivier général (`vivier`) | `COLLECTIONS.VIVIER_OFFER_MATCHES` (offre + organisation), puis les CV par lots de 100 | CV revérifiés : organisation, `recruiterId`, sans `jobId` |
| Candidatures (`application`) | `COLLECTIONS.APPLICATIONS`, `jobId` | offre partagée par la plateforme : `tenantId` de l'appelant ou vide |

Un vivier est personnel (décision du 2026-11-03, AGENTS.md) : aucun collègue ne voit les CV d'un autre. Toutes les
listes sont lues en entier, page par page (`listAllDocuments`, `listAllByValues`).

## Chargement de la page

1. Contrôles d'accès (ci-dessus).
2. `getJobMatches(jobId, user.tenantId, user.$id)` :
   1. offre relue (absente : pas de filtre d'organisation sur les candidatures) ;
   2. en parallèle : lignes `JOB_MATCHES` (par score décroissant), CV du vivier de l'offre (champs `VIVIER_FIELDS`
      seulement : ni profil ni scores JSON), lignes du vivier général, candidatures ;
   3. CV du vivier général relus et filtrés ; profils `USERS` des candidats (nom, e-mail affichable par `displayEmail`,
      CV, chasseur) ; noms des chasseurs ; dates d'analyse des candidatures (`COLLECTIONS.SCREENINGS`, la plus récente,
      `scoredAt` sinon `$createdAt`) ; recommandations reçues par les candidats de la base ; noms des propriétaires des
      CV du vivier ;
   4. les trois listes fusionnées et triées par score décroissant (sans score = −1, en bas).
3. `unmatchedApplicationIds(matches)` : candidatures à relancer, analysées ensuite en tâche de fond, l'une après
   l'autre (`after(() => autoScreenApplication(id))`), voir « Candidatures ».
4. `<MatchingClient>` reçoit l'offre (titre, `jobMetaLine`, compétences), les correspondances et l'heure du rendu
   (`now`). `loading.tsx` affiche `MatchingSkeleton`. Aucun `error.tsx` : une exception de lecture donne la page
   d'erreur de Next.

## Logique et algorithmes

### Les trois sources

| Source | Qui figure | Score lu dans | Écrit par |
|---|---|---|---|
| Candidature | toute candidature à l'offre (déjà dans le funnel) ; `null` tant qu'elle n'est pas analysée | `applications.aiScore`, raison `aiSummary` | `autoScreenApplication` (à la réception, ou relancée ici), screening |
| Base candidats | candidats de la base déjà notés pour l'offre | `job_matches.score` + bonus des recommandations | `runPoolMatching` (création de l'offre, « Rafraîchir », « Recalculer » d'un AO) |
| Vivier de l'offre | CV du vivier de l'offre **déjà notés** (`matchScore` renseigné) | `vivier_cvs.matchScore`, `matchReason` | `matchVivierCvAgainstJob`, à l'import du CV dans le vivier de l'offre |
| Vivier général | CV qui correspondent à l'offre : notés 65 ou plus (`VIVIER_MATCH_MIN_SCORE`) | `vivier_offer_matches.score`, `reason` | comparaison aux offres ouvertes du vivier général ([vivier/](../../../vivier/), ADR 0026) |

« Déjà dans le funnel » (`alreadyInFunnel`, ligne grisée, non sélectionnable) : toujours pour une candidature ; pour la
base, le candidat a une candidature à l'offre ; pour le vivier, l'adresse e-mail du CV est celle d'un candidat qui a
postulé. Type affiché : « Candidature », « Base candidats », « Vivier de <Prénom Nom> ».

### Notation commune (ADR 0028)

Les quatre notations (candidature, base candidats, vivier de l'offre, vivier général) suivent
[match-scoring.ts](../../../../../lib/match-scoring.ts). **L'IA ne donne pas de note** : elle juge cinq critères par oui
/ partiel / non, et le code calcule le score. Motif (ADR 0028) : les scores changeaient à chaque calcul, la température
ne se règle pas sur les modèles Claude actuels. Explication complète du moteur, fichier par fichier et étape par étape :
[docs/matching-et-notation-ia.md](../../../../../../docs/matching-et-notation-ia.md).

1. **Listes de l'offre, les mêmes pour tous les candidats** (`offerCriteria`) : compétences demandées (`requiredSkills` :
   sans doublon ni vide, 80 caractères, `MAX_REQUIRED_SKILLS` = 12) et exigences tirées de la description
   (`offerRequirements` : puces du profil recherché puis des missions, découpées par `parseDescription`, 160 caractères,
   `MAX_REQUIREMENTS` = 10 ; aucune sans liste à puces).
2. **Message à l'IA** : consigne `MATCH_RULES` et format de réponse `judgementFields` ; offre = titre, listes numérotées
   (`criteriaBlock`), description réordonnée profil d'abord et coupée à 4 000 caractères (`offerTextForAi`) ; CV coupé à
   12 000 caractères (`CV_CHARS_FOR_SCORING`) — pour un CV du vivier, le profil extrait (`profileForAi`). `callLLM` avec
   `maxTokens` 8 000, module « matching » de Config IA (« screening » pour une candidature).
3. **Lecture et vérification des jugements** (`parseJudgements`, avec le texte du CV que l'IA a lu) :
   - `poste` : un élément par métier du titre (4 au plus). Jugé exercé sans intitulé cité → « non » ; intitulé dont un
     mot n'est pas dans le CV, ou qui ressemble à une liste de mots-clés → un niveau de moins (oui → partiel, partiel →
     non).
   - `exigences`, `competences` : un « oui » doit citer une ligne d'au moins 5 mots, tous présents dans le CV, qui n'est
     pas une liste de mots-clés (3 séparateurs ou plus et moins de 3 mots par élément) ; pour une compétence, la ligne
     doit contenir un mot de 3 lettres ou plus de la compétence. Sinon « partiel ». Élément manquant = « non », élément
     en trop ignoré, un seul jugement vaut pour toute la liste.
   - `domaine` (oui, partiel, non, non requis) et `niveau` (oui, partiel, non, non précisé).
   - Un critère illisible → `null` : **pas de score**, le candidat reste à noter.
4. **Comparaison des intitulés** (`withCheckedTitles`) : une seule seconde question par notation (`titleCheckPrompt`,
   module « matching », 2 000 jetons) pour chaque paire « métier du titre / intitulé du CV » jugée exercée : `meme` →
   jugement gardé ; `famille` → « partiel » au plus ; `autre` → « non » ; réponse absente ou appel en échec →
   « partiel » au plus (journalisé).
5. **Score** (`judgedScore`) : poids `SCORE_WEIGHTS` poste 30, exigences 30, compétences 20, domaine 15, niveau 5 ; part
   `POINTS` oui 1, partiel 0,5, non 0, « non requis » et « non précisé » 1 ; poste, exigences et compétences = moyenne
   de leurs éléments. Somme arrondie, puis plafond `capFor` = le plus bas de : métier du titre non exercé 50, voisin 75
   (`ROLE_CAP`, un seul métier suffit) ; domaine absent 60, voisin 80 (`DOMAIN_CAP`).
6. **Raison enregistrée** : `judgementSummary` puis « — » et la phrase de l'IA, par exemple
   « Poste : oui · Exigences : 4 sur 6, 1 partielle · Compétences : 6 sur 9 · Domaine : non · Niveau : oui — … ».

Exemple : 30 × 1 + 30 × (4 + 0,5) / 6 + 20 × 6/9 + 15 × 0 + 5 × 1 = 70,8 → 71, plafonné à 60 (domaine absent).

Différences par source :

- **Candidature** (`scoreApplicationInternal`, [screening/actions.ts](../../../screening/actions.ts)) : la réponse
  donne aussi points forts, vigilances et résumé ; lettre de motivation (500 caractères) jointe. Score final =
  `min(withBonus(score, mélange − score), capFor)`, où le mélange (`blendWithRecommendationScore`) pondère la note
  moyenne des recommandations reçues (1 à 5 étoiles → 0 à 100) par le poids réglé dans `/admin/scoring`
  (`getScoringWeights`) et ajoute `expertiseBoost`. Recommandation = `recommendationFor(score)` (85 top, 70 bon, 55
  moyen, 40 faible, sinon à rejeter). Enregistré : document `SCREENINGS` et `aiScore` / `aiSummary` / `aiRecommendation`
  de la candidature.
- **Base candidats** (`cvScorer`) : texte du CV du bucket `CVS` (`extractCVText`) ; au moment de la lecture,
  `expertiseBoost` ajoute des points par expertise de l'offre recommandée (1 recommandation +2, 2 → +3,5, 3 et plus →
  +5 ; `BOOST_CAP` = 12) et la raison reçoit « — Recommandé sur : … (+N pts) ».
- **Bonus et seuil** (`withBonus`) : un candidat noté sous 65 reste sous 65 (64 au plus) ; au-dessus, le total est
  borné à 100.

### Base candidats : qui est noté

`matchCandidatesForJob(jobId, { exclude, only })` → `matchCandidatesForOffer` :

- Toujours exclus : les candidats qui ont postulé à l'offre. Candidat notable (`isScorable`) : rôle `candidate`, CV sur
  le profil, pas désinscrit des propositions (`optedOutOfOutreach`).
- **Nouveaux** (`only` absent) : `USERS` par date de création décroissante, pages de 100, jusqu'à `MAX_CANDIDATES` = 30
  candidats lus ; un CV illisible (30 caractères ou moins) ne compte pas, 3 tours au plus pour atteindre 30.
- **Déjà notés** (`only` = liste) : ces candidats seulement, s'ils sont encore notables.
- Un appel d'IA par candidat, 5 à la fois (`SCORING_CONCURRENCY`, `mapLimit`). Motif (ADR 0028) : notés 30 par appel,
  les candidats étaient désignés par des identifiants presque identiques que l'IA recopiait mal.
- Résultat : notes triées, `considered` (candidats pris en charge, notés, en échec ou illisibles) et un message
  d'erreur : aucun candidat à noter, aucun CV lisible, ou « N CV non notés ».

### Écriture des notes de la base (`runPoolMatching`, `planPoolRows`)

| Appel | Candidats notés | Périmètre (`scope`) : notes qui peuvent partir |
|---|---|---|
| création de l'offre (`tryAutoSourceCandidates`, classement déjà calculé) | ceux du classement | candidats déjà notés |
| `'new'` | 30 nouveaux | aucun |
| `'all'`, des notes existent | les `RESCORE_MAX` = 120 premiers déjà notés | ces 120 |
| `'all'`, aucune note | 30 nouveaux | aucun |

- Aucune note obtenue (IA indisponible…) : rien n'est écrit, l'erreur est renvoyée.
- `planPoolRows` : ligne existante du candidat → mise à jour ; sinon création avec l'identifiant fixe `poolRowId`
  (`p` + 32 premiers caractères hexadécimaux du SHA-256 de `jobId:candidateId`) ; un conflit 409 (passage simultané)
  devient une mise à jour. Supprimées : les doublons d'un candidat (lignes d'avant les identifiants fixes) et les
  candidats du périmètre absents de `considered` (désinscrits, CV retiré, candidature envoyée). **Une note n'est jamais
  supprimée parce que son nouveau calcul a échoué.**
- Champs écrits : `score`, `reason` (1 000 caractères), `tenantId` de l'offre, `jobId`, `candidateId`.
- À vérifier : avec plus de 120 candidats notés, lesquels sont recalculés ? `existing` est lu sans tri explicite
  (ordre par défaut d'Appwrite).

### « Rafraîchir »

`refresh()` (`matching-client.tsx`) : `refreshPoolMatchingAction(jobId, 'all')`, puis, si ce premier passage a noté
quelqu'un ou n'a pas d'erreur, `refreshPoolMatchingAction(jobId, 'new')`. Deux requêtes, chacune dans les 300 s de la
page (`maxDuration`) : jusqu'à 150 notations n'y tiendraient pas en une. Sans confirmation et sans quota (ADR 0028,
« reste ouvert »). Compte rendu : « N scores recalculés, M nouveaux candidats notés. » suivi des erreurs ; la liste est
relue et revient en page 1. Les candidatures ne sont pas recalculées par ce bouton (« Relancer » sur leur ligne).

### Candidatures : analyse automatique et « Relancer »

- `autoScreenApplication` part en tâche de fond à chaque candidature (`/api/apply`, `applyToJob`, propositions d'un
  chasseur) ; il n'échoue jamais (toute erreur est ignorée).
- À l'ouverture de la page, `unmatchedApplicationIds` relance les candidatures sans score reçues depuis plus de 90 s
  (celles en cours d'analyse ne sont pas doublées), 5 au plus, une fois par heure et par candidature au plus — mémoire du
  processus serveur (`lastRetry`), propre à chaque instance.
- Dans le navigateur, une candidature sans score reçue depuis moins de 10 min est « en cours » : la liste est relue
  toutes les 8 s, 15 fois au plus (2 min) (`getMatchesAction`).
- « Lancer le matching » / « Relancer » (`runApplicationMatchingAction`) : candidature de cette offre, de l'organisation
  ou sans organisation ; attend `autoScreenApplication`, puis renvoie la liste à jour. L'e-mail au candidat (70 et plus)
  ne part que si la candidature n'avait aucun score : relancer ne lui écrit pas une seconde fois (ADR 0028).
- « Matching le … » : date de la dernière analyse (`SCREENINGS`) ; pour la base, création de la ligne `job_matches` ;
  pour le vivier, dernière mise à jour du CV ou de la ligne.

### Filtres, pages et histogramme

- `filterMatches` ([matching-filters.ts](../../../../../lib/matching-filters.ts)) : type (`all`, `application`,
  `pool`, `vivier`), score (`match` = 65 et plus, `below` = moins de 65, `pending` = sans score), recherche sur nom et
  e-mail sans casse ni accents. Appliqués dans le navigateur, sur toute la liste.
- Gardés dans l'adresse (`q`, `type`, `score` ; valeurs par défaut omises, valeur inconnue ignorée, recherche bornée à
  200 caractères), écrits par `history.replaceState` ; `noteListWrite` / `syncFromUrl` font reprendre l'adresse
  seulement quand quelque chose d'autre l'a changée. Tout changement de filtre revient en page 1.
- Pages de 25 (`PAGE_SIZE`). Compteurs par type et par score dans le rail. Histogramme par tranches de 10 ; les tranches
  à partir de 60 sont colorées (seuil 65).

### Détail d'un score (`scoreBreakdown`)

- Relu dans le résumé qui commence la raison (`SUMMARY`, expression régulière du format de `judgementSummary`), sans
  attribut en base : part de chaque critère en pourcentage et en points, total, plafond qui l'abaisse (le plus bas de
  ceux qui s'appliquent), suite de la raison. Le test vérifie qu'il redonne exactement
  `judgedScore` pour toutes les combinaisons de jugements.
- Raison sans résumé (score d'avant ADR 0028, texte coupé) → `null` : « Détail du score indisponible », avec
  « Rafraîchir » ou « Relancer » selon la source.
- `scoreAdjustment` : écart entre le score affiché et celui des jugements, nommé « Recommandations » pour une
  candidature ou un candidat de la base recommandé, sinon « Écart avec une version précédente de la notation ».
- `criterionTone` (pastilles du tableau) : 85 % et plus vert, 35 % et plus orange, sinon rouge. Textes d'aide :
  `CRITERION_HELP` et `ScoringGuide`, repris de `MATCH_RULES` et des constantes du barème.

### « Ajouter dans le funnel » (`addToFunnelAction`)

Pour chaque ligne sélectionnée, l'une après l'autre ; une erreur n'arrête pas les autres :

- **Candidature** : refusée, « Déjà dans le funnel ».
- **Base candidats** : le candidat doit avoir une ligne `JOB_MATCHES` pour l'offre (l'identifiant vient du navigateur),
  un profil de rôle `candidate` et un CV sur son profil ; pas déjà candidat (`hasApplied`). CV joint : celui du profil.
- **Vivier** (`resolveCandidateFromVivier`) : CV de l'organisation, importé par l'appelant, dans le vivier de cette offre
  ou le vivier général ; avec un fichier (un profil ajouté depuis MBC Search est refusé) et une adresse e-mail lue sur
  le CV. Puis, selon l'adresse :
  - profil `USERS` existant de rôle `candidate` : repris **sans rien y écrire** ; le fichier du vivier est copié dans
    le bucket `CVS` et joint à la candidature ;
  - profil d'un autre rôle, ou compte de connexion sans profil : refusé (motif : l'adresse, écrite par celui qui importe
    le CV, ne doit jamais donner accès au compte d'un autre — AGENTS.md, revue du 2026-11-03) ;
  - aucun compte : compte de connexion créé sans mot de passe (`users.create`), fichier copié, profil `candidate` sans
    organisation ;
  - ensuite, refusé si ce candidat a déjà postulé à l'offre (`hasApplied`).
- Création : `createApplication` (offre, organisation de l'appelant, candidat, CV ; statut `pending`), évènement
  `stage_change`. Aucun screening : le recruteur le lance depuis la carte du pipeline. Revalidation du pipeline, du
  Matching IA et du tableau de bord. Réponse `{ added, errors }` ; la page affiche le nombre ajouté et la première
  erreur, vide la sélection et relit la liste.

## Actions serveur

| Action | Fichier | Rôle | Contrôles | Écritures et effets |
|---|---|---|---|---|
| `getMatchesAction` | `../matching-actions.ts` | relire la liste | `requireJobAccess` | lecture (`getJobMatches`) ; exception si refusé |
| `runApplicationMatchingAction` | `../matching-actions.ts` | « Lancer le matching » / « Relancer » | `requireJobAccess`, candidature de l'offre et de l'organisation (ou sans organisation) | IA ; `SCREENINGS`, `aiScore`… ; e-mail au candidat (70 et plus, première analyse) |
| `refreshPoolMatchingAction` | `../matching-actions.ts` | « Rafraîchir » (`'all'` puis `'new'`) | `requireJobAccess`, mode `'new'` ou `'all'` | IA (un appel par candidat + comparaison des intitulés) ; `JOB_MATCHES` créées, mises à jour, supprimées |
| `addToFunnelAction` | `../matching-actions.ts` | « Ajouter dans le funnel » | `requireJobAccess` ; par ligne, voir ci-dessus | `APPLICATIONS` ; fichier copié dans `CVS` ; compte Auth et profil `USERS` créés pour un CV du vivier sans compte ; évènement |

Appelée en tâche de fond par la page : `autoScreenApplication` ([screening/actions.ts](../../../screening/actions.ts)).

## Erreurs et cas limites

- Lectures annexes illisibles : noms des chasseurs et dates d'analyse (journalisées), recommandations (ignorées) ; la
  liste s'affiche sans elles. Les autres lectures de `getJobMatches` font échouer la page ou l'action.
- Polling : une relecture en échec est ignorée et retentée au tour suivant.
- « Relancer » : `autoScreenApplication` ne signale pas d'échec ; la ligne reste sans nouveau score, sans message.
- Absents de la liste : CV du vivier de l'offre non notés (matching en échec à l'import), CV du vivier général notés
  sous 65, candidats de la base jamais notés pour l'offre.
- Offre partagée par la plateforme : les lignes `JOB_MATCHES` sont par offre, donc communes à toutes les organisations ;
  candidatures et vivier limités comme indiqué plus haut.
- Candidat ajouté au funnel : statut `pending`. Dans un pipeline sans phase `pending`, `resolveStatus` le rattache à la
  phase de libellé « Candidats sélectionnés », sinon il a une colonne orpheline.
- CV du vivier : le fichier est copié dans `CVS` avant la vérification « Déjà candidat sur cette offre ».
- « Rafraîchir » sans IA disponible : le premier passage échoue, le second n'est pas lancé, les notes existantes
  restent.

## Tests

- [match-scoring.test.ts](../../../../../lib/match-scoring.test.ts) : consignes, plafonds, bonus, description réordonnée,
  exigences tirées de la description, vérification des preuves et des intitulés, cas de production (expert sécurité sur
  « Scrum Master et Développeur Full Stack » → 50 au plus), barème, résumé.
- [score-breakdown.test.ts](../../../../../lib/score-breakdown.test.ts) : le détail redonne `judgedScore`, plafonds
  signalés, raison sans résumé, écart, textes d'aide.
- [pool-matching.test.ts](../../../../../lib/pool-matching.test.ts) : mise à jour, création, rien de retiré en mode
  `'new'`, note gardée après un échec, doublons, identifiant fixe.
- [matching-filters.test.ts](../../../../../lib/matching-filters.test.ts) : filtres et adresse.
- [job-ownership.test.ts](../../../../../lib/job-ownership.test.ts) (`recruiterCanOpenJob`),
  [concurrency.test.ts](../../../../../lib/concurrency.test.ts) (`mapLimit`),
  [sourcing-rules.test.ts](../../../../../lib/sourcing-rules.test.ts),
  [vivier-offer-matches.test.ts](../../../../../lib/vivier-offer-matches.test.ts).
- Non testés : `getJobMatches`, `runPoolMatching`, `addToFunnelAction` (accès Appwrite).

Commande : `npm test` ; ces fichiers seuls : `node --import tsx --test src/lib/match-scoring.test.ts
src/lib/score-breakdown.test.ts src/lib/pool-matching.test.ts src/lib/matching-filters.test.ts`. Vérifier un score
contesté sans rien écrire : `npm run matching:explain -- <env> [--prod] --job <offre> --cv <fichier CV>` (même code que
la base candidats, `cvScorer` ; un appel d'IA).

## Modifier cette page

- **Barème ou consignes** (`SCORE_WEIGHTS`, `POINTS`, `ROLE_CAP`, `DOMAIN_CAP`, `MATCH_RULES`, format de
  `judgementSummary`) : `score-breakdown.ts` (`SUMMARY`, raisons des plafonds, `CRITERION_HELP`), `ScoringGuide` et les
  deux tests ensemble. Un nouveau format de résumé rend illisible le détail des scores déjà enregistrés.
- **Seuil de 65** (`SOURCING_MIN_SCORE`) : filtres, histogramme, `withBonus`, lignes du vivier général
  (`VIVIER_MATCH_MIN_SCORE`), sourcing des AO.
- **Durée** : `maxDuration = 300` dimensionne `RESCORE_MAX` (120), `MAX_CANDIDATES` (30) et `SCORING_CONCURRENCY` (5) ;
  les changer ensemble.
- **Notation d'un CV de la base** : garder `cvScorer` partagé avec `scripts/matching-explain.mts`.
- **Mise en page** : `MatchingSkeleton` ([page-skeletons.tsx](../../../../../components/recruiter/page-skeletons.tsx))
  suit la page à chaque largeur (dès 1440 px : rail de 240 px, liste, panneau de 320 px ; dès 1800 px : 264 px et
  360 px, colonne « Pourquoi ») ; `JobTabs` partagé avec le pipeline.
- **Navigation** : nom « Matching IA » dans `PAGE_LABELS` ([recruiter-trail.ts](../../../../../lib/recruiter-trail.ts)) ;
  lien `matchingHref` de `job-row.tsx` et `job-preview-panel.tsx` du tableau de bord ; `BackLink` avec
  `fallbackHref` = pipeline de l'offre.
- **Nouvelle source** : `JobMatchResult.source`, `SOURCE_LABEL`, `MatchSource` et `SOURCES` de `matching-filters.ts`,
  `profileHref` / `cvHref`, `addToFunnelAction` et `scoreAdjustment`.
