# 0037 — MBC Search : un besoin, plusieurs requêtes Apollo

- Statut : accepté
- Date : 2026-11-16

## Contexte

Demande du 2026-11-16 : rapprocher MBC Search (ADR 0018, 0032) d'un outil de sourcing par IA « à la Sherlock ».
Phase 1 retenue avec l'utilisateur : chercher en plusieurs requêtes, réunir les profils sans doublon, montrer
l'avancement et ce que chaque requête a trouvé, mieux classer. Les phases suivantes (évaluation par l'IA des profils
révélés, profils similaires, approche LinkedIn / WhatsApp, filtres et export, suivi de la sélection) ne sont pas
faites ici.

Une seule requête à Apollo manque les personnes qui exercent le même métier sous un autre intitulé (« Ingénieur Data »
pour « Data Engineer », « Data Platform Engineer »…). Apollo (vérifié dans sa documentation le 2026-11-16) :

- la recherche (`mixed_people/api_search`) est gratuite, rend au plus 100 profils par page, et ne donne par personne
  que le prénom, le nom masqué, l'intitulé et l'employeur actuels, et des indicateurs (e-mail, téléphone connus) : ni
  lieu, ni compétences, ni parcours, ni formation, ni langues ;
- débit : 200 demandes par minute et 50 000 par jour sur les formules payantes, 600 par jour sur la gratuite ; un
  refus 429 donne son délai dans l'en-tête `retry-after` (sans lui : surcharge d'Apollo, une minute).

Le seul texte comparable avant enrichissement est donc l'intitulé.

## Décision

- **Requêtes d'un besoin** (`planMbcStrategies`, règles `src/lib/mbc-search/strategies.ts`, testées) : celle des
  critères du recruteur d'abord, puis jusqu'à 4 autres proposées par l'IA (ligne « Matching IA » de Config IA, Claude
  par défaut). L'IA ne propose que des **intitulés** du même métier et, sans compétence ★ du recruteur, 0 à 2 mots-clés ;
  le lieu, la séniorité, le secteur et les filtres restent ceux du recruteur, ses compétences ★ restent obligatoires
  partout. Chaque requête est validée par `criteriaSchema` ; l'IA n'écrit jamais de requête Apollo (`toApolloQuery`
  reste le seul constructeur). IA indisponible : la requête du recruteur seule, et la page le dit.
- **Exécution par la page**, une requête après l'autre (une Server Action `searchMbcProfiles` par page de 100
  profils) : l'avancement de chacune s'affiche (trouvés, nouveaux, échec, arrêtée) et « Arrêter » stoppe après celle en
  cours (une Server Action ne s'interrompt pas). Un refus qui se répéterait (session, formule, quota, clé ou crédits
  Apollo, débit dépassé : `stop`) arrête la recherche ; une requête en échec n'arrête pas les autres ; aucune n'aboutit :
  le fil le dit. Une page suivante en échec garde les profils de la requête et sera proposée de nouveau (`failedRun`) ;
  serveur injoignable en cours de route : la fin du passage est faite quand même (`settledRuns`).
- **Une liste sans doublon** (`mergePool`, identifiant Apollo, seul connu avant enrichissement), classée par score ;
  50 profils affichés à la fois. **« Chercher plus loin »** : page suivante des requêtes qui ont encore des profils, 5
  pages (500 profils) par requête au plus.
- **Classement** : chaque profil est noté sur les critères du recruteur, quelle que soit la requête qui l'a trouvé.
  Les intitulés de chaque page sont comparés au métier demandé par la même question à l'IA que la notation des
  candidats (`titleCheckPrompt`, ADR 0028 : même métier / métier voisin / autre métier), une seule question par page ;
  l'avis remplace les mots en commun pour les points de l'intitulé (un intitulé qui contient tous les mots d'un intitulé
  demandé garde tous ses points : même métier, autre niveau ; un intitulé identique à l'un de ceux demandés n'est pas
  demandé à l'IA). IA indisponible, ou réponse d'une autre longueur que la liste (un avis oublié décalerait tous les
  suivants : `parseTitleRelations(…, exact)`) : les mots en commun, et la page le dit.
- **Apollo** : un second essai pour la recherche seulement (gratuite), après un 429 au délai `retry-after` de 10 s au
  plus ou une erreur 500 / 502 / 503 / 504 (une seconde) ; jamais pour l'enrichissement (payant). Moins de 100 demandes
  restantes du jour (`x-24-hour-requests-left`) : avertissement dans les journaux.
- **Quota** : une place par page de requête (la comparaison de ses intitulés par l'IA comprise) et par autre appel à
  l'IA (questions, lecture du besoin, requêtes, ajustement, approche). Les formules standard passent de 60 à **300**
  par jour et par organisation, 3 000 pour toutes (décision du 2026-11-16).
- **Débit** (revue de sécurité du 2026-11-16) : le quota du jour ne limite pas les rafales — la page envoie ses requêtes
  l'une après l'autre, mais un recruteur pourrait appeler les actions toutes à la fois et faire refuser Apollo (clé de
  la plateforme) et l'IA de notation à toutes les organisations. 20 appels par minute et par recruteur au plus
  (`takeBurstSlot`, `src/lib/mbc-search/burst.ts`, testé), en mémoire du processus serveur : exact en production (un
  seul processus sur le VPS, ADR 0027), approché sur Vercel (plusieurs instances).
- **Historique** : inchangé (critères du recruteur et nombre de profils de sa requête) ; les requêtes de l'IA ne sont
  pas enregistrées, une recherche relancée depuis l'historique les redemande (un appel à l'IA).

## Conséquences

- Une recherche coûte environ 6 places du quota (1 pour l'IA, 5 requêtes) et 6 appels à l'IA (requêtes, puis une
  comparaison des intitulés par page). Sur la formule gratuite d'Apollo, 600 demandes par jour pour toute la plateforme
  suffisent à une centaine de recherches : au-delà, Apollo refuse (429) et la page le dit.
- Une recherche dure plus longtemps (une requête après l'autre, quelques secondes chacune) ; les profils s'affichent au
  fil des requêtes.
- Profils de tiers (nom masqué, intitulé, employeur) qu'une organisation peut voir par jour : environ 30 000 (300 pages
  de 100) contre 1 500 avant (60 pages de 25). Rien n'en est enregistré, mais le volume est à reporter au registre des
  traitements (RGPD).
- Retour arrière : revenir au commit précédent ; aucune donnée ni structure n'a changé.

## Mise à jour du 2026-11-17 : mots du métier

Demande de l'utilisateur : reprendre la façon dont l'assistant d'Apollo cherche (mots-clés dans tout le profil plutôt
qu'intitulé exact), avec notre fonctionnement. Essais sur l'API, Paris :

| Requête | Profils |
|---|---|
| Intitulés « Spécialiste support monétique », « Support monétique » + séniorité « senior » | 0 |
| Mêmes intitulés, sans séniorité | 7, tous du métier |
| Mot-clé « monétique » + séniorité « senior » | 3 |
| Mot-clé « monétique », sans séniorité | 288, presque tous du métier |
| Mots-clés « monétique paiement » | 23 (Apollo exige tous les mots) |

Décision : l'IA donne aussi 0 à 2 **mots du métier** (`keywords`, ex. « monétique », « payments ») ; chacun devient une
requête juste après celle du recruteur (`parseStrategies`) : le mot cherché seul dans tout le profil (`q_keywords`, avec
les compétences ★ du recruteur), **sans intitulé ni séniorité** (la séniorité d'Apollo est un niveau strict qui écarte
la plupart des bons profils), lieu, secteur et filtres gardés. Les profils trouvés sont notés comme les autres, sur les
critères du recruteur avec la comparaison des intitulés par l'IA : un profil qui cite le mot sans exercer le métier
reste en bas de la liste. Le « filtre IA » et la recherche sémantique de l'assistant d'Apollo ne sont pas dans
l'API de recherche utilisée ; notre comparaison des intitulés par l'IA en tient lieu.
