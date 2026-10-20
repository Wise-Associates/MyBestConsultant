# Veilleur temps réel de la boîte AO (voir README.md). Construit depuis ce dossier : docker compose up -d --build.
# Version de Node figée : la mettre à jour ici (tag node:<version>-alpine<version> existant sur Docker Hub), puis reconstruire.
FROM node:24.21.0-alpine3.24

ENV NODE_ENV=production
WORKDIR /app

# Dépendances figées par package-lock.json (npm ci échoue s'il ne correspond pas à package.json).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY index.mjs config.mjs sync-client.mjs trigger.mjs ./

# Utilisateur sans privilège fourni par l'image node.
USER node
CMD ["node", "index.mjs"]
