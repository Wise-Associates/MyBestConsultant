# Veilleur AO (IMAP IDLE)

Déclenche la lecture de la boîte des appels d'offres (`ao@wise-associates.fr`) **dès qu'un e-mail arrive**,
au lieu d'attendre le Vercel Cron quotidien (plan Hobby : une exécution par jour au maximum).

Le veilleur garde une connexion IMAP ouverte en lecture seule avec la commande IDLE : le serveur IONOS le
prévient à l'arrivée d'un message, et il appelle aussitôt `GET /api/cron/ao-inbox` sur le site. Il ne lit
ni ne traite aucun e-mail lui-même : la lecture, l'IA, le dédoublonnage et le verrou restent dans le site
(`src/lib/ao/`). Pourquoi ce choix : [docs/adr/0001-veilleur-ao-imap-idle.md](../../docs/adr/0001-veilleur-ao-imap-idle.md).

```
IONOS (ao@) ──« nouveau message » (IDLE)──▶ veilleur (Docker, serveur Hetzner)
                                                │ GET + Authorization: Bearer CRON_SECRET
                                                ▼
                                   site (Vercel) /api/cron/ao-inbox ──▶ lit la boîte (IMAP, lecture seule)
                                                                    └─▶ enregistre dans Appwrite
```

## Comportement

| Situation | Réaction |
|---|---|
| Nouveau message | appel 5 s plus tard ; une rafale de messages donne un seul appel |
| Message pendant un appel | un nouvel appel suit (jamais deux à la fois) |
| Le site répond `skipped` (bouton admin ou cron en cours) | nouvel essai après 1 min |
| Le site répond `remaining > 0` (passage limité à 25 e-mails / 4 min) | suite après 30 s, jusqu'à épuisement |
| Erreur du site (injoignable, 5xx, 401…) | nouvel essai après 1, 2 puis 5 min |
| Connexion IMAP coupée | reconnexion après 5 s, 15 s, 1 min puis toutes les 5 min |
| Identifiants IMAP refusés | nouvel essai après 5 min, 15 min puis toutes les heures (des échecs répétés pourraient faire bloquer la boîte, que le site lit aussi) |
| Démarrage et chaque reconnexion | un appel, pour rattraper ce qui est arrivé entre-temps |
| Contrôle de secours | un appel toutes les `AO_IDLE_FALLBACK_MINUTES` (15 min), même sans IMAP |

IDLE est relancé toutes les 4 minutes pour garder la connexion active. Le journal ne contient que des
événements et des nombres : ni contenu d'e-mail, ni adresse, ni secret.

## Variables

Sur le serveur : fichier `.env` de ce dossier (modèle : [.env.example](.env.example)). En local : les fichiers
`.env*` du projet (voir plus bas).

| Variable | Rôle |
|---|---|
| `AO_IMAP_HOST`, `AO_IMAP_PORT`, `AO_IMAP_USER`, `AO_IMAP_PASSWORD`, `AO_IMAP_MAILBOX` | Boîte surveillée : **la même** que celle lue par le site (valeurs `AO_IMAP_*` de Vercel). Hôte `imap.ionos.fr`, port 993 et dossier `INBOX` par défaut. |
| `AO_SYNC_URL` | Adresse appelée : `https://www.mybestconsultant.fr/api/cron/ao-inbox` en production. Adresse finale exigée (le domaine sans `www` redirige, ce qui ferait perdre l'en-tête d'authentification : le veilleur le signale). https obligatoire, sauf vers `localhost`. |
| `CRON_SECRET` | Exactement celui de l'environnement Vercel visé (16 caractères minimum, sans retour à la ligne). |
| `AO_IDLE_FALLBACK_MINUTES` | Intervalle du contrôle de secours, 15 par défaut, de 1 à 1440 (un jour). |

Une variable manquante ou invalide arrête le veilleur au démarrage avec la liste des problèmes.

## Lancer en local

1. Dans `.env.development.local` à la racine du projet : `AO_IMAP_*`, `CRON_SECRET` (le même fichier sert à
   `next dev`) et `AO_SYNC_URL=http://localhost:3000/api/cron/ao-inbox`.
2. Terminal 1 : `npm run dev:local` (ou `npm run dev`).
3. Terminal 2 : `npm run ao:idle` (Ctrl+C pour arrêter).

Le script charge les fichiers `.env*` dans le même ordre de priorité que `next dev` (dont `.env`, qui contient
les valeurs de production) ; il refuse donc de démarrer si `AO_SYNC_URL` vise autre chose que `localhost`,
`127.0.0.1` ou `[::1]`. Le serveur local écrit dans le projet Appwrite de ses fichiers `.env*` (normalement DEV).

## Déployer sur le serveur Hetzner

Prérequis : Docker avec le plugin compose sur le serveur ; en production, le site contient
`/api/cron/ao-inbox`, les collections AO existent (`npm run ao:setup`), et `CRON_SECRET` et `AO_IMAP_*` sont
définis dans les variables Vercel.

1. Copier ce dossier sur le serveur, par exemple :
   `rsync -a --exclude node_modules --exclude .env workers/ao-idle/ <utilisateur>@<serveur>:/opt/mybestconsultant/ao-idle/`
   (ou un `git clone` / `git pull` du dépôt).
2. Sur le serveur, dans ce dossier : `cp .env.example .env && chmod 600 .env`, puis renseigner le mot de passe
   IMAP et le `CRON_SECRET` de production.
3. `docker compose up -d --build`
4. `docker compose logs -f` : on doit voir `connecté à imap.ionos.fr, dossier INBOX : en attente de nouveaux
   messages`, puis `✓ aucun nouvel e-mail` (ou le compte rendu du rattrapage).
5. Essai : envoyer un e-mail à `ao@wise-associates.fr`. En quelques secondes : `nouveau message (n → n+1)` puis
   `✓ 1 e-mail(s) : …`, et l'offre apparaît sur `/admin/ao-offers`.

Le conteneur redémarre seul après une erreur ou un redémarrage du serveur (`restart: unless-stopped`). Il
tourne sans droit root, en système de fichiers en lecture seule, sans port ouvert ; ses journaux sont limités
à 3 fichiers de 10 Mo.

Visez la production : une preview Vercel est en général protégée par l'authentification Vercel, que le
veilleur ne franchit pas (401 ou redirection dans le journal). Pour une preview, utilisez le bouton
« Synchroniser maintenant » de `/admin/ao-offers`.

## Exploitation

| Besoin | Commande (dans le dossier du veilleur sur le serveur) |
|---|---|
| État | `docker compose ps` |
| Journal | `docker compose logs --tail 100 ao-idle` (`-f` pour suivre) |
| Arrêt / reprise | `docker compose stop` / `docker compose start` |
| Changement du `.env` | `docker compose up -d --force-recreate` (un simple `restart` ne relit pas le `.env`) |
| Mise à jour du code | recopier le dossier, puis `docker compose up -d --build` |
| Version de Node | ligne `FROM` du `Dockerfile` (un tag `node:<version>-alpine<version>` existant), puis `--build` |
| Tests | `npm test` à la racine du projet (inclut `worker.test.mjs`) |

## Dépannage

| Journal | Cause probable | À faire |
|---|---|---|
| `✗ AO_IMAP_USER et AO_IMAP_PASSWORD sont obligatoires.` (ou une autre variable), le conteneur redémarre en boucle | `.env` absent ou incomplet | compléter le `.env`, puis `docker compose up -d --force-recreate` |
| `connexion IMAP impossible : Authentication failed` | mot de passe IMAP refusé | corriger `AO_IMAP_PASSWORD` (le même que sur Vercel) |
| `401 : accès refusé (…)` | secret différent de celui de Vercel, ou `AO_SYNC_URL` vise une preview protégée | recopier le `CRON_SECRET` de l'environnement Vercel visé ; viser la production |
| `redirection 308 vers https://www…` | `AO_SYNC_URL` n'est pas l'adresse finale | mettre l'adresse indiquée dans `AO_SYNC_URL` |
| `HTTP 500 : …` | erreur côté site (Appwrite injoignable, collections absentes…) | lire le détail, puis les logs Vercel de `/api/cron/ao-inbox` |
| `site injoignable (…) : … (ETIMEDOUT)` | réseau ou DNS du serveur | `curl -I https://www.mybestconsultant.fr` depuis le serveur |
| `boîte AO non configurée sur le site` | `AO_IMAP_USER` / `AO_IMAP_PASSWORD` absents des variables Vercel | les ajouter sur Vercel, puis redéployer |
| `… en erreur (voir /admin/ao-offers)` | un e-mail n'a pas pu être traité | la raison est sur `/admin/ao-offers` (réessayé 3 fois) |
| Des e-mails arrivent mais aucun `nouveau message` | notifications IDLE perdues | le contrôle de secours les traite en 15 min au plus ; vérifier `docker compose ps` et le journal de connexion |
