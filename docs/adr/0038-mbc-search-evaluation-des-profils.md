# 0038 — MBC Search : évaluation des profils révélés, profils similaires, approche par canal, filtres et export

- Statut : accepté
- Date : 2026-11-16

## Contexte

Phase 2 du sourcing « à la Sherlock » (ADR 0037). Demande : évaluer les profils par l'IA (correspondances, manques,
vigilances, questions d'entretien, prochaines étapes), chercher des profils similaires, rédiger l'approche pour
l'e-mail, LinkedIn ou WhatsApp, filtrer, trier et exporter la liste. Décision de l'utilisateur (2026-11-16) : évaluer
sur **le barème du matching** de l'application (ADR 0036), avec les poids du recruteur, plutôt qu'un barème propre.

Ce qu'Apollo donne (vérifié dans sa documentation le 2026-11-16) : la recherche, presque rien (prénom, intitulé,
employeur) ; l'enrichissement payant (« Révéler »), le titre du profil, la séniorité, le lieu, le parcours (intitulés,
employeurs, dates, rarement une description) et le secteur de l'employeur — **jamais** de compétences listées, de
formation, de langues ni de rémunération.

## Décision

- **« Évaluer »** (`evaluateMbcProfile`, règles `src/lib/mbc-search/evaluation.ts`, testées) : seulement un profil
  révélé, relu en base (`mbc_reveals` de l'organisation, ou personne enregistrée du recruteur), jamais un profil envoyé
  par le navigateur. Le besoin tient lieu d'offre (`needAsOffer` : premier intitulé comme poste, les autres acceptés,
  compétences ★ d'abord, lieu, séniorité et secteur en précisions), le profil de CV (`profileText` : sans nom, e-mail
  ni lien). Même consigne que la notation des CV (`scoringSystemPrompt('matching')`, preuves citées vérifiées par
  `parseJudgements`, intitulés comparés par `withCheckedTitles`), plus ce qu'est un profil Apollo et deux listes
  (questions d'entretien, prochaines étapes : `APOLLO_EVALUATION_ADDENDUM`). Le code calcule le score
  (`evaluationOf`) :
  - formation, langue et TJM : **« Non disponible »**, hors du score (poids nuls, les autres ramenés à 100 :
    `apolloWeights`) et sans plafond ;
  - compétences qu'Apollo ne montre pas : « non visibles », sans points mais **sans le plafond** de 60 (ne pas les voir
    ne prouve pas qu'elles manquent : `APOLLO_CAPS`) ; poste, localisation, séniorité et secteur gardent leurs plafonds ;
  - poids du recruteur (préférences du compte, ADR 0036) ; recommandations sans objet.
  Panneau du profil : « Données Apollo » puis « Analyse IA » (score « sur ce qu'Apollo montre », critères, pourquoi il
  correspond, non visible dans le profil, vigilances, questions, prochaines étapes, avertissement). « Évaluer les
  profils révélés » : 10 au plus par clic, l'un après l'autre, arrêt au premier échec. Un appel à l'IA, une place du
  quota chacun. **Rien n'est enregistré** (pas de changement de structure) : les évaluations durent la visite et sont
  vidées à chaque recherche ; une évaluation finie après le début d'une autre recherche est écartée (`evalEpoch`).
  Besoin sans intitulé (compétences seules) : le poste est « Non demandé », plein, sans plafond, comme dans le
  classement. Page à `maxDuration = 300` (évaluation : jusqu'à 2 minutes, plus la comparaison des intitulés).
- **Données d'Apollo gardées en plus** à la révélation (`parseApolloMatches`) : séniorité, secteur de l'employeur et
  description de chaque poste (500 caractères, caractères de contrôle remplacés : échappés en JSON, ils feraient
  dépasser au profil sa taille enregistrée), dans le JSON déjà enregistré (`mbc_reveals`, `mbc_saved_people`) ; absents
  des profils révélés avant (lus vides).
- **« Profils similaires »** (`similarMbcCriteria`) : à partir d'un profil révélé relu en base, un besoin sans nom ni
  coordonnées (`similarBrief` : poste, titre, secteur, séniorité, lieu, postes récents) lu par la consigne des critères,
  **pour cet appel seulement** : il décrit une personne et ne quitte pas le serveur. Le besoin gardé (conversation,
  historique des recherches, sans limite de durée) est tiré des critères seuls (`similarNeed`, revue de sécurité du
  2026-11-16 : le parcours d'un tiers ne doit pas survivre à ses 90 jours). La page ouvre une nouvelle conversation et
  lance la recherche en plusieurs requêtes ; la personne de départ est écartée de toutes les recherches de la
  conversation, ajustements compris, et des nombres affichés.
- **Approche par canal** (`draftMbcOutreach({ …, channel })`) : e-mail (90 à 140 mots), note d'invitation LinkedIn
  (280 caractères, compteur sur 300), WhatsApp (40 à 70 mots). Toujours un brouillon, jamais envoyé.
- **Filtres, tri, export** (`src/lib/mbc-search/results-view.ts`, testé), dans le navigateur sur les profils chargés :
  texte (nom, intitulé, employeur, lieu révélé), score minimal, requête, e-mail disponible, révélés, évalués ; tri par
  score, score de l'IA ou mise à jour. Export CSV des profils filtrés, ce que la page montre (nom masqué et sans
  coordonnées tant que le profil n'est pas révélé), cellules neutralisées (`csvCell`).
- **Pas fait** : vue en cartes (la liste montre déjà les colonnes demandées ; une seconde mise en page serait à tenir à
  jour pour peu), comparaison de profils, suivi de la sélection (statut, notes, étiquettes) et passage d'un profil sans
  CV dans le pipeline (phase 3).

## Conséquences

- Une évaluation : jusqu'à 2 minutes par modèle (8 000 jetons, plus la comparaison des intitulés), **une seule** place
  du quota de MBC Search (300 par jour et par organisation) — autant qu'une recherche, pour le coût d'une notation de
  CV ; la revue de sécurité du 2026-11-16 propose un quota propre (comme `vivierMatching`, 200) : décision à prendre.
  « Profils similaires » : une place pour les critères, puis celles de la recherche (environ 6).
- Un profil affiché comme révélé mais pas gardé (collection absente, écriture en échec) ne peut être ni évalué ni
  servir aux profils similaires : le serveur ne relit que les profils gardés (message « Révélez d'abord… »).
- Un score « sur ce qu'Apollo montre » n'est pas comparable au score d'un CV : il ne compte ni formation, ni langues,
  ni TJM, et une compétence non visible n'y plafonne pas. L'écran le dit.
- Les évaluations ne sont pas gardées : une page rechargée les perd (un nouvel appel à l'IA). Les garder demanderait un
  attribut (`mbc_saved_people` : 6/16) ou une collection, et la règle de leur durée de conservation.
