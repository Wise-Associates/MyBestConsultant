# 0059. Notation des offres d'AO avec la description d'origine de l'appel d'offres

Date : 2026-11-24. Statut : accepté. Complète l'ADR 0029 (une seule notation) et l'ADR 0036 (barèmes).

## Contexte

Une offre publiée depuis un appel d'offres (`ao<offre AO>`) est une version anonymisée et réduite à quelques puces
(ADR 0013) : le client devient un secteur générique (« Grande agence de services publics »), et l'activité du client, la
chaîne de traitement, l'environnement et les enjeux du projet disparaissent souvent. La notation des CV (`cvScorer`,
`sourcing-core.ts`) ne lisait que cette version : ce que l'anonymisation retire, le matching ne le voyait pas non plus.
Demande de David (2026-11-24) : conserver le contexte de l'AO « pour mieux cibler ».

Un AO pas encore publié était déjà noté sur sa description d'origine (section Sourcing de la page de l'offre).

## Décision

- Pour une offre `ao<offre AO>`, la notation reçoit en plus la **description d'origine de l'AO** (`ao_offers.description`,
  déjà extraite et nettoyée à la synchronisation), après la description publiée et avant le CV, sous le titre « Contexte
  de l'appel d'offres d'origine (usage interne…) » (`scoringUserMessage`, `match-scoring.ts`).
- **Les listes jugées ne changent pas** : exigences et compétences restent celles de l'offre publiée, relue par la
  personne qui publie. Le contexte aide l'IA à juger le métier, le domaine, le secteur et l'environnement.
- Texte préparé par `sourceContextForScoring` : e-mails, téléphones et liens masqués (ceux de l'interlocuteur du
  client), 4 000 caractères au plus (`SOURCE_CONTEXT_CHARS`, comme la description).
- Lu par `aoSourceContext` (`sourcing-core.ts`) pour toutes les notations par `cvScorer` : base candidats (« Rafraîchir »,
  sourcing automatique), vivier de l'offre, candidatures (screening, ajout au funnel), alertes du candidat et
  `npm run matching:explain`. Une lecture par offre et par passage, pas par CV.
- Autre offre, AO supprimé (purge à 365 jours) ou sans description : rien n'est ajouté, le message est identique à
  avant. Lecture impossible : notation sans le contexte, journalisée `[matching]`.
- Le vivier général (`scoreCvAgainstOffers`, lots de 5 offres) n'est pas concerné.

## Confidentialité

Le texte d'origine nomme le client. Il n'est jamais publié ni montré au candidat : il part seulement à l'IA de la
notation (ligne « Matching IA » de Config IA), qui reçoit déjà les vrais noms des clients pour le score final
(`finalOfferDetails`). Les citations de l'IA restent vérifiées dans le CV, jamais dans ce texte.

## Conséquences

- Les scores déjà enregistrés ne changent pas ; « Rafraîchir » (base candidats), « Relancer » (candidature) ou une
  nouvelle analyse les recalculent avec le contexte. Pour les offres qui ne viennent pas d'un AO, les notations gardées
  dans le cache (ADR 0044) restent valables : leur message est inchangé.
- Un appel d'IA un peu plus long pour les offres d'AO (jusqu'à 4 000 caractères de plus, dans la partie mise en cache
  chez Claude, identique pour tous les CV d'une offre).
- Essais sur DEV (une offre, un CV, `matching:explain`, quatre appels sans le contexte et quatre avec) : sans le
  contexte 42, 45, 41, 50 ; avec 40, 28, 46, 50. Le secteur a été jugé « non » avec le contexte au premier essai, puis
  « partiel » au second, comme sans lui. Sur cette offre, l'écart d'un appel à l'autre (intitulé découpé en un ou deux
  métiers, exigences de 1 à 4 sur 6) est plus grand que l'effet du contexte : **aucun gain mesuré à ce jour**. Un essai
  sur plusieurs offres et CV, jugés par un recruteur, reste à faire avant de conclure.
