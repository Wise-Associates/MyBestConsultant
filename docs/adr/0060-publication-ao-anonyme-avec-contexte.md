# 0060. Version publiée d'un AO : anonyme, mais avec son contexte

Date : 2026-11-24. Statut : accepté. Complète l'ADR 0013 (publication anonymisée par l'IA) et l'ADR 0058 (post LinkedIn
relu).

## Contexte

« Préparer la publication » (ADR 0013) fait rédiger par l'IA une version anonyme d'un appel d'offres : accroche,
missions, profil, modalités. La consigne ne demandait aucun contexte : ce que fait le client, son environnement métier,
le projet et ses enjeux disparaissaient, et l'offre publiée se réduisait souvent à des technologies. Elle retirait aussi
toutes les directions et tous les départements, même génériques (« la DSI »). Demande de David (2026-11-24) : conserver
le contexte de l'AO tout en l'anonymisant. Consigne corrigée le même jour :

> Lorsqu'un AO est transformé en offre, remplacer le nom de l'entreprise ou de l'organisme recruteur par une description
> de sa nature ou de son secteur. Supprimer toute mention de Wise Associates ainsi que tout élément de contexte qui lui
> est propre. Conserver les noms des directions et des départements lorsqu'ils ne désignent pas une entreprise, par
> exemple la DSI ou le DPII. Reformuler les intitulés de services trop spécifiques et les lieux précis en décrivant leur
> rôle ou leur activité. L'offre doit conserver les informations générales utiles pour comprendre le secteur, les
> missions, la chaîne de traitement et les expertises recherchées.

Autres défauts constatés : un nom masqué après un article masculin devenait le libellé affiché, pas toujours masculin
(« au Grande collectivité territoriale ») ; l'IA inventait une durée ou un démarrage absents de l'AO ; le modèle utilisé
(modèle par défaut de Config IA, GPT-4o mini sur DEV) gardait un outil interne homonyme d'un industriel.

## Décision

- **Consigne de l'IA** (`PUBLICATION_PROMPT`, `publication-copy.ts`), la règle ci-dessus :
  - l'entreprise ou l'organisme qui recrute, client final, partenaires : **décrits** par leur nature ou leur secteur,
    jamais nommés ni simplement supprimés ;
  - Wise Associates et ce qui lui est propre : aucune mention ;
  - directions et départements génériques (DSI, DPII, DRH, direction des opérations, MOA) **gardés** ;
  - service trop spécifique, lieu précis : reformulés par leur rôle (« SNSSI de Nantes » → « une équipe nationale
    chargée de l'exploitation et du support informatiques ») ;
  - outil, application ou programme interne : remplacé par sa fonction, même s'il ressemble au nom d'une entreprise
    connue ;
  - aucun chiffre propre au client, au plus un ordre de grandeur ; aucune phrase de remplissage ;
  - nouveau champ `context` : 2 à 4 phrases (600 caractères gardés au plus), **toujours rédigé** (retirer un nom ne retire
    jamais le contexte : sans paragraphe de contexte dans l'AO, la nature et l'activité du client sont déduites de ses
    missions, de ses outils et de son vocabulaire) ; première phrase « <le client décrit par sa nature et son activité>
    recrute un profil pour <la mission> et <son objectif> » (« Un organisme public chargé de services numériques de
    télédéclaration recrute un profil pour assurer le support applicatif de niveau 2… »), puis environnement métier,
    chaîne de traitement, projet et enjeux ;
  - missions et profil gardent le domaine, les processus et la réglementation ; aucune connaissance métier de l'offre
    retirée du profil.
- **Modèle** : ligne « Publication des AO » de Config IA (`aoPublication`, `PUBLICATION_AI`, `models.ts`) ; sur
  « Modèle par défaut », **Claude Sonnet 5.5**, effort bas, puis le repli habituel. 8 000 jetons (la réflexion de Claude
  compte dans la limite), 60 s.
- **Modalités écrites par le code** (`modalityLines`) à partir de la durée, du démarrage et de l'expérience lus dans
  l'e-mail ; l'IA n'en rédige plus, celles qu'elle renverrait sont ignorées.
- **Rendu** (`descriptionFromCopy`) : accroche, `### Le contexte` (paragraphe), `### Au programme`, `### Profil
  recherché`, `### Modalités`. « Le contexte » est lu comme une section de contexte par `description-sections.ts` :
  jamais jugé comme une exigence par le matching (`offerRequirements` ne lit que les puces Profil et Missions).
- **Noms retirés par l'IA** (`removed`, masqués à la publication, `maskTermsOf`) : jamais une expression écrite sans
  majuscule ni chiffre (« dispositifs nationaux »), ni une direction générique (`isGenericUnit` : sigles DSI, DPII, DRH,
  DAF, MOA, MOE, PMO… ; « Direction des opérations » sans autre majuscule). Masquées, elles deviendraient le libellé
  affiché partout où elles reviennent. Un intitulé propre au client (« Service Liquidation Aquitaine », « Direction
  Générale des Finances Publiques ») reste masqué.
- **Wise Associates** (`PLATFORM_NAMES`, `platformMentions`) : signalé en rouge à la relecture de toute version
  anonymisée, et une version anonymisée qui le mentionne encore est **refusée** à la publication (`publishAoOfferOf`),
  plutôt que remplacée par le libellé affiché, qui changerait le sens de la phrase (« Transmis par … »).
- **Post LinkedIn d'un AO, publié par la plateforme ou par une organisation** (même logique, décision du 2026-11-24) :
  au nom de l'entreprise affichée (`jobLiteOf`), sans l'organisation qui le publie, sa présentation ni la ligne de
  diffusion. Dans les deux cas (identifiant `ao…`, `isTenderJob`, `buildContent`), ni présentation
  ni phrase de recrutement de Wise Associates ou de l'organisation : la première phrase de « Le contexte » (qui recrute, pour quoi) en tient
  lieu (`contextOpening`), puis « Le projet ». Pour toute version anonymisée, « Le projet » proposé à la relecture est la suite de
  « Le contexte » (`tenderProject`, phrases entières, 320 caractères) : rédigé à part par l'IA de la diffusion, il
  répétait la phrase d'ouverture (essai du 2026-11-24). Le choix du pôle disparaît de la
  relecture (il ne servait qu'à cette phrase). Les autres offres de la plateforme gardent la présentation de Wise.
- **Post LinkedIn, toutes offres** : quand il a son paragraphe « Le projet », les sections de contexte de la description
  n'y sont pas répétées (`withoutContextSections`).
- **Article devant un nom masqué** : après **tout** article (élidé, féminin ou masculin : « le », « du », « au », « un »,
  « ce »), la tournure générique « le / du / au / un / ce client confidentiel » ; sans article, le libellé affiché
  (`ARTICLE_BEFORE`, `name-match.ts` ; `clientWithArticle`, `anonymize.ts`). Pas de grammaire du genre dans le code.
- Version des règles (IA refusée ou indisponible) : inchangée, sauf le signalement de Wise Associates. « Publier sans
  anonymiser » : inchangé.

## Conséquences

- Coût d'une préparation : environ 0,02 $ avec Claude Sonnet 5.5 (4 000 jetons lus, 1 500 écrits), au plus 0,70 $ par
  jour pour une organisation au quota de 30 rédactions.
- Le texte publié est plus long ; la section « Modalités » n'apparaît que si l'e-mail donne une durée, un démarrage ou
  une expérience.
- « au Grand groupe bancaire » devient « au client confidentiel » : moins précis quand le libellé était masculin, mais
  plus jamais faux.
- La ligne de diffusion des offres des organisations (« Offre diffusée via MyBestConsultant, la plateforme de
  recrutement de Wise Associates », ADR 0058) reste dans les offres des organisations créées hors AO ; un post d'AO ne l'a plus (même logique que la plateforme).
- La relecture humaine reste le dernier contrôle.

## Essais (DEV, 2026-11-24)

**Consigne**, GPT-4o mini, 10 AO fictifs (banque, mutuelle, assurance, agence publique, réseau ferroviaire, caisse de
retraite, industrie, logement social, crédit-bail, hôpital), ancienne puis nouvelle consigne (avant la règle corrigée) :
contexte 0 → 10/10, métier 6 → 10/10, chiffres propres au client 8 → 10/10, AO sans modalité inventée 0 → 5/10 (d'où
les modalités écrites par le code).

**Modèle**, règle corrigée, 10 AO fictifs (avec directions génériques, services précis, outils internes, mentions de Wise
Associates) et 2 AO réels de DEV (agence publique / outil d'instruction, administration fiscale / projet interne), un
appel par AO et par modèle, effort bas pour Claude :

| Critère | Haiku 5.5 | Sonnet 5.5 | GPT-4o mini |
|---|---|---|---|
| Contexte, métier, aucun nom / outil / service, aucune mention de Wise, aucune faute d'accord | 12/12 | 12/12 | 12/12 |
| Directions génériques gardées | 10/12 | 12/12 | 3/12 |
| Aucun chiffre propre au client | 12/12 | 12/12 | 11/12 |
| Tous les critères | 10/12 | **12/12** | 3/12 |
| Durée médiane | 7,2 s | 4,1 s | 4,7 s |

Règle fixée avant la mesure : Haiku 5.5 seulement s'il égale Sonnet 5.5. Haiku omet une direction en reformulant ;
GPT-4o mini les cite parmi les noms retirés (d'où `isGenericUnit`, quel que soit le modèle).
