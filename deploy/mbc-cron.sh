#!/usr/bin/env bash
# Tâches planifiées de MyBestConsultant sur le VPS (ADR 0027) : appelle une route /api/cron/* du site avec
# CRON_SECRET, comme le faisait Vercel Cron. Lancé par la crontab de l'utilisateur deploy (deploy/crontab).
#   mbc-cron.sh ao-inbox | deactivate-expired-jobs | assistant-purge
# Résultats dans le journal du système : journalctl -t mbc-cron
set -euo pipefail

ENV_FILE=${MBC_ENV_FILE:-/etc/mybestconsultant/app.env}
SITE_URL=${MBC_SITE_URL:-https://www.mybestconsultant.fr}
job=${1:-}

log() { logger --stderr --tag mbc-cron -- "$*"; }

case $job in
  ao-inbox | deactivate-expired-jobs | assistant-purge) ;;
  *)
    log "tâche inconnue « $job » (ao-inbox, deactivate-expired-jobs ou assistant-purge)"
    exit 2
    ;;
esac

if [[ ! -r $ENV_FILE ]]; then
  log "$job : $ENV_FILE illisible (utilisateur deploy ? droits du fichier ?)"
  exit 1
fi
# Même secret que l'application : la ligne CRON_SECRET= de app.env, apostrophes ou guillemets autour retirés
# (Docker les retire aussi).
secret=$(sed -n 's/^CRON_SECRET=//p' "$ENV_FILE" | tail -n 1)
if [[ $secret =~ ^\'(.*)\'$ || $secret =~ ^\"(.*)\"$ ]]; then secret=${BASH_REMATCH[1]}; fi
if [[ ${#secret} -lt 16 ]]; then
  log "$job : CRON_SECRET absent de $ENV_FILE ou de moins de 16 caractères"
  exit 1
fi

start=$SECONDS
# En-tête passé par l'entrée standard : le secret n'apparaît pas dans la liste des processus du serveur.
# 330 s : les routes s'arrêtent d'elles-mêmes avant (ao-inbox : budget de 240 s).
# --resolve : toujours le Caddy de ce serveur, jamais une autre production (Vercel avant la bascule du DNS : la tâche
# y tournerait deux fois). Avant la bascule, l'appel échoue faute de certificat : c'est attendu.
if ! status=$(printf 'Authorization: Bearer %s\n' "$secret" |
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 330 \
    --resolve www.mybestconsultant.fr:443:127.0.0.1 --header @- "$SITE_URL/api/cron/$job" 2>&1); then
  log "$job : appel impossible après $((SECONDS - start)) s : ${status//$'\n'/ }"
  exit 1
fi
if [[ $status != 2* ]]; then
  # Détail de l'erreur dans les journaux de l'application : docker logs mbc-app-<couleur>.
  log "$job : HTTP $status après $((SECONDS - start)) s"
  exit 1
fi
log "$job : HTTP $status en $((SECONDS - start)) s"
