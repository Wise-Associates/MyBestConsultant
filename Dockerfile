# Image de production de MyBestConsultant (Next.js en mode standalone, ADR 0027).
# Construite par .github/workflows/deploy-vps.yml, lancée sur le VPS par deploy/mbc-deploy.sh.
# Guide complet : docs/deploiement-vps.md.
#
# Construction à la main (valeurs publiques de la production, les mêmes que dans app.env du serveur) :
#   docker build -t mybestconsultant:essai \
#     --build-arg NEXT_PUBLIC_APP_URL=... --build-arg NEXT_PUBLIC_APPWRITE_ENDPOINT=... \
#     --build-arg NEXT_PUBLIC_APPWRITE_PROJECT_ID=... --build-arg NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=... .

# Node 24 (LTS), comme la vérification du code en CI. Version et empreinte exactes (une étiquette peut être
# republiée) : les monter ensemble ici seulement (docker buildx imagetools inspect node:<version> donne l'empreinte).
ARG NODE_IMAGE=node:24.22.1-trixie-slim@sha256:89c5244bc22a9bc3287d89ebc7e49b9cb5bb84cd40e6175ac3421d5a9f68b95a

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Dépendances d'abord : cette couche est réutilisée tant que package-lock.json ne change pas.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
# Les variables NEXT_PUBLIC_* sont écrites dans le code au moment du build (navigateur et serveur) : une image
# ne vaut que pour un environnement. Aucun secret ici : seules ces valeurs publiques entrent dans l'image.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_APPWRITE_ENDPOINT
ARG NEXT_PUBLIC_APPWRITE_PROJECT_ID
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
RUN : "${NEXT_PUBLIC_APP_URL:?build-arg manquant}" \
      "${NEXT_PUBLIC_APPWRITE_ENDPOINT:?build-arg manquant}" \
      "${NEXT_PUBLIC_APPWRITE_PROJECT_ID:?build-arg manquant}" \
      "${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:?build-arg manquant}"
COPY . .
RUN npm run build && node scripts/check-prerendered.mjs

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Fichiers de l'application à root, processus sous l'utilisateur node : le code ne peut pas se modifier lui-même
# (le conteneur tourne en plus en lecture seule, deploy/compose.app.yml).
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
# Un fichier de public/ servi par le serveur Node : prouve qu'il écoute, sans dépendre d'Appwrite (une panne
# d'Appwrite ne doit pas faire échouer un déploiement ni redémarrer le conteneur).
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/logo.png').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]
