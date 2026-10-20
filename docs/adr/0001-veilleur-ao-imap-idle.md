# 0001 — Lecture de la boîte AO à l'arrivée des e-mails : veilleur IMAP IDLE sur le serveur Hetzner

- Statut : accepté
- Date : 2026-10-20

## Contexte

Les appels d'offres arrivent par e-mail sur `ao@wise-associates.fr` (IONOS). Le site les lit avec
`GET /api/cron/ao-inbox` (`src/lib/ao/sync.ts`) : lecture incrémentale depuis un point de reprise, verrou en
base (une seule synchronisation à la fois), rattrapage quotidien sur 7 jours.

Cet endpoint n'était appelé que par Vercel Cron, limité à **une exécution par jour** sur le plan Hobby, par le
bouton « Synchroniser maintenant » et, en local, par `npm run ao:poll`. Une offre pouvait donc attendre
jusqu'à 24 h avant d'apparaître. L'objectif est qu'elle soit traitée dans la minute, comme une messagerie
qui affiche un e-mail dès sa réception.

Le serveur IMAP d'IONOS gère la commande IDLE (notification immédiate d'un nouveau message), pas NOTIFY.
Les sites hébergés sur Vercel ne peuvent pas garder une connexion ouverte : les fonctions durent 300 s au
plus. L'entreprise dispose d'un serveur Hetzner qui fait déjà tourner Appwrite.

## Décision

Un petit processus Node, le « veilleur » (`workers/ao-idle/`), tourne en continu dans un conteneur Docker sur
le serveur Hetzner. Il garde une connexion IMAP ouverte en lecture seule en IDLE et, à chaque nouveau message,
appelle `GET /api/cron/ao-inbox` avec `CRON_SECRET`, exactement comme Vercel Cron.

- Le veilleur ne lit ni ne traite aucun e-mail : toute la logique reste dans le site, à un seul endroit.
- Il regroupe les rafales (5 s), n'a jamais plus d'un appel en cours, réessaie quand le site répond `skipped`
  ou `remaining > 0`, espace ses essais en cas d'erreur, et se reconnecte en cas de coupure IMAP.
- Il appelle aussi le site toutes les 15 min par sécurité (notification perdue, connexion à moitié coupée).
- Le Vercel Cron quotidien est conservé : il continue de fonctionner si le veilleur est arrêté.

## Options écartées

- **Vercel Cron toutes les 5 min** : impossible sur le plan Hobby ; le plan Pro coûte un abonnement pour un
  délai qui resterait de plusieurs minutes.
- **Planificateur externe toutes les 5 min** (cron du serveur, service en ligne) : simple, mais 288 appels
  par jour, presque tous inutiles, et jusqu'à 5 min de délai.
- **Traitement complet sur le serveur Hetzner** (le veilleur lit et analyse les e-mails lui-même) : aurait
  dupliqué ou déplacé `src/lib/ao/` (IA, Appwrite, dédoublonnage) dans un second déploiement à maintenir.
- **Notification « push » de la messagerie** (webhook, Microsoft Graph, Gmail Pub/Sub) : non proposée par
  IONOS pour une boîte IMAP.

## Conséquences

- Un processus de plus à exploiter sur le serveur Hetzner (Docker, `restart: unless-stopped`, journaux
  limités) ; mode d'emploi dans `workers/ao-idle/README.md`.
- Le serveur Hetzner détient le mot de passe de la boîte et le `CRON_SECRET` de production, dans un fichier
  `.env` (`chmod 600`) hors de git et hors de l'image. Le conteneur tourne sans root, en lecture seule, sans
  port ouvert.
- Changer `CRON_SECRET` ou le mot de passe IMAP implique de mettre à jour Vercel **et** le serveur.
- Le veilleur dépend de l'adresse finale du site : `https://www.mybestconsultant.fr`. Une redirection est
  refusée, pour ne pas envoyer le secret ailleurs.
- Le volume d'appels reste faible : un par message (ou par rafale), plus 96 contrôles de secours par jour,
  chacun ne lisant que le courrier nouveau.
