# De agent klont de repo en draait er npm in, dus git en een volledige node
# horen erbij. Alpine is genoeg; de SDK start Claude Code als subprocess.
FROM node:22-alpine
WORKDIR /agent

RUN apk add --no-cache git openssh-client ca-certificates

COPY agent/package*.json ./
RUN npm ci --omit=dev

COPY agent/index.js ./

CMD ["node", "index.js"]
