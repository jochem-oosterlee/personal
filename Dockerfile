# Bouwstap: APP_BASE=/ omdat Cloud Run vanaf de root serveert, anders dan
# GitHub Pages dat onder /personal/ zit.
FROM node:22-alpine AS build
WORKDIR /app

# De build zet het commit-hash in de app, en git rev-parse heeft daar een
# repository voor nodig. In de Docker-context is die er niet, dus geeft
# cloudbuild.yaml het hash als build-arg mee.
ARG COMMIT_SHA=onbekend
ENV COMMIT_SHA=$COMMIT_SHA
ENV APP_BASE=/

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
