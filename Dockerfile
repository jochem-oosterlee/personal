# Bouwstap: APP_BASE=/ omdat Cloud Run vanaf de root serveert, anders dan
# GitHub Pages dat onder /personal/ zit.
FROM node:22-alpine AS build
WORKDIR /app

# git rev-parse werkt hier niet — er is geen repository in de Docker-context —
# dus geeft de build het commit-hash mee als argument.
ARG COMMIT_SHA=onbekend
ENV COMMIT_SHA=$COMMIT_SHA
ENV APP_BASE=/

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /srv
ENV NODE_ENV=production

# Ook in de runtime-laag, zodat de server kan vertellen wélke build hij
# serveert. Zonder dat kan de app alleen met GitHub vergelijken, en die loopt
# een deploy vóór op wat er daadwerkelijk staat.
ARG COMMIT_SHA=onbekend
ENV COMMIT_SHA=$COMMIT_SHA

# Server-dependencies staan los van die van de frontend, zodat de runtime-image
# alleen express en de Firestore-client bevat.
COPY server/package*.json ./
RUN npm ci --omit=dev

COPY server/index.js ./
COPY --from=build /app/dist ./public

EXPOSE 8080
CMD ["node", "index.js"]
