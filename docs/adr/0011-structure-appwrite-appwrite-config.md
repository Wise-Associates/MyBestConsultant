# 0011 — Structure Appwrite décrite par appwrite.config.json et appliquée par la CLI Appwrite

- Statut : accepté
- Date : 2026-10-27
- Complétée par : 0017 (buckets dans le fichier, créés par schema:push)

## Contexte

Les collections, attributs et index étaient créés par un script par fonctionnalité (`ao:setup`, `assistant:setup`,
`cv-export:setup`) : un script à écrire à chaque ajout, aucune vue d'ensemble de la structure, et pas de moyen simple de
voir l'écart entre DEV et la production.

Appwrite n'est pas « sans schéma » : en 1.7 auto-hébergé, chaque collection est une table MariaDB, chaque attribut une
colonne, chaque index un index SQL. Un document qui porte un attribut inconnu est refusé ; changer le type ou la taille
d'un attribut revient à le supprimer et le recréer (données perdues) ; un index unique ne se crée pas si les données le
contredisent ; il n'y a pas de transaction.

Constats du 2026-10-27, en lisant le code de la CLI :

- `appwrite-cli` 8.3.0 est la dernière version compatible avec le serveur 1.7.x (à partir de 9.0 : serveur 1.8,
  « TablesDB »). Elle lit `appwrite.config.json` et n'y prend que là le projet visé : il n'existe pas d'option
  « environnement ».
- `push collection` supprime les attributs et index présents sur le projet mais absents du fichier, et supprime puis
  recrée ceux dont le type, la taille, le caractère tableau ou le format changent ; elle demande confirmation, que
  `--force` saute. Elle crée sans rien demander une base ou une collection absente. Elle affiche les permissions, la
  sécurité par document et l'activation d'une collection existante, mais ne les applique pas. Elle affiche et dit
  appliquer les modifications sur place d'un attribut (obligatoire, valeur par défaut, bornes, valeurs d'une
  énumération), mais renvoie au serveur les valeurs qu'il a déjà (`attribute = remote` dans `checkAttributeChanges`) :
  rien ne change.
- `pull collection` ajoute les collections lues à celles du fichier sans retirer les autres : tiré par-dessus le fichier,
  il y garderait une collection supprimée sur DEV.
- La base de DEV s'appelle `bestconsultant-dev`, celle de la production `bestconsult` ; les collections ont les mêmes
  identifiants. Le projet de production contient aussi une ancienne base `bestconsult-copy` (« bestconsult for Dev »,
  25 collections) que le fichier ne décrit pas.
- Les bornes des attributs entiers sans limite (±9223372036854775807) sont arrondies par `JSON.parse` ; la CLI, qui les
  lit au chiffre près, verrait des bornes modifiées.
- Premier écart trouvé : l'ancien index unique `cv_exports.candidateversion` existait encore sur DEV (l'étape
  `--drop-old-index` de l'ADR 0010 n'y avait pas été faite). Pousser DEV vers la production l'y aurait recréé, et deux
  organisations n'auraient plus pu garder chacune leur version d'un même candidat. Étape faite sur DEV le 2026-10-27 :
  DEV et production sont identiques au fichier.

## Décision

- **`appwrite.config.json` est l'instantané de la structure du projet DEV** (collections de la base
  `bestconsultant-dev`), versionné et relu en revue de code avec le code qui l'utilise. Il est remplacé par
  `npm run schema:pull` (lecture de DEV dans un fichier vide, puis copie), jamais réécrit par un outil qui lit les
  nombres en double précision.
- **CLI épinglée** : `appwrite-cli` 8.3.0, en version exacte dans les devDependencies (la branche 8.x ne reçoit plus de
  mises à jour : c'est le prix du serveur 1.7.4). `npm run appwrite -- …` la lance avec le délai réseau du projet.
- **`npm run schema:check -- dev|prod`** lit la structure du projet (pull dans un dossier temporaire, rien n'est
  modifié) et la compare au fichier comme le ferait la CLI (`src/lib/appwrite/schema-diff.ts`, règles pures testées).
  Code de sortie 1 s'il y a une différence.
- **`npm run schema:push -- dev|prod`** n'applique que des ajouts : collection (ses permissions sont affichées),
  attribut facultatif, index non unique. Il **ne supprime jamais rien** : la CLI reçoit le fichier complété par ce que
  seul le projet a (affiché « gardé ») ; la suppression d'un attribut que le code en production utilise encore attend
  donc son script sans bloquer les ajouts des autres fonctionnalités. Il refuse, sans rien pousser : une recréation, un
  attribut obligatoire ou un index unique ajoutés à une collection existante (documents sans valeur, doublons), une
  modification sur place ou un réglage de collection (que la CLI n'applique pas), un index du projet non disponible
  (« failed » : la CLI ne compare pas cet état), une borne arrondie. Il faut taper l'identifiant du projet ; la
  comparaison est refaite juste après (rien n'est poussé si le projet ou le fichier ont changé entre-temps), puis la
  CLI demande ses propres confirmations (jamais `--force`). La structure est relue ensuite, même si la CLI s'arrête en
  route. Sur DEV, le fichier est ensuite repris depuis le projet : la CLI complète les réglages par défaut (`array`,
  `encrypt`…) d'un attribut écrit à la main, qui sinon paraîtrait à recréer. La CLI travaille sur une copie du fichier,
  dans un dossier temporaire, qui vise le projet et la base de l'environnement ; la base est celle lue sur le projet,
  que la CLI ne crée ni ne renomme donc jamais.
- **Production** : lancée par un humain, après sauvegarde de la base (pas de sauvegarde intégrée en auto-hébergé :
  dump MariaDB), avant de mettre en production le code qui utilise les ajouts.
- **Ce qui reste un script (ou la console)** : les données (remplissage, rattachement), les suppressions et changements
  de type (ajouter le nouvel attribut, migrer, supprimer l'ancien après le déploiement du code), les modifications d'un
  attribut existant (le rendre obligatoire une fois rempli…), un index unique sur une collection qui a des données
  (vérifier les doublons ; remplacement en deux temps), les réglages de collection et les buckets (absents du fichier ;
  depuis l'ADR 0017, ils y sont et schema:push crée ceux qui manquent). Les scripts `*:setup` existants restent : ils
  portent des étapes de données et décrivent la mise en place déjà faite.

## Conséquences

- Ajouter une collection, un attribut ou un index ne demande plus de script : modifier DEV dans la console puis
  `schema:pull`, ou modifier le fichier puis `schema:push -- dev` ; commit avec le code ; `schema:check -- prod` puis
  `schema:push -- prod` par un humain.
- La session de la CLI (`npm run appwrite -- login`) est une session de la console : elle ouvre tous les projets du
  serveur, production comprise. La fermer après usage (`npm run appwrite -- logout`).
- Le fichier ne contient que la structure, aucun secret ni aucune donnée.
- Passer au serveur Appwrite 1.8 impose une autre CLI (tables au lieu de collections) : ce mécanisme sera à revoir.
