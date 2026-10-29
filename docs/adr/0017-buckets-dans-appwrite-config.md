# 0017 — Buckets décrits par appwrite.config.json, créés par schema:push

- Statut : accepté
- Date : 2026-10-29
- Complète : 0011 (structure Appwrite décrite par appwrite.config.json)

## Contexte

L'ADR 0011 a mis les collections, attributs et index dans `appwrite.config.json`, appliqués par `schema:push`, et
laissé les buckets aux scripts `*:setup`. Le bucket des photos d'affiches (`social_scenes`, ADR 0015) n'avait que son
propre script (`social:setup`), sans étape de données : une mise en place de plus à ne pas oublier en production, à
côté de `schema:push`. Demande du 2026-10-29 : l'intégrer à la migration de structure.

La CLI épinglée (8.3.0) sait lire et pousser les buckets (`pull bucket`, `push bucket`), mais `push bucket` **réécrit
tous les réglages** d'un bucket existant avec ceux du fichier (`storageUpdateBucket`, permissions comprises) : poussé
tel quel, le fichier de DEV pourrait changer sans bruit les permissions d'un bucket de production. Et `pull bucket` lit
tous les buckets du projet, sans filtre.

## Décision

- **`appwrite.config.json` décrit aussi les buckets du projet DEV** : `schema:pull` les lit tous (`pull bucket`), avec
  les champs que la CLI garde (identifiant, permissions, `fileSecurity`, nom, activation, taille maximale, extensions,
  compression, chiffrement, antivirus). Aucun secret ni fichier.
- **`schema:push` ne fait que créer** les buckets absents du projet : la copie donnée à la CLI ne contient qu'eux
  (`pushCopy`), qui sont créés vides avec les réglages du fichier, montrés avant la confirmation (`create-bucket`).
- **Un bucket existant n'est jamais modifié** : s'il diffère du fichier, la différence est signalée (`bucket-settings`,
  ligne « ! »), `schema:check` et `schema:push` répondent 1, et elle se corrige dans la console Appwrite avant de se
  servir du bucket (un bucket ouvert aux clients, une extension manquante ne doivent pas passer inaperçus). Elle ne
  bloque pas les autres ajouts, puisque la CLI ne reçoit pas ce bucket. Les buckets du projet absents du fichier sont
  ignorés. Reste une fenêtre de quelques secondes : un bucket de même identifiant créé entre la comparaison et la
  poussée serait réécrit ; la CLI montre alors un tableau de modifications, auquel `schema:push` dit de répondre NO.
- Un fichier qui décrit deux fois le même bucket est refusé (`configFor`).
- **`social:setup` est retiré** : `social_scenes` est dans le fichier (présent sur DEV depuis le 2026-10-23). Les autres
  scripts `*:setup` restent : ils portent des étapes de données ou des vérifications qui leur sont propres
  (`cv-export:setup` : rattachement des versions, index unique en deux temps) ; un bucket qu'ils créeraient et que
  `schema:push` a déjà créé est simplement vérifié par eux.
- Règles pures : `diffBuckets`, `pushCopy`, `configFor` (`src/lib/appwrite/schema-diff.ts`, testées) ; script :
  `scripts/appwrite-schema.mts` (`pull bucket` après `pull collection`, puis `push bucket --all` seulement s'il y a un
  bucket à créer, avant `push collection`).

## Conséquences

- Mise en production de l'affiche avec photo : `schema:check -- prod` puis `schema:push -- prod` (par un humain, après
  sauvegarde), puis la variable `APPWRITE_STORAGE_SOCIAL_SCENES`, au lieu de `social:setup --prod --apply`. Le bucket
  suit désormais tout l'état de la structure : `schema:push` pousse aussi les autres ajouts en attente, et une ligne ✗
  sans rapport bloque tout ; dans ce cas, `social_scenes` se crée dans la console avec exactement les réglages du
  fichier (voir AGENTS.md).
- Avant le premier commit de ce fichier : sur DEV, `schema:check -- dev` doit répondre « identique » et `schema:pull`
  ne doit rien changer (`git diff appwrite.config.json` vide) — la liste des buckets a été écrite d'après l'API du
  projet DEV, dans l'ordre et les champs de la CLI.
- Un nouveau bucket s'ajoute comme une collection : console de DEV puis `schema:pull`, commit avec le code.
- Modifier un bucket existant (permissions, taille, extensions) reste une opération de console, sur DEV puis en
  production ; `schema:check` montre l'écart tant qu'il existe.
- Les buckets de DEV qui ont des permissions client (`create("any")` sur `vivier_cvs` et `recordings`, `read("any")` sur
  `logos` et `media`) sont décrits tels quels : un projet qui ne les a pas les recevrait avec ces permissions, montrées
  avant la confirmation.
