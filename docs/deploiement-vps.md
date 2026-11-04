# Production de MyBestConsultant sur un VPS

Guide d'installation et d'exploitation, de la commande du serveur à la vie courante. Décision et raisons :
[ADR 0027](adr/0027-production-sur-vps.md).

Ce guide s'adresse à la personne qui installe et administre le serveur. Les commandes sont à lancer telles quelles ;
les valeurs entre `<…>` sont à remplacer. Comptez une demi-journée pour l'installation, puis une heure pour la bascule.

## Sommaire

1. [Vue d'ensemble](#1-vue-densemble)
2. [Le serveur](#2-le-serveur)
3. [Préparer le serveur](#3-préparer-le-serveur-une-fois)
4. [Configurer GitHub](#4-configurer-github-une-fois)
5. [Premier déploiement](#5-premier-déploiement-avant-le-dns)
6. [Bascule du DNS](#6-bascule-du-dns)
7. [Quitter Vercel pour la production](#7-quitter-vercel-pour-la-production)
8. [Travail au quotidien](#8-travail-au-quotidien)
9. [Exploitation](#9-exploitation)
10. [Dépannage](#10-dépannage)

## 1. Vue d'ensemble

```
Internet ──► Caddy (ports 80 et 443, HTTPS) ──► mbc-app-blue  ou  mbc-app-green (Next.js, port 3000 interne)
                                                       │
                                                       ├─► Appwrite de production (autre serveur, inchangé)
                                                       └─► IA, Stripe, Make, boîtes IMAP des organisations
```

- **Une seule version en ligne**, « bleue » ou « verte ». Un déploiement démarre l'autre couleur, attend qu'elle
  réponde, fait passer Caddy dessus, puis arrête l'ancienne quand ses requêtes et ses tâches de fond sont finies.
  Le site ne s'interrompt pas.
- **Rien n'est construit sur le serveur.** GitHub Actions vérifie le code (types, tests), construit l'image Docker et
  l'envoie au serveur par SSH.
- **Le serveur ne garde aucune donnée** : tout est dans Appwrite. Il ne contient que des fichiers reproductibles depuis
  le dépôt, et les secrets (`app.env`).
- **Ce qui ne change pas** : les previews Vercel de `pre-dev` / `dev` (projet Appwrite DEV), le serveur Appwrite, la
  mise en production par une pull request `dev` → `prod` fusionnée par un humain.

| Dans le dépôt | Rôle |
|---|---|
| `Dockerfile`, `.dockerignore` | Image de l'application (Next.js en mode `standalone`) |
| `deploy/compose.app.yml` | Conteneur de l'application (une couleur), durci : lecture seule, sans privilège, sans port publié |
| `deploy/compose.proxy.yml`, `deploy/caddy/Caddyfile` | Caddy : HTTPS, redirection du domaine nu, en-têtes, limites |
| `deploy/mbc-deploy.sh` | Déploiement sans coupure, retour arrière, état |
| `deploy/crontab`, `deploy/mbc-cron.sh` | Tâches planifiées (remplacent les `crons` de `vercel.json`) |
| `.github/workflows/deploy-vps.yml` | Vérification, image, envoi et bascule à chaque mise à jour de `prod` |

| Sur le serveur | Contenu |
|---|---|
| `/etc/mybestconsultant/app.env` | Secrets et réglages de production (root, lisible par `deploy`) |
| `/opt/mybestconsultant/repo` | Copie du dépôt (lecture seule), placée sur le commit déployé |
| `/opt/mybestconsultant/state` | Couleur et commit en ligne, cible de Caddy |
| `/usr/local/bin/mbc-deploy` | Copie installée de `deploy/mbc-deploy.sh` |

Le `docker-compose.yml` à la racine du dépôt est un ancien Appwrite local de développement : il ne sert pas ici.

## 2. Le serveur

- **Système** : Ubuntu Server 24.04 LTS.
- **Taille** : 2 vCPU, 4 Go de mémoire au moins (8 Go plus confortables), 40 Go de disque. Pendant une bascule, deux
  versions tournent ensemble ; chacune est limitée à 2 Go (`deploy/compose.app.yml`).
- **Lieu** : dans l'Union européenne (données personnelles : CV, candidatures), de préférence chez le même hébergeur
  et dans la même région que le serveur Appwrite : chaque page fait plusieurs appels à Appwrite.
- **Réseau** : une adresse IPv4 fixe (et IPv6 si possible). Sortie vers Internet ouverte : ports 443 (Appwrite, IA,
  Stripe, Make, GitHub, Docker Hub) et 993 (boîtes IMAP des organisations).
- **Accès** : votre clé SSH personnelle déposée à la création du serveur.

## 3. Préparer le serveur (une fois)

Toutes les commandes de cette partie se lancent sur le serveur.

### 3.1 Compte d'administration et SSH

Connecté en `root` (première connexion) :

```bash
adduser <votre-prenom>                      # mot de passe : celui de sudo
usermod -aG sudo <votre-prenom>
install -d -m 700 -o <votre-prenom> -g <votre-prenom> /home/<votre-prenom>/.ssh
cp /root/.ssh/authorized_keys /home/<votre-prenom>/.ssh/
chown <votre-prenom>: /home/<votre-prenom>/.ssh/authorized_keys
```

Dans un **second terminal**, vérifiez `ssh <votre-prenom>@<ip>` puis `sudo -v`. Seulement ensuite, coupez la
connexion de `root` et les mots de passe :

```bash
# « 00- » : sshd garde la première valeur lue, et certains hébergeurs livrent 50-cloud-init.conf avec
# PasswordAuthentication yes ; un fichier lu après lui serait sans effet.
sudo tee /etc/ssh/sshd_config.d/00-mybestconsultant.conf > /dev/null <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
sudo sshd -t && sudo systemctl reload ssh
sudo sshd -T | grep -E '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication) '
# attendu : les trois lignes à « no »
```

Gardez le premier terminal ouvert jusqu'à ce qu'une nouvelle connexion réussisse.

### 3.2 Système

```bash
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get install -y unattended-upgrades git curl cron
sudo dpkg-reconfigure -plow unattended-upgrades      # répondre Oui : correctifs de sécurité automatiques
sudo timedatectl set-timezone UTC                    # les heures de deploy/crontab sont en UTC
# Mémoire d'appoint : deux versions de l'application tournent pendant une bascule.
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 3.3 Pare-feu

```bash
sudo ufw limit OpenSSH                       # SSH ouvert, mais tentatives répétées ralenties
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
```

Attention : les ports publiés par Docker contournent `ufw`. Seul Caddy publie des ports (80 et 443) ; n'ajoutez jamais
de `ports:` à `deploy/compose.app.yml`.

### 3.4 Docker

Installation depuis le dépôt officiel de Docker (référence : <https://docs.docker.com/engine/install/ubuntu/>) :

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
# Les conteneurs continuent de tourner pendant une mise à jour de Docker.
echo '{ "live-restore": true }' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
docker compose version                       # v2.24 ou plus récent
```

### 3.5 Utilisateur `deploy` et dossiers

`deploy` lance les conteneurs et les tâches planifiées. Il est dans le groupe `docker`, ce qui revient à être
administrateur du serveur : personne ne s'y connecte avec un mot de passe, et sa seule clé SSH ne peut lancer que
`mbc-deploy` (3.8).

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo install -d -o deploy -g deploy -m 750 /opt/mybestconsultant
# 755 : Caddy, sans privilège dans son conteneur, doit pouvoir y lire la version active (rien de secret).
sudo install -d -o deploy -g deploy -m 755 /opt/mybestconsultant/state
sudo install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
sudo install -d -o root -g deploy -m 750 /etc/mybestconsultant
```

### 3.6 Copie du dépôt

Le serveur lit le dépôt avec sa propre clé, en lecture seule :

```bash
sudo -u deploy ssh-keygen -t ed25519 -N "" -C "vps-mybestconsultant (lecture du depot)" -f /home/deploy/.ssh/github_repo
sudo -u deploy tee /home/deploy/.ssh/config > /dev/null <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github_repo
  IdentitiesOnly yes
EOF
sudo cat /home/deploy/.ssh/github_repo.pub
```

Sur GitHub : dépôt `Wise-Associates/MyBestConsultant` → Settings → Deploy keys → Add deploy key, collez la clé
publique, **sans** cocher « Allow write access ». Puis :

```bash
sudo -u deploy ssh -T git@github.com
# Vérifiez l'empreinte affichée avec celles publiées par GitHub
# (https://docs.github.com/fr/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints),
# répondez yes. Réponse attendue : « You've successfully authenticated ».
sudo -u deploy git clone git@github.com:Wise-Associates/MyBestConsultant.git /opt/mybestconsultant/repo
sudo -u deploy git -C /opt/mybestconsultant/repo checkout --quiet --detach origin/prod
```

Le dossier `deploy/` doit exister sur `prod` (ce guide y arrive avec lui). Ne modifiez jamais de fichier dans cette
copie : chaque déploiement la place sur le commit déployé, et une modification locale le ferait échouer.

### 3.7 Script de déploiement

```bash
sudo install -m 755 /opt/mybestconsultant/repo/deploy/mbc-deploy.sh /usr/local/bin/mbc-deploy
sudo -u deploy mbc-deploy status            # attendu : « aucune version déployée »
```

### 3.8 Clé SSH de GitHub Actions

Sur **votre poste** (pas sur le serveur), dans un dossier temporaire :

```bash
ssh-keygen -t ed25519 -N "" -C "github-actions deploiement mybestconsultant" -f mbc-deploy-key
cat mbc-deploy-key.pub
```

Sur le serveur, autorisez cette clé **pour la seule commande `mbc-deploy`** (une ligne, clé publique collée après
le dernier espace) :

```bash
sudo -u deploy tee /home/deploy/.ssh/authorized_keys > /dev/null <<'EOF'
restrict,command="/usr/local/bin/mbc-deploy" ssh-ed25519 AAAA...collez-la-cle... github-actions deploiement mybestconsultant
EOF
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

Depuis votre poste, vérifiez : `ssh -i mbc-deploy-key deploy@<ip> status` affiche « aucune version déployée », et
`ssh -i mbc-deploy-key deploy@<ip> ls` est refusé (usage). La clé privée `mbc-deploy-key` ira dans GitHub (4.2) :
effacez ensuite les deux fichiers de votre poste. Perdue ou exposée : générez-en une autre et remplacez les deux côtés.

**Cette clé vaut un accès à la production.** Elle ne lance que `mbc-deploy`, mais elle peut lui envoyer n'importe
quelle image, qui démarrerait avec les secrets de `app.env` : le serveur ne peut pas vérifier qu'une image vient bien
du workflow. Elle n'est donc donnée qu'au job de déploiement, sur la branche `prod` (4.1), et ne doit exister nulle part
ailleurs.

Empreinte du serveur pour GitHub, à relever depuis votre poste, **avec l'adresse IP** que vous mettrez dans
`VPS_HOST` (4.2) :

```bash
ssh-keyscan -t ed25519 <ip> 2>/dev/null > mbc-known-hosts
ssh-keygen -lf mbc-known-hosts                         # à comparer avec la ligne suivante, lancée sur le serveur :
# sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

### 3.9 Secrets de production : `app.env`

```bash
sudo install -o root -g deploy -m 640 /dev/null /etc/mybestconsultant/app.env
sudoedit /etc/mybestconsultant/app.env
```

Contenu : **toutes les variables de la portée Production de Vercel** (Settings → Environment Variables), avec les
mêmes valeurs ; leur liste et leur rôle sont dans `.env.example`. Les variables marquées « Sensitive » sur Vercel ne se
relisent pas : reprenez-les à leur source (gestionnaire de mots de passe de l'équipe, console du fournisseur).

Format : une variable par ligne, **chaque valeur entre apostrophes**, `NOM='valeur'`, sans `export`, sur une seule
ligne (un JSON reste sur une ligne). Sans apostrophes, Docker modifie la valeur sans rien dire : tout ce qui suit un
`$` disparaît (`abc$def` devient `abc`), comme un ` #` et ce qui le suit. Une valeur qui contient elle-même une
apostrophe ne passe pas : régénérez ce secret. Points à vérifier :

- `NEXT_PUBLIC_APP_URL=https://www.mybestconsultant.fr`, et les autres `NEXT_PUBLIC_*` : **identiques** aux variables
  de l'environnement GitHub (4.2), qui sont celles écrites dans l'image.
- `CRON_SECRET` : 16 caractères au moins, lu aussi par les tâches planifiées.
- `AO_CREDENTIALS_KEY` : la même que sur Vercel, sinon les mots de passe des boîtes AO enregistrés sont illisibles.

Ne copiez pas ce fichier ailleurs que sur le serveur et dans le gestionnaire de mots de passe de l'équipe.

## 4. Configurer GitHub (une fois)

Dépôt `Wise-Associates/MyBestConsultant` → Settings.

### 4.1 Environnement `production`

Environments → New environment → `production` :

- **Deployment branches and tags** → Selected branches and tags → ajoutez `prod`. Les secrets ci-dessous ne sont
  donnés qu'aux workflows lancés sur `prod`.
- **Required reviewers** (fortement conseillé), avec **Prevent self-review** : une seconde personne valide chaque
  déploiement dans l'onglet Actions. Sans cela, toute personne qui peut écrire dans le dépôt peut lancer un
  déploiement ou un retour arrière seule.

### 4.1 bis Protection de la branche `prod`

Settings → Rules → Rulesets → New branch ruleset, cible `prod`, actif, sans contournement : **Require a pull request
before merging** (avec au moins une approbation), **Block force pushes**, **Restrict deletions**. La restriction de
l'environnement à `prod` (4.1) ne vaut que ce que vaut la protection de `prod`.

### 4.2 Secrets et variables

Dans l'environnement `production` :

| Type | Nom | Valeur |
|---|---|---|
| Secret | `VPS_SSH_KEY` | Contenu de `mbc-deploy-key` (clé privée, 3.8) |
| Secret | `VPS_SSH_KNOWN_HOSTS` | Contenu de `mbc-known-hosts` (3.8) |
| Variable | `NEXT_PUBLIC_APP_URL` | `https://www.mybestconsultant.fr` |
| Variable | `NEXT_PUBLIC_APPWRITE_ENDPOINT` | `https://appwrite.mybestconsultant.fr/v1` |
| Variable | `NEXT_PUBLIC_APPWRITE_PROJECT_ID` | Identifiant du projet Appwrite de production (comme sur Vercel) |
| Variable | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Clé publique Stripe de production (`pk_live_…`, comme sur Vercel) |

Puis, dans Secrets and variables → Actions → onglet Variables → **Repository variables** :

| Nom | Valeur |
|---|---|
| `VPS_HOST` | Adresse IP du serveur, celle utilisée pour `ssh-keyscan` (3.8) |

Tant que `VPS_HOST` n'existe pas, le workflow ne fait rien : c'est l'interrupteur du déploiement sur le VPS.

## 5. Premier déploiement (avant le DNS)

Le DNS pointe encore vers Vercel : les visiteurs n'arrivent pas sur le serveur, vous pouvez tester sans risque.

1. GitHub → Actions → **Déploiement production (VPS)** → Run workflow → branche `prod`, champ vide → Run.
   Comptez une dizaine de minutes : dépendances, types, tests, image, envoi, démarrage.
2. Sur le serveur :

   ```bash
   sudo -u deploy mbc-deploy status
   # attendu : en ligne : version blue ; mbc-app-blue et mbc-caddy « (healthy) »
   sudo docker exec mbc-caddy wget -qSO /dev/null http://mbc-app-blue:3000/ 2>&1 | head -1
   # attendu : HTTP/1.1 200 OK — la page d'accueil, qui lit Appwrite : les secrets et le réseau sont bons
   sudo docker logs --tail 50 mbc-app-blue
   ```

3. Normal tant que le DNS pointe ailleurs :
   - les journaux de Caddy (`sudo docker logs mbc-caddy`) signalent des certificats impossibles à obtenir ; Caddy
     réessaie seul ;
   - les tâches planifiées du serveur échouent (`sudo journalctl -t mbc-cron` : « appel impossible ») : elles
     n'appellent que ce serveur, qui n'a pas encore de certificat, et Vercel Cron les fait encore.

En cas d'échec, le journal du workflow (job « deploy », étape « Envoi au serveur et bascule ») montre la raison,
gardée aussi sur le serveur (`/opt/mybestconsultant/state/dernier-deploiement.log`) : voir
[Dépannage](#10-dépannage).

## 6. Bascule du DNS

### La veille

- Baissez à 300 s la durée de vie (TTL) des enregistrements de `mybestconsultant.fr` et `www.mybestconsultant.fr`.
- Vérifiez que l'enregistrement CAA du domaine autorise Let's Encrypt : `dig +short CAA mybestconsultant.fr` doit
  contenir `letsencrypt.org` (c'est le cas au 2026-11-04).
- Prévenez l'équipe : pas de mise en production pendant la bascule.

### Le jour même

1. Chez le gestionnaire du DNS :
   - `mybestconsultant.fr` : remplacez l'enregistrement A de Vercel par `A <ipv4 du serveur>` (et `AAAA <ipv6>`).
   - `www.mybestconsultant.fr` : supprimez le CNAME vers Vercel, ajoutez `A <ipv4>` (et `AAAA <ipv6>`).
2. Suivez Caddy : `sudo docker logs -f mbc-caddy`, jusqu'à « certificate obtained successfully » pour les deux noms
   (quelques minutes après la propagation).
3. Désactivez tout de suite **Vercel Cron** (Vercel → projet → Settings → Cron Jobs → Disable), pour que les tâches
   ne tournent plus que sur le serveur.
4. Vérifiez, dans un navigateur et en ligne de commande :
   - `curl -sI https://mybestconsultant.fr | head -3` : redirection 301 vers `https://www.mybestconsultant.fr/` ;
   - `curl -sI https://www.mybestconsultant.fr | grep -i -E "^(server|strict-transport)"` : `server: Caddy`, HSTS ;
   - connexion candidat, recruteur et admin, puis une action qui enregistre (un profil, une offre de test) ;
   - un CV déposé, un logo d'entreprise, un entretien IA enregistré ;
   - `/admin/candidats` → « Synchroniser maintenant » (routes longues) ;
   - un « CV format cabinet » (2 à 3 min) ;
   - `https://www.mybestconsultant.fr/api/social/poster/exemple.png` (affiche, polices) ;
   - Stripe → Developers → Webhooks → le point d'arrivée `/api/stripe/webhook` → Send test event : réponse 2xx ;
   - une tâche planifiée sans effet de bord :
     `sudo -u deploy /bin/bash /opt/mybestconsultant/repo/deploy/mbc-cron.sh deactivate-expired-jobs`, puis
     `sudo journalctl -t mbc-cron -n 5` : `HTTP 200`.

### Retour arrière pendant la bascule

Vercel garde la production pendant 7 jours (étape 7) : remettez les anciens enregistrements DNS et réactivez Vercel
Cron. Valeurs relevées le 2026-11-04 (à revérifier dans Vercel → Settings → Domains avant la bascule) : A
`216.198.79.1` pour `mybestconsultant.fr`, CNAME `da0cfd5abc43f0bc.vercel-dns-017.com.` pour `www`.

## 7. Quitter Vercel pour la production

Après 7 jours sans problème :

1. Vercel → projet → Settings → Domains : retirez `mybestconsultant.fr` et `www.mybestconsultant.fr`.
2. Vercel → Settings → Environment Variables : supprimez les variables de portée **Production** seulement (gardez
   Preview : les previews en dépendent).
3. **L'ancienne production reste en ligne** sur l'adresse `…vercel.app` du projet, avec les secrets qu'elle avait au
   déploiement (retirer une variable ne touche que les déploiements suivants) et un code qui ne recevra plus de
   correctifs. Vercel → Deployments : supprimez les déploiements de production. Vérifiez :
   `curl -sI https://<projet>.vercel.app | head -1` doit répondre 401 ou 404.
4. Changez les secrets que Vercel a détenus et qui peuvent l'être : clé d'API Appwrite, clé secrète Stripe et
   `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`, `SOCIAL_WEBHOOK_SECRET` (à changer aussi dans le scénario Make), clés d'IA.
   Nouvelles valeurs dans `app.env`, puis redéploiement (partie 8). Pas `AO_CREDENTIALS_KEY` : la changer rend
   illisibles les mots de passe des boîtes AO.
5. Pull request `dev` → `prod` qui remplace `vercel.json` par ce qui suit (plus de `crons`, plus de build de
   production sur Vercel ; les previews continuent) :

   ```json
   {
     "git": {
       "deploymentEnabled": {
         "prod": false
       }
     }
   }
   ```

6. Dans `AGENTS.md`, remplacez les mentions de Vercel Cron par la crontab du VPS (`deploy/crontab`).

## 8. Travail au quotidien

| Je veux… | Je fais… |
|---|---|
| Développer, tester | Comme avant : branche, `pre-dev` / `dev`, preview Vercel sur le projet Appwrite DEV |
| Mettre en production | Pull request `dev` → `prod`, fusionnée par un humain. Le workflow déploie ; suivez-le dans Actions |
| Changer la structure Appwrite | Comme avant (`schema:check -- prod`, `schema:push -- prod` par un humain), **avant** la pull request |
| Ajouter une variable d'environnement | L'ajouter dans `app.env` sur le serveur **avant** la mise en production du code qui la lit. Pour une `NEXT_PUBLIC_*` : aussi dans les variables de l'environnement GitHub `production` |
| Changer un secret sans nouveau code | Modifier `app.env`, puis `sudo -u deploy mbc-deploy rollback <commit en ligne>` (relance la même image avec le nouveau fichier, sans coupure) ou Run workflow avec le champ vide |
| Revenir à la version précédente | `sudo -u deploy mbc-deploy status` (images présentes), puis `sudo -u deploy mbc-deploy rollback <commit>`. Plus ancien que les 5 dernières : Actions → Run workflow → un commit déjà mis en production (les autres sont refusés) |
| Changer le Caddyfile, les tâches planifiées, le conteneur de l'application | Modifier `deploy/…` dans une pull request : appliqué au déploiement suivant |
| Changer `deploy/compose.proxy.yml` (version de Caddy…) | Pull request, puis après le déploiement (qui affiche « ATTENTION : deploy/compose.proxy.yml a changé ») : `sudo -u deploy mbc-deploy proxy`, hors des heures de travail (coupure de quelques secondes) |

Un retour arrière ne défait pas une modification de structure Appwrite : le code ancien doit la supporter.

## 9. Exploitation

### Commandes utiles

```bash
sudo -u deploy mbc-deploy status                                  # version en ligne, conteneurs, images
sudo cat /opt/mybestconsultant/state/dernier-deploiement.log      # journal du dernier déploiement
sudo docker logs --since 1h mbc-app-$(sudo cat /opt/mybestconsultant/state/active-color)   # journaux de l'application
sudo docker logs --since 1h mbc-caddy                             # certificats, erreurs du proxy
sudo journalctl -t mbc-cron --since yesterday                     # tâches planifiées
sudo docker stats --no-stream                                     # mémoire et processeur
df -h / && sudo docker system df                                  # disque
```

Votre compte d'administration n'est pas dans le groupe `docker` (qui donne les droits de `root`) : `sudo` à chaque
commande Docker, c'est voulu.

Les journaux de chaque conteneur sont limités à 100 Mo (5 fichiers de 20 Mo). Caddy n'écrit pas de journal d'accès
(adresses IP des visiteurs) : l'activer seulement pour un diagnostic, puis le retirer.

### Redémarrage du serveur

Les conteneurs repartent seuls (`restart: unless-stopped`). Coupure de quelques dizaines de secondes : redémarrez hors
des heures de travail quand `/var/run/reboot-required` existe (correctifs du noyau).

### Mises à jour

- **Système** : correctifs de sécurité automatiques (3.2). Une fois par mois : `sudo apt-get update && sudo apt-get
  upgrade` (Docker compris ; les conteneurs continuent grâce à `live-restore`).
- **Node.js** : version et empreinte exactes dans `Dockerfile` (`NODE_IMAGE`), à monter ensemble par une pull
  request ; l'empreinte d'une version : `docker buildx imagetools inspect node:<version>-trixie-slim` (ligne Digest).
- **Caddy** : même chose dans `deploy/compose.proxy.yml`, puis `sudo -u deploy mbc-deploy proxy` (partie 8).
- **Mettre à jour mbc-deploy** : quand `deploy/mbc-deploy.sh` change, le journal du déploiement affiche
  « ATTENTION : deploy/mbc-deploy.sh diffère de la copie installée ». Après ce déploiement :
  `sudo install -m 755 /opt/mybestconsultant/repo/deploy/mbc-deploy.sh /usr/local/bin/mbc-deploy`.

### Surveillance

Vercel signalait les pannes ; plus personne ne le fait. Mettez en place une sonde externe (UptimeRobot, Better Stack…)
sur `https://www.mybestconsultant.fr/logo.png` toutes les minutes, avec alerte par e-mail à l'équipe.

### Sauvegarde

Rien à sauvegarder sur le serveur hormis `app.env` (gestionnaire de mots de passe de l'équipe). Serveur perdu : un
nouveau serveur, ce guide (parties 3 et 4, `VPS_HOST` et `VPS_SSH_KNOWN_HOSTS` à changer), Run workflow, DNS.
Les sauvegardes d'Appwrite restent celles de son serveur.

### Ce qui protège la production

- HTTPS partout, HSTS, domaine nu redirigé ; seuls les ports 22, 80 et 443 ouverts ; SSH par clé, sans `root`.
- L'application et Caddy tournent sans privilège, sur un système de fichiers en lecture seule ; l'application n'a
  aucun port publié et ne peut pas prendre plus de 2 Go ; un envoi de plus de 12 Mo est refusé par Caddy.
- La clé SSH de GitHub Actions ne lance que `mbc-deploy`, mais elle vaut un accès à la production (3.8). Elle n'est
  donnée qu'au job « deploy », sur la branche `prod`, qui n'exécute aucun code du dépôt sur la machine de GitHub
  (le code et ses dépendances tournent dans le job « verify », sans secret, et dans le build Docker, isolé).
  L'empreinte du serveur est vérifiée. Protégez `prod` et l'environnement `production` (4.1, 4.1 bis).
- Le serveur ne lit le dépôt qu'en lecture seule ; aucun secret dans l'image ni dans le dépôt ; images de Node et de
  Caddy désignées par leur empreinte.

## 10. Dépannage

| Symptôme | Cause probable et solution |
|---|---|
| Workflow, étape Image : « Pages générées au build, sans les secrets de production » | Une page ou une route lit des données au build (le build n'a pas les secrets). Ajoutez `export const dynamic = 'force-dynamic'` aux pages citées (`scripts/check-prerendered.mjs`) |
| Workflow, job verify : « … n'a jamais été mis en production » | Un retour arrière ne vise qu'un commit déjà déployé : prenez-en un dans Actions (déploiements réussis) ou dans `mbc-deploy status` |
| Workflow : « la version … ne démarre pas » | Ses journaux sont affichés juste au-dessus. Souvent une variable absente ou fausse dans `app.env`. L'ancienne version reste en ligne |
| Workflow : « Caddy refuse la nouvelle configuration ou ne démarre pas » | Erreur dans `deploy/caddy/Caddyfile` du commit (message au-dessus). L'ancienne version reste en ligne ; corriger par une pull request |
| Caddy redémarre en boucle (`sudo docker ps` : « Restarting ») et `caddy adapt` signale « File to import not found: /mbc-state/upstream.caddy » | Le dossier `/opt/mybestconsultant/state` n'est pas lisible par tous (créé en 750) : `sudo chmod 755 /opt/mybestconsultant/state`. `mbc-deploy` le corrige seul depuis le 2026-11-04 (après réinstallation, partie 9) |
| Workflow : « flux inattendu » | L'image reçue ne porte pas le nom annoncé ou en contient d'autres. Ne vient pas du workflow : vérifiez qui détient la clé SSH (3.8), changez-la |
| Déploiement : « ATTENTION : deploy/compose.proxy.yml a changé » | Normal après une modification de ce fichier : `sudo -u deploy mbc-deploy proxy` hors des heures de travail |
| Déploiement : « ATTENTION : deploy/mbc-deploy.sh diffère de la copie installée » | Réinstallez-la (partie 9, Mises à jour) |
| Workflow : « lecture de GitHub impossible » | Clé de lecture du dépôt (3.6) retirée ou GitHub injoignable |
| Workflow : « un autre déploiement est en cours » | Un déploiement tourne encore (l'arrêt de l'ancienne version prend jusqu'à 5 min) ; relancer après |
| Workflow : `Host key verification failed` | `VPS_SSH_KNOWN_HOSTS` ne correspond pas au serveur (serveur réinstallé ?) : refaire 3.8 |
| Workflow : `Permission denied (publickey)` | `VPS_SSH_KEY` et `authorized_keys` ne correspondent pas (3.8) |
| Site en erreur 502 | Plus de version en ligne : `sudo -u deploy mbc-deploy status`, journaux de l'application, puis `sudo -u deploy mbc-deploy rollback <commit>` |
| Certificat refusé, site injoignable en HTTPS | DNS pas encore propagé (`dig +short www.mybestconsultant.fr`), ports 80/443 fermés chez l'hébergeur, CAA sans Let's Encrypt. `sudo docker logs mbc-caddy` |
| Tâche planifiée : « appel impossible » | Avant la bascule du DNS : normal (partie 5). Après : Caddy arrêté ou certificat absent (`sudo docker logs mbc-caddy`) |
| Tâche planifiée : `HTTP 401` | `CRON_SECRET` de `app.env` changé sans redéploiement, ou valeur sans apostrophes modifiée par Docker (3.9) |
| Tâche planifiée : `HTTP 502` sur `ao-inbox` | Aucune boîte AO lisible : bandeau et détail dans `/admin/candidats` |
| Erreurs « fetch failed » vers Appwrite | Réseau sortant du serveur, ou Appwrite arrêté : `sudo docker exec mbc-caddy wget -qSO /dev/null https://appwrite.mybestconsultant.fr/v1/health/version` |
| Erreur « Failed to find Server Action » juste après un déploiement | Un onglet ouvert sur l'ancienne version (identifiants des actions changés au build, comme sur Vercel) : recharger la page |
