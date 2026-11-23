# 0057. Compétences équivalentes, tri et filtre Métier dans la CV Thèque et les alertes

Date : 2026-11-23. Statut : accepté. Complète l'ADR 0046.

## Contexte

Le 2026-11-20, un test des alertes des recherches enregistrées (ADR 0046) n'a rien envoyé. La recherche demandait
« Angular » et « Node.js ». Le candidat fictif avait Angular et NestJS, mais pas « Node.js » écrit tel quel dans les
compétences que l'IA a tirées de son CV.

La règle de l'ADR 0046 compare les compétences mot à mot (majuscules, accents et tirets ignorés). Elle avait trois
limites :

- deux écritures d'une même compétence ne se valaient pas : « NodeJS » ne trouvait pas « Node.js », ni « K8s »
  « Kubernetes » ;
- une compétence qui en suppose une autre n'était pas prise en compte : NestJS ou Express ne valaient pas Node.js ;
- les compétences d'un candidat dépendent de l'écriture de son CV, que le candidat a rédigé sans connaître les offres.

Un candidat qui avait la compétence n'apparaissait donc ni dans la liste de la CV Thèque ni dans les alertes.

Options présentées à l'utilisateur :

1. variantes d'écriture ;
2. compétences voisines, dans un seul sens ;
3. recherche aussi dans les intitulés et les missions ;
4. correspondance par IA ou index sémantique.

Décision du 2026-11-23 : **options 1 et 2**.

## Décision

- **Une règle, partout** : `skillMatcher` (`src/lib/cvtheque-search.ts`), appliquée par `filterCandidates`. La liste,
  ses compteurs, les comptes des recherches enregistrées et les alertes changent ensemble : une alerte ne signale
  jamais un candidat que la liste ne montre pas. L'e-mail d'alerte place en tête les compétences qui ont retenu le
  candidat (`candidateHighlights`).
- **Correspondance d'une compétence demandée**, dans cet ordre :
  1. **mot à mot**, la règle d'avant, inchangée : « React » trouve « React Native » ;
  2. **mêmes mots collés**, sans table : « Node.js », « NodeJS » et « node js » donnent la clé `nodejs`
     (`skillKey`) ;
  3. **variantes** (`SKILL_VARIANTS`, `src/lib/skill-equivalences.ts`) : sigles, nom court, autre langue (« K8s »,
     « JS », « Postgres », « IA ») ;
  4. **compétences voisines** (`SKILL_IMPLIES`), dans un seul sens et de proche en proche : NestJS ⇒ Node.js ⇒
     JavaScript. Un profil NestJS répond à « Node.js » ; un profil Node.js ne répond pas à « NestJS ».
- **Une équivalence (étapes 2 à 4) ne retient qu'une compétence entière du profil**, jamais un mot pris dans une
  autre compétence. « Go » ne trouve pas « Go-to-market ».
- **Deux technologies différentes ne sont jamais rapprochées par leur nom** : « Java » ne trouve pas « JavaScript »,
  « Angular » ne trouve pas « AngularJS ». Les tests de cohérence des tables (`skill-equivalences.test.ts`) le
  vérifient, avec l'appartenance de chaque écriture à un seul groupe et l'absence de boucle dans les implications.
- **Le recruteur voit pourquoi un profil est retenu** : sur la carte de la CV Thèque, « Node.js : trouvé via NestJS »
  (`skillCorrespondences`).

## Complément du 2026-11-23 : tri et filtre « Métier »

Test pas à pas du même jour : avec le filtre « JavaScript », la liste montrait des chefs de projet, un consultant SIRH,
un gérant. Sur DEV, 14 des 23 profils retenus l'étaient **mot à mot** : leur CV listait JavaScript parmi ses
compétences (« HTML, CSS, JavaScript, PHP, MySQL » pour un chef de projet). Le filtre Compétences vérifie que le CV cite
la compétence, pas que la personne exerce le métier. Le défaut existait avant les équivalences, qui n'ajoutaient que
9 développeurs. Options présentées : ne rien changer, trier (B), exiger la compétence dans les expériences (C, écarte
de vrais développeurs aux missions mal décrites), filtre par métier (D). Décision : **B puis D**.

- **B. Tri par place de la compétence dans le parcours** (`rankBySkillUse`, `cvtheque-search.ts`) : avec des
  compétences demandées, d'abord les profils dont un intitulé (poste visé ou exercé) nomme la compétence ou une de ses
  équivalences (`equivalentSkillNames` : « JS », « Angular » pour JavaScript), puis ceux dont le résumé ou une mission
  la nomme, enfin ceux qui la listent seulement. Personne n'est écarté ; à égalité, l'ordre d'arrivée. Une ligne
  au-dessus de la liste explique l'ordre. Les alertes ne sont pas triées.
- **D. Filtre « Métier »** : les familles de la classification des CV (ADR 0044, `JOB_FAMILIES`, sorties dans
  `src/lib/job-families.ts` pour être lues dans le navigateur), plusieurs choix, l'une suffit (`jobFamilies` des
  filtres, `metier` dans l'adresse, gardé dans les recherches enregistrées). Familles lues par
  `candidateJobFamilies` (`src/lib/appwrite/cv-classifications.ts`) : au chargement de la CV Thèque, pour les compteurs
  des recherches qui filtrent par métier, et pour chaque alerte.
  - **Un CV pas encore classé est écarté** dès qu'un métier est choisi (décision du 2026-11-23). La classification se
    fait au dépôt, par les règles si l'IA est indisponible. Restent sans classification les CV sans texte lisible (PDF
    scannés) : ils n'apparaissent jamais avec ce filtre, comme ils n'apparaissent pas avec un filtre de compétences
    (profil vide). CV déposés avant la classification : `npm run cv:classify`.
  - **Alertes** : au dépôt d'un CV, deux comparaisons aux recherches enregistrées, après la réponse : tout de suite
    (sans attendre l'IA, comme avant), puis une fois le CV classé, pour les recherches filtrées par métier (comparé
    avant d'être classé, le candidat ne leur répondrait jamais). Identifiant fixe par alerte : le second passage ne
    recrée pas celles du premier ; un candidat retenu par les deux sortes de recherches peut valoir deux e-mails.
    `maxDuration = 300` sur l'espace candidat, pour que la classification aille au bout. Famille illisible au moment
    de l'alerte : le candidat ne répond pas à ces recherches cette fois (journalisé), le cron le compare de nouveau
    pendant 6 h.
  - **Classification non configurée** : le filtre est masqué dans la liste, et un métier venu d'une recherche
    enregistrée y est ignoré avec un avertissement ; les compteurs et les alertes l'ignorent aussi (même liste), et une
    recherche qui n'avait que ce critère n'alerte personne. Familles illisibles au chargement de la page (panne) : même
    chose dans la liste ; les alertes, elles, écartent le candidat plutôt que d'alerter sur un autre métier.

## Conséquences

- Les tables sont des données du dépôt, relues comme du code. On ajoute une variante ou une implication quand une
  recherche manque un profil évident. Ajouter une implication élargit les résultats de toutes les recherches qui
  demandent sa cible : une implication douteuse fait apparaître des profils sans rapport.
- Les recherches déjà enregistrées appliquent la nouvelle règle dès le déploiement. Le rattrapage du cron (candidats
  modifiés depuis 6 h) peut alors signaler une fois des candidats récents qu'elles ne retenaient pas avant.
- Aucun changement de structure Appwrite, aucune variable d'environnement, aucun appel d'IA.
- Non retenu pour l'instant : l'option 3 (intitulés et missions, plus de bruit), éventuellement en case à cocher dans
  les filtres, et l'option 4 (coûteuse, pas reproductible ; le Matching IA note déjà les CV). Les synonymes de l'index
  Meilisearch (`CV_INDEX_SETTINGS`, ADR 0044) restent distincts : ils ne servent qu'au préfiltre du matching.
