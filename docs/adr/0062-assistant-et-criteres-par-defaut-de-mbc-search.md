# 0062. Critères de matching : cinq critères par défaut, assistant et autres intitulés proposés

Date : 2026-11-25. Statut : accepté. Complète l'ADR 0061 (critères de matching d'une offre) ; réutilise la classification
et l'index des CV de l'ADR 0044.

## Contexte

Demande de l'utilisateur (2026-11-25), avec une capture des suggestions de l'accueil de MBC Search (« + Intitulé, + Lieu,
+ Séniorité, + Compétences, + Secteur ») :

- les critères du panneau doivent devenir cette liste, en éléments dépliables ;
- sur l'intitulé du poste, proposer d'autres intitulés du métier tirés des données de classification des CV ;
- dans le panneau, un système de demandes (« prompt ») à gauche pour valider les critères par défaut, la liste à droite.

Choix de l'utilisateur (questions du même jour) :

- **cinq critères seulement par défaut** pour une nouvelle offre (les cinq autres du barème s'ajoutent d'un clic) ;
- **l'IA modifie les critères** à chaque demande ; rien n'est enregistré sans « Enregistrer » ;
- autres intitulés tirés de **l'index des CV et du dictionnaire** de la classification, jamais ajoutés sans un clic.

## Décision

### Cinq critères par défaut, noms de MBC Search

- `DEFAULT_KEYS` (`src/lib/offer-criteria.ts`) : `poste`, `localisation`, `niveau`, `competences`, `domaine`, dans cet
  ordre. `defaultCriteriaSet` leur donne les poids `DEFAULT_WEIGHTS` : **Intitulé 33, Lieu 14, Séniorité 11,
  Compétences 30, Secteur 12** (Intitulé et Compétences fixés par l'utilisateur le 2026-11-25, les trois autres : ceux
  du barème « matching » ramenés à cinq critères), le métier du titre et le lieu comme libellés requis, les compétences
  demandées comme libellés de même poids. Les exigences tirées de la description (critère « Contexte ») ne sont plus
  proposées par défaut.
- La proposition de l'IA à « Préparer la publication » (`criteria-proposal.ts`) ne demande plus que ces cinq listes et
  les autres intitulés ; une liste d'un autre critère est ignorée.
- `CRITERION_NAMES` : noms des critères dans les critères d'une offre — **Intitulé** (poste), **Lieu** (localisation),
  Séniorité, **Compétences** (competences), Secteur ; les autres gardent ceux du barème (Contexte, Projet, Formation,
  Langue, TJM). Le schéma (`CriteriaSetSchema`) impose ce nom à chaque lecture : les critères enregistrés sous les
  anciens noms (« Poste », « Techno », « Localisation ») s'affichent sous les nouveaux. Les tableaux du barème
  (`CRITERION_LABELS`, résumés v2) ne changent pas.
- Rien à renoter : les résumés v3 (`Critères v1#<empreinte> · …`) ne gardent aucun nom, et l'empreinte ignore le nom des
  critères du barème. Les critères déjà enregistrés gardent leur ordre et leurs dix critères.
- Une offre **sans critères** (barème) est toujours notée sur le barème : seul le préfiltre (`searchProfileOf`) lit les
  critères par défaut pour ses poids, désormais ceux des cinq critères (langue : 0).

### Assistant des critères

- Panneau (`CriteriaDrawer`, `src/components/ao/criteria-editor.tsx`) : à gauche l'assistant (message d'accueil écrit
  sans IA d'après les critères montrés, échange, champ de demande avec les suggestions « Précisez : + Intitulé … »
  comme MBC Search), à droite les critères en éléments dépliables (nom, poids, libellés résumés ; détail : libellés,
  parts, ★, autres intitulés). Sans `revise` (aucune page aujourd'hui), la liste prend toute la largeur.
- Une demande envoie les critères affichés, le texte (1 000 caractères au plus) et les 12 derniers messages de
  l'échange. Règles pures : `src/lib/criteria-revision.ts` (testé) — consigne, demande, lecture de la réponse,
  changements (`criteriaChanges`). La réponse de l'IA (« Matching IA » de Config IA, `SCORING_AI`) est relue comme une
  donnée non fiable : identifiants inconnus avec un nom → critère créé (`x…`), doublons écartés, libellés bornés (4
  métiers pour Intitulé, 12 sinon), puis `CriteriaSetSchema` ; illisible ou invalide → message, critères inchangés.
- **Réponse partielle** (2026-11-26) : l'IA ne renvoie que les critères qu'elle ajoute ou modifie (`criteres`) et ceux
  qu'elle retire (`retires`). Un critère qu'elle ne renvoie pas est **gardé tel quel**, jamais retiré ; un critère
  renvoyé sans libellés ou sans poids garde les siens. Poids : ceux qu'elle donne sont gardés, les autres critères se
  partagent le reste en proportion (sinon tout est ramené à 100 en proportion). Cause : Claude indisponible, le repli
  sur le petit modèle par défaut de Config IA (Ministral 3B affiné pour la classification des CV) ne renvoyait que
  l'Intitulé, et les six autres critères étaient retirés. Une réponse qui ne change rien, hors question, est signalée
  en orange sous la phrase de l'IA (« Aucun critère n'a changé… ») : la liste fait foi.
- Titres d'offre en écriture inclusive (« Consultant(e) », « Développeur·se ») ramenés au masculin générique par
  `cleanTitle` (`src/lib/search/cv-search.ts`) : libellé d'Intitulé par défaut, recherches de l'index, dictionnaire.
- Les critères rendus remplacent ceux de l'éditeur ; les critères ajoutés ou modifiés portent « Ajouté / Modifié par
  l'assistant » et se déplient ; la réponse liste les changements et propose « Annuler cette modification » tant que
  les critères n'ont pas été retouchés. Pendant une demande, la liste est désactivée (`<fieldset disabled>`). Rien
  n'est enregistré : « Enregistrer » garde ses contrôles habituels.
- Points d'entrée (chacun vérifie lui-même l'accès, valide la demande **avant** de prendre une place de quota) :
  - AO de la plateforme : `reviseAoCriteria` (admin, sans quota, comme la rédaction de la version publiée) ;
  - AO d'une organisation : `reviseRecruiterAoCriteria` (recruteur, offre visible par lui `viewerCanUseAoOffer`, suivi
    des AO compris dans la formule, adresse vérifiée, quota) ;
  - cœur commun `reviseAoCriteriaOf` (`src/lib/ao/offer-actions.ts`) : AO non publié de l'organisation de la session,
    texte de l'AO **aux noms du client remplacés** (comme la proposition ; la publication refuse toujours un libellé qui
    nomme le client) ;
  - Matching IA : `reviseCriteriaAction` (`matching-actions.ts`, `requireJobAccess`, offre de l'organisation seulement,
    adresse vérifiée, quota), texte publié de l'offre.
- Quota (`takeCriteriaChatSlot`, `src/lib/criteria-assistant.ts`) : **60 demandes par organisation et 600 pour toutes,
  par jour** (compteurs `criteriaChatOrg` `kc`, `criteriaChatAll` `kd`) ; une demande dont l'IA échoue compte (elle a pu
  être facturée). Les journaux ne contiennent ni la demande ni l'offre.

### Autres intitulés du métier proposés

- Sous « Autres intitulés du métier » (élément Intitulé), des suggestions « + intitulé » pour le métier principal
  (premier libellé d'Intitulé), demandées à l'ouverture du panneau ou du détail d'Intitulé, une fois par métier.
- Règles pures : `src/lib/search/related-titles.ts` (testé). D'abord les autres écritures du métier dans le dictionnaire
  de la classification (`ROLE_SEED`, sans les sigles de 3 lettres), puis les métiers que portent **au moins 2 CV**
  classés dont les métiers contiennent tous les mots du titre (`roleCounts`, facette `roles` de Meilisearch, aucun CV
  renvoyé). Écartés : un métier plus général que celui de l'offre, un autre métier connu du dictionnaire, un métier lié
  seulement par un mot générique (« Développeur »), ce qui est déjà présent ; 8 au plus.
- Périmètre des comptes : toute la plateforme pour l'admin (`suggestAoTitles`) ; base candidats et vivier personnel du
  recruteur sinon (`suggestRecruiterAoTitles`, `suggestTitlesAction`). Sans IA ni quota. Index absent ou en panne : le
  dictionnaire seul, avec une note.

## Conséquences

- Les nouvelles offres sont notées sur cinq critères : une langue ou un diplôme exigés par l'AO ne sont plus repris
  d'office ; on les ajoute d'un clic ou en le demandant à l'assistant.
- Coût : un appel d'IA par demande à l'assistant, borné par le quota.
- Les consignes de la notation sur critères nomment les listes comme le bloc des critères (« Intitulé », plus « Poste ») :
  pour une offre qui a déjà des critères, le cache des notations (`score_cache`, clé sur les consignes, ADR 0044) ne sert
  plus une fois ; la prochaine notation (« Rafraîchir », nouveaux CV) repaie l'IA. Les scores enregistrés et les
  jugements des critères propres (`criteria_judgements`, clé sur l'empreinte des libellés) restent valables.
- Aucun changement de schéma ni de variable d'environnement.

## Retour arrière

`git revert` du changement : `defaultCriteriaSet` retrouve les dix critères, les noms du barème reviennent à la lecture
suivante. Les critères enregistrés entre-temps (cinq critères) restent valides et notés tels quels.
