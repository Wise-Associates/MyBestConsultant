#!/usr/bin/env bash
# Déploiement sans coupure de MyBestConsultant sur le VPS (ADR 0027, docs/deploiement-vps.md).
# Installé sur le serveur en /usr/local/bin/mbc-deploy ; tourne sous l'utilisateur deploy.
#
# Appelé par GitHub Actions par SSH, avec une clé limitée à cette commande :
#   docker save mybestconsultant:<commit> | gzip | ssh deploy@<vps> deploy <commit>
# À la main sur le serveur :
#   sudo -u deploy mbc-deploy status             version en ligne, conteneurs, images
#   sudo -u deploy mbc-deploy rollback <commit>  remet une version dont l'image est encore sur le serveur
#   sudo -u deploy mbc-deploy proxy              applique un changement de deploy/compose.proxy.yml (version de Caddy…)
#
# Déroulé : image chargée → fichiers deploy/ du même commit (git) → nouvelle couleur (bleue / verte) démarrée et en
# bonne santé → Caddy passe dessus → l'ancienne couleur finit ses requêtes et ses tâches, puis s'arrête.
# Une erreur avant le passage de Caddy laisse l'ancienne version en ligne, fichiers compris.
set -euo pipefail

ROOT=${MBC_ROOT:-/opt/mybestconsultant}
REPO=$ROOT/repo
STATE=$ROOT/state
LOG=$STATE/dernier-deploiement.log
NETWORK=mbc
# Images gardées sur le serveur pour un retour arrière sans GitHub.
KEEP_IMAGES=5
# Au moins stop_grace_period de compose.app.yml.
STOP_TIMEOUT=330

log() { printf '[mbc-deploy] %s\n' "$*" >&2; }
die() { log "ÉCHEC : $*"; exit 1; }

# `sudo -u deploy mbc-deploy …` garde le dossier courant de l'administrateur (son dossier personnel), où deploy n'a
# pas le droit d'entrer : docker compose échoue alors (« stat .: permission denied »). Toujours partir d'ici.
cd "$ROOT" || die "dossier $ROOT introuvable ou inaccessible pour $(id -un)"

app_compose() { # couleur commit arguments…
  APP_COLOR=$1 IMAGE_TAG=$2 docker compose -p "mbc-app-$1" -f "$REPO/deploy/compose.app.yml" "${@:3}"
}
proxy_compose() {
  docker compose -p mbc-proxy -f "$REPO/deploy/compose.proxy.yml" "$@"
}
reload_caddy() {
  docker exec mbc-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
}

show_status() {
  if [[ -f $STATE/active-color ]]; then
    log "en ligne : version $(<"$STATE/active-color"), commit $(<"$STATE/active-commit")"
  else
    log "aucune version déployée"
  fi
  docker ps --all --filter 'name=^mbc-' --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
  log "images présentes (retour arrière possible) :"
  docker image ls mybestconsultant --format '  {{.Tag}}  {{.CreatedSince}}'
  log "journal du dernier déploiement : $LOG"
}

# Par SSH, la commande demandée arrive dans SSH_ORIGINAL_COMMAND (clé limitée par command= dans authorized_keys).
read -r -a args <<< "${SSH_ORIGINAL_COMMAND:-$*}"
action=${args[0]:-}
commit=${args[1]:-}
case $action in
  status)
    show_status
    exit 0
    ;;
  proxy)
    [[ ${#args[@]} -eq 1 ]] || die "usage : proxy"
    ;;
  deploy | rollback)
    [[ ${#args[@]} -eq 2 && $commit =~ ^[0-9a-f]{40}$ ]] || die "usage : $action <commit complet de 40 caractères>"
    ;;
  *)
    die "usage : deploy <commit> | rollback <commit> | proxy | status"
    ;;
esac

mkdir -p "$STATE"
# Caddy lit upstream.caddy dans ce dossier en root, mais sans aucun privilège (cap_drop) : sans droit de lecture pour
# tous, il ne le voit pas (« File to import not found ») et redémarre en boucle. Rien de secret ici.
chmod 755 "$STATE"
exec 9> "$STATE/deploy.lock"
flock -n 9 || die "un autre déploiement est en cours"

# Si la connexion SSH tombe (workflow annulé, réseau), le déploiement va quand même au bout au lieu de s'arrêter au
# milieu de la bascule : signaux de fin de session ignorés, sortie recopiée dans $LOG par tee, qui continue
# d'écrire le fichier quand la connexion est fermée (-p).
trap '' HUP PIPE
exec > >(tee -p "$LOG" >&2) 2>&1

# Réseaux de Caddy (compose.proxy.yml), créés s'ils manquent (serveur neuf ou reconstruit), avant tout démarrage de
# Caddy, « proxy » compris : « mbc » pour l'application ; « wise-site », interne (ni Internet ni l'application), pour
# le site Wise Associates (dépôt TNP-Clone), dont le script de déploiement refuse un réseau non interne.
docker network inspect "$NETWORK" > /dev/null 2>&1 || docker network create "$NETWORK" > /dev/null
docker network inspect wise-site > /dev/null 2>&1 || docker network create --internal wise-site > /dev/null

if [[ $action == proxy ]]; then
  # Recréer Caddy coupe le site quelques secondes : jamais pendant un déploiement, seulement par cette commande.
  caddy_image=$(proxy_compose config --images)
  log "vérification du Caddyfile avec $caddy_image"
  docker run --rm -v "$REPO/deploy/caddy:/etc/caddy:ro" -v "$STATE:/mbc-state:ro" "$caddy_image" \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile || die "Caddyfile refusé ; Caddy n'est pas modifié"
  log "remplacement de Caddy selon deploy/compose.proxy.yml (coupure de quelques secondes)"
  proxy_compose up --detach --wait --wait-timeout 60 || die "Caddy ne démarre pas : docker logs mbc-caddy"
  log "terminé"
  exit 0
fi

# Le commit annoncé doit être dans prod (vérifié avant de lire l'image). Le contenu de l'image, lui, n'est pas
# vérifiable ici : la clé SSH de GitHub Actions vaut un accès à la production (ADR 0027).
git -C "$REPO" fetch --quiet origin prod || die "lecture de GitHub impossible (clé de déploiement du dépôt ?)"
git -C "$REPO" merge-base --is-ancestor "$commit" origin/prod || die "le commit $commit n'est pas dans la branche prod"

image=mybestconsultant:$commit
if [[ $action == deploy ]]; then
  log "chargement de l'image $image"
  loaded=$(gunzip | docker load)
  # Le flux ne doit contenir que l'image annoncée : une autre étiquette (une version gardée pour un retour arrière)
  # aurait été remplacée ; le déploiement s'arrête pour qu'on le voie. Caddy est désigné par son empreinte.
  [[ $loaded == "Loaded image: $image" ]] || die "flux inattendu, autre chose que l'image $image : ${loaded//$'\n'/ ; }"
fi
docker image inspect "$image" > /dev/null 2>&1 || die "image $image absente du serveur"

active=""
previous_commit=""
if [[ -f $STATE/active-color ]]; then
  active=$(<"$STATE/active-color")
  previous_commit=$(<"$STATE/active-commit")
fi
if [[ $active == blue ]]; then next=green; else next=blue; fi
if [[ -n $active ]]; then unchanged="la version précédente reste en ligne"; else unchanged="aucune version n'était en ligne"; fi

# Fichiers de déploiement (compose, Caddyfile, crontab) du commit déployé : la configuration suit le code.
log "fichiers de déploiement du commit $commit"
git -C "$REPO" checkout --quiet --detach "$commit"
if ! cmp -s "${BASH_SOURCE[0]}" "$REPO/deploy/mbc-deploy.sh"; then
  log "ATTENTION : deploy/mbc-deploy.sh diffère de la copie installée ; réinstallez-la (guide, « Mettre à jour mbc-deploy »)"
fi

restore_files() {
  if [[ -n $previous_commit ]]; then git -C "$REPO" checkout --quiet --detach "$previous_commit"; fi
}
remove_next() {
  app_compose "$next" "$commit" down || log "la version $next n'a pas pu être retirée : docker rm -f mbc-app-$next"
}

log "démarrage de la version $next"
if ! app_compose "$next" "$commit" up --detach --wait --wait-timeout 180; then
  log "journaux de la version $next :"
  docker logs --tail 80 "mbc-app-$next" || log "(journaux illisibles)"
  remove_next
  restore_files
  die "la version $next ne démarre pas ; $unchanged"
fi

switch_proxy() {
  local running
  running=$(docker container inspect --format '{{.State.Running}}' mbc-caddy 2> /dev/null || echo false)
  # --no-recreate : un Caddy recréé partirait sur la nouvelle couleur avant toute vérification (voir « proxy »).
  # Caddy absent ou arrêté (premier déploiement) : il lit la couleur en démarrant et doit répondre.
  proxy_compose up --detach --no-recreate --wait --wait-timeout 60 || return 1
  if [[ $running == true ]]; then reload_caddy || return 1; fi
}

log "passage de Caddy sur la version $next"
upstream_backup=""
if [[ -f $STATE/upstream.caddy ]]; then upstream_backup=$(<"$STATE/upstream.caddy"); fi
printf 'reverse_proxy mbc-app-%s:3000\n' "$next" > "$STATE/upstream.caddy.new"
mv "$STATE/upstream.caddy.new" "$STATE/upstream.caddy"
if ! switch_proxy; then
  # Caddy, jamais recréé ici, garde sa configuration précédente quand un rechargement échoue.
  if [[ -n $upstream_backup ]]; then printf '%s\n' "$upstream_backup" > "$STATE/upstream.caddy"; fi
  remove_next
  restore_files
  die "Caddy refuse la nouvelle configuration ou ne démarre pas (message ci-dessus) ; $unchanged"
fi

# Commit d'abord : un arrêt brutal entre les deux écritures laisse la couleur d'avant, que Caddy ne sert plus.
printf '%s\n' "$commit" > "$STATE/active-commit"
printf '%s\n' "$next" > "$STATE/active-color"
log "version $next en ligne (commit $commit)"
crontab "$REPO/deploy/crontab" || log "ATTENTION : tâches planifiées non installées (cron absent ?), voir le guide 3.2"

wanted_proxy=$(proxy_compose config --hash caddy)
running_proxy=$(docker container inspect --format '{{index .Config.Labels "com.docker.compose.config-hash"}}' mbc-caddy)
if [[ $wanted_proxy != "caddy $running_proxy" ]]; then
  log "ATTENTION : deploy/compose.proxy.yml a changé ; pour l'appliquer : sudo -u deploy mbc-deploy proxy"
fi

if [[ -n $active ]] && docker container inspect "mbc-app-$active" > /dev/null 2>&1; then
  log "arrêt de la version $active : requêtes et tâches en cours terminées d'abord (${STOP_TIMEOUT} s au plus)"
  docker stop --time "$STOP_TIMEOUT" "mbc-app-$active" > /dev/null
  docker rm "mbc-app-$active" > /dev/null
fi

# docker image ls liste les plus récentes d'abord.
docker image ls mybestconsultant --format '{{.Tag}}' | tail -n "+$((KEEP_IMAGES + 1))" | while read -r tag; do
  if [[ $tag != "$commit" ]]; then
    docker image rm "mybestconsultant:$tag" > /dev/null || log "image mybestconsultant:$tag non supprimée"
  fi
done
# Image remplacée par un nouveau build du même commit (redéploiement) : sans étiquette, sinon jamais supprimée.
docker image prune --force > /dev/null || log "images sans étiquette non supprimées"
log "terminé"
