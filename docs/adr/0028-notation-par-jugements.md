# 0028 — Notation d'un candidat : jugements de l'IA, score calculé par le code

- Statut : accepté
- Date : 2026-11-04
- Complète : la notation commune du 2026-11-03 (`src/lib/match-scoring.ts`, plafond quand le domaine exigé manque)

## Contexte

Signalé le 2026-11-04 sur le Matching IA d'une offre (`/recruiter/pipeline/<offre>/matching`) :

- **les scores changeaient à chaque « Rafraîchir »** ;
- **un candidat noté 85 ne correspondait pas à son CV**.

Causes, toutes dans le code :

- « Rafraîchir (nouveaux candidats) » supprimait toutes les notes de la base candidats et les redemandait à l'IA. L'IA
  donnait une note libre de 0 à 100 ; la température ne se règle plus sur les modèles Claude actuels (paramètre refusé
  par l'API), et le repli de `callLLM` peut faire répondre un autre modèle. La même offre recevait donc d'autres notes.
- Les candidats de la base étaient notés **30 par appel**, désignés par leur identifiant ; les offres du vivier général,
  **15 par appel**, aussi par leur identifiant. Des identifiants créés à quelques secondes d'écart ne diffèrent que de
  quelques caractères (`ao6ae0953500168aad7a8a`) : un identifiant mal recopié par l'IA rattache une note et sa raison
  à un autre candidat ou à une autre offre. La note d'un candidat dépendait aussi des autres CV du lot.
- Le CV était coupé à **3 000 caractères** pour la base (5 000 pour une candidature) : en-tête et dernière expérience ;
  les expériences anciennes, où figure souvent le domaine demandé, n'étaient pas lues.
- Les 30 candidats étaient pris sans ordre parmi les 200 premiers profils de la base.

Le diagnostic sur les données de l'offre signalée (production) n'a pas pu être fait : la lecture de la base de
production n'est pas permise depuis l'outil de développement.

## Décision

- **Le titre de l'offre est la référence** (demande du même jour, après un premier essai sans ce critère) : premier
  jugement, `poste` (oui / partiel / non) — le candidat a-t-il exercé le métier du titre ? Des compétences de la liste
  partagées avec un autre métier ne suffisent plus : un développeur n'est pas noté haut sur une offre de chef de projet.
  Un titre à plusieurs métiers est jugé métier par métier (`"poste": [{"metier", "exerce"}]`) : sur « Scrum Master et
  Développeur Full Stack », un Scrum Master qui n'avait jamais développé était noté 85 ; un métier non exercé plafonne
  maintenant le score (50), sans se compenser par l'autre.
- **Expériences du CV comparées à la description** (demande du même jour) : l'offre est découpée par le code en
  exigences (`offerRequirements` : puces du profil recherché, puis des missions, 10 au plus — les mêmes pour tous les
  candidats et d'un calcul à l'autre), jugées une à une contre les expériences du CV ; tout « oui » cite l'expérience qui
  le prouve, sans quoi le code le ramène à « partiel » ; le niveau est compté sur les expériences du même métier.
  Le CV d'un vivier est envoyé avec 8 expériences et 5 missions chacune.
- **Preuves vérifiées par le code** (même jour, après `matching:explain` sur le cas de production : 66 au lieu de 50,
  l'IA comptant un poste d'expert sécurité « en environnement agile » comme Scrum Master et citant la liste des
  compétences) : pour chaque métier du titre, l'intitulé exact d'un poste du CV (sans intitulé : « non » ; absent du
  CV : un niveau de moins), puis une **seconde question à l'IA, étroite**, compare chaque intitulé au métier demandé :
  même métier (jugement gardé), même famille (« partiel » au plus), autre métier (« non ») ; comparaison impossible :
  « partiel » au plus. Une première version rapprochait les intitulés par des listes de mots (génériques, synonymes) :
  abandonnée le même jour, elle ne valait que pour les métiers listés ; la question à l'IA vaut pour tout métier et tout
  domaine. Pour une exigence ou une compétence « oui », une ligne d'expérience d'au moins 5 mots retrouvée dans le CV,
  pas une liste de mots-clés, et qui nomme la compétence (un de ses mots de 3 lettres ou plus) ; sinon « partiel ».
- **L'IA juge, le code note.** Pour chaque candidat et chaque offre, l'IA répond par jugements : `poste`, `domaine` (oui /
  partiel / non / non requis), `competences` (oui / partiel / non pour chaque compétence demandée, liste numérotée de
  l'offre, 12 au plus ; un jugement d'ensemble sans liste) et `niveau` (oui / partiel / non / non précisé). Le score est
  calculé par `judgedScore` : poste 30, exigences 30, compétences 20, domaine 15, niveau 5 (`SCORE_WEIGHTS`), puis le plus bas
  des plafonds (`capFor`) : poste non exercé 50, voisin 75 ; domaine absent 60, voisin 80. Une réponse sans jugement
  lisible ne donne pas de score.
- **La raison dit d'où vient le score** : « Poste : oui · Exigences : 4 sur 6 · Compétences : 6 sur 9 · Domaine : non · Niveau : oui — … ».
- **Base candidats : un appel par candidat** (5 à la fois), aucun identifiant à recopier ; CV lu jusqu'à 12 000
  caractères ; 30 candidats par passage, les plus récents d'abord.
- **Vivier général : offres numérotées 1 à 5** dans chaque appel (5 au lieu de 15), le code retrouve l'offre par son
  numéro.
- **« Rafraîchir » note seulement les nouveaux candidats** de la base et ne touche plus aux scores existants (les CV
  illisibles sont passés, pour ne pas bloquer les suivants) ; « Recalculer tout » (après confirmation) renote les
  candidats déjà notés, 120 au plus. Les notes sont écrites ligne par ligne (`planPoolRows`) : une note n'est jamais
  supprimée parce que son nouveau calcul a échoué, seuls partent les candidats qui ne sont plus à noter ; identifiant
  fixe par offre et candidat, deux passages simultanés n'écrivent qu'une ligne. Les comptes rendus s'affichent sur la
  page et dans la section Sourcing d'un AO, à côté des résultats.

## Conséquences

- Les scores bougent par paliers de jugements (une compétence qui passe de « partiel » à « oui » sur 10 vaut 2,5
  points) au lieu d'une note libre : deux calculs du même CV donnent le même score ou un score très proche.
- Plus d'appels d'IA pour la base candidats (30 au lieu d'un, plus une courte comparaison des intitulés par candidat) ; « Rafraîchir » ne note plus que les
  nouveaux candidats, souvent aucun. « Recalculer tout » prend de une à quelques minutes (`maxDuration = 300`).
- Les poids (30 / 30 / 20 / 15 / 5) et les plafonds sont une règle métier, réglable dans `SCORE_WEIGHTS`, `ROLE_CAP` et
  `DOMAIN_CAP` ; à revoir avec les recruteurs.
- Les scores enregistrés avant ce changement ne sont pas recalculés : « Recalculer tout » pour la base d'une offre,
  « Relancer » sur la carte d'une candidature ; les CV des viviers gardent leur note jusqu'à une nouvelle comparaison.
- L'e-mail automatique au candidat (score de 70 ou plus) part à la première analyse seulement : relancer l'analyse ne
  lui écrit pas une seconde fois. Il ne contient que le résumé de l'IA, jamais les jugements internes.
- Reste ouvert : « Rafraîchir » et « Recalculer tout » n'ont pas de quota (appel d'IA à nos frais) ; le repli sur un
  autre modèle peut encore donner un jugement différent quand le modèle choisi est indisponible.
