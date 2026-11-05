# 0027 — Production sur un VPS (Docker, Caddy, bascule bleue / verte)

- Statut : accepté (installation du serveur et bascule du DNS à faire par un humain : docs/deploiement-vps.md)
- Date : 2026-11-04
- Note : le numéro 0025 est pris par une décision non fusionnée (procédure de mise en production).
- Mise à jour du 2026-11-05 : le déclenchement est remplacé par l'ADR 0025 (lancement à la main depuis `main`, `prod`
  avancée par le workflow, environnement `production` limité à `main`). Le reste de cet ADR est inchangé.

## Contexte

La production tourne sur Vercel (branche `prod`), Appwrite sur son propre serveur. Demande du 2026-11-04 : installer
MyBestConsultant sur un VPS. Choix faits ce jour-là : un **nouveau VPS, séparé** de celui d'Appwrite (Appwrite n'est
pas touché), **Caddy** comme proxy, **la production seulement** (Vercel garde les previews `pre-dev` / `dev` branchées
sur le projet Appwrite DEV).

Ce que Vercel faisait sans qu'on le voie et qu'il faut refaire :

- HTTPS, certificats, en-tête HSTS ;
- les tâches planifiées de `vercel.json` (Vercel Cron) ;
- l'attente des tâches `after()` (diffusion sur les réseaux, sourcing, présélection), jusqu'à `maxDuration = 300` ;
- un déploiement sans coupure.

Vérifié dans Next.js 16.2.9 (`dist/server/lib/start-server.js`) : à l'arrêt (SIGTERM), le serveur **ferme d'abord son
port**, puis attend les requêtes en cours et les tâches `after()`. Avec un seul conteneur, le site serait coupé pendant
toute cette attente (jusqu'à 5 min si une publication vient d'être faite).

## Décision

- **Image Docker** (`Dockerfile`, `output: "standalone"` dans `next.config.ts`), construite par GitHub Actions et non
  sur le serveur : le serveur n'a pas besoin de la mémoire d'un build, et rien ne part sans que les types et les tests
  passent. Les valeurs `NEXT_PUBLIC_*` sont écrites dans le code au build : une image ne vaut que pour la production.
  Aucun secret dans l'image (`.dockerignore` exclut `.env*`) : ils sont lus au démarrage dans
  `/etc/mybestconsultant/app.env` sur le serveur.
- **Aucune page générée au build avec des données.** Sur Vercel, le build avait tous les secrets : le plan du site
  (`sitemap.ts`) et la page 404 (thème lu par `getSiteConfig` dans `layout.tsx`) étaient générés au build avec les
  données d'Appwrite. Sans secrets, les lectures échouent en silence (`catch` → liste vide, réglages par défaut).
  Les deux sont désormais rendus à chaque requête (`export const dynamic = 'force-dynamic'`), ce qui garde aussi le plan
  du site à jour entre deux déploiements. `scripts/check-prerendered.mjs`, lancé par le Dockerfile, fait échouer le
  build si une autre page que favicon, icône, `robots.txt` et la page d'erreur globale est générée au build.
- **Caddy** devant l'application (`deploy/caddy/Caddyfile`) : certificats Let's Encrypt automatiques, HSTS (domaine
  nu compris), redirection du domaine nu vers `www`, ni délai maximal ni mise en mémoire tampon (routes de 300 s,
  streaming), en-tête `Host` transmis tel quel (les Server Actions le comparent à `Origin`). Retenu plutôt que nginx,
  dont les réglages par défaut cassent chacun de ces points (1 Mo, 60 s, mise en mémoire tampon, `Host` réécrit).
  Envois limités à 12 Mo : le plus gros qui passe par le serveur fait 10 Mo (`/api/upload`), les enregistrements
  d'entretien vont directement à Appwrite, et Vercel refusait déjà au-delà de 4,5 Mo.
- **Bascule bleue / verte** (`deploy/mbc-deploy.sh`) : la nouvelle version démarre à côté de l'ancienne, doit répondre
  à son contrôle de santé, Caddy passe dessus (rechargement sans coupure), puis l'ancienne finit ses requêtes et ses
  tâches `after()` (330 s au plus) avant de s'arrêter. Une erreur avant le passage de Caddy laisse l'ancienne en ligne.
  Caddy n'est **jamais recréé pendant un déploiement** (`--no-recreate`) : recréé, il partirait sur la nouvelle couleur
  avant toute vérification. Un changement de `deploy/compose.proxy.yml` (version de Caddy) est signalé et s'applique
  par `mbc-deploy proxy`, qui valide le Caddyfile avec la nouvelle image avant de remplacer Caddy (coupure de quelques
  secondes, à faire hors des heures de travail). Une connexion SSH coupée n'interrompt pas la bascule (signaux ignorés,
  journal du déploiement gardé sur le serveur).
- **Envoi de l'image par SSH** (`docker save | ssh`), sans registre : rien à configurer chez GitHub Packages, aucun jeton
  de registre sur le serveur. La clé SSH de GitHub Actions ne peut lancer que `mbc-deploy` (`command=` et `restrict`
  dans `authorized_keys`). Les 5 dernières images restent sur le serveur pour un retour arrière immédiat.
- **Clé de déploiement isolée** : le workflow a deux jobs. « verify » exécute le code du dépôt et de ses dépendances
  (`npm ci`, tests) sans aucun secret ; « deploy » (environnement `production`, limité à `prod`) détient la clé SSH et
  n'exécute aucun code du dépôt sur la machine de GitHub : le build a lieu dans un conteneur Docker, sans accès aux
  fichiers ni aux variables du job. Un retour arrière lancé à la main n'accepte qu'un commit déjà mis en production
  (déploiements de l'environnement `production` enregistrés par GitHub), jamais un commit intermédiaire d'une pull
  request. Images de Node et de Caddy désignées par leur empreinte.
- **Configuration versionnée** : le serveur a une copie du dépôt (clé de lecture seule) ; chaque déploiement en prend
  les fichiers `deploy/` du commit déployé (compose, Caddyfile, crontab).
- **Tâches planifiées** : la crontab de l'utilisateur `deploy` (`deploy/crontab`, mêmes heures que `vercel.json`),
  qui appelle les routes `/api/cron/*` avec `CRON_SECRET` comme Vercel Cron (`deploy/mbc-cron.sh`), toujours sur le
  Caddy de ce serveur (`curl --resolve`) : avant la bascule du DNS, rien ne tourne deux fois. Les routes ne changent pas.
- **Conteneurs durcis** : systèmes de fichiers en lecture seule (application : sauf `/tmp` et le cache de Next.js),
  aucun privilège (Caddy : seulement l'ouverture des ports 80 et 443), aucun port publié pour l'application, 2 Go et
  512 processus au plus pour elle, journaux limités à 100 Mo par conteneur. L'application lit des fichiers venus de
  l'extérieur (PDF, Word, Excel, e-mails) : une faille de lecture ne peut pas modifier le code. `KEEP_ALIVE_TIMEOUT`
  de Node (130 s) au-delà des 2 min pendant lesquelles Caddy réutilise une connexion : pas de 502 sur une connexion
  que Node viendrait de fermer.

## Risque accepté

Le serveur ne peut pas vérifier qu'une image vient bien du workflow : la clé SSH de déploiement permet de faire tourner
n'importe quelle image avec les secrets de production. Elle est protégée comme un secret de production (environnement
limité à `prod`, job sans code du dépôt, validation par une seconde personne conseillée). Pour fermer ce risque : faire
signer l'image par le workflow (cosign sans clé, identité OIDC de GitHub) et vérifier la signature dans `mbc-deploy`
avant de démarrer l'image ; écarté pour l'instant (un outil de plus sur le serveur et dans le workflow).

## Conséquences

- Mise en production inchangée pour l'équipe : pull request `dev` → `prod`, fusionnée par un humain ; le workflow
  `.github/workflows/deploy-vps.yml` déploie ensuite (environ 10 min). Il ne fait rien tant que la variable `VPS_HOST`
  n'existe pas : ce code peut arriver sur `prod` avant que le serveur soit prêt.
- Si une procédure de mise en production pousse `prod` avec le jeton `GITHUB_TOKEN` d'un autre workflow (ADR 0025 non
  fusionné), GitHub ne déclenche pas `push` : ce workflow devra appeler celui-ci (`workflow_call`) ou le lancer.
- Une nouvelle variable d'environnement s'ajoute dans `app.env` du serveur **avant** la mise en production du code qui
  l'utilise ; une variable `NEXT_PUBLIC_*` aussi dans les variables de l'environnement GitHub `production`.
- Le serveur ne garde aucune donnée (tout est dans Appwrite) : seul `app.env` est à conserver (gestionnaire de mots de
  passe de l'équipe). Mises à jour du système, de Docker, de Node.js (Dockerfile) et de Caddy (compose) à suivre par
  l'équipe ; Vercel le faisait.
- Après la bascule du DNS : désactiver Vercel Cron, puis, une fois la production stable, retirer de `vercel.json` les
  `crons` et la production, supprimer les anciens déploiements de production de Vercel (encore joignables avec leurs
  secrets sur l'adresse `…vercel.app`) et changer les secrets que Vercel a détenus (étapes dans le guide). D'ici là,
  les mentions de Vercel Cron dans AGENTS.md restent vraies.
- Valeurs de `app.env` entre apostrophes : sinon Docker coupe une valeur au premier `$` sans prévenir (vérifié).

## Écartés

- **Conteneur unique redémarré** à chaque déploiement : coupure pendant l'attente des tâches `after()` (voir Contexte).
- **Même serveur qu'Appwrite** : son Traefik occupe les ports 80 et 443 ; il aurait fallu le déplacer derrière le
  nouveau proxy, donc modifier l'Appwrite de production.
- **Construction sur le serveur** (`git pull` puis `docker compose build`) : plus simple, mais un build de Next.js
  demande plusieurs Go de mémoire sur le serveur de production, et rien ne vérifierait les types et les tests avant.
- **Registre d'images (GitHub Packages)** : historique des images, mais un jeton de lecture à garder sur le serveur
  (lié au compte d'une personne) ; l'envoi par SSH suffit pour un seul serveur.
