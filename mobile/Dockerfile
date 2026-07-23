# Mobile backend container.
# The Expo/React Native client is built and shipped separately via EAS;
# this image only runs the Node/Express API in mobile/server.

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --include=optional || npm install --include=optional

COPY tsconfig*.json ./
COPY server ./server
# Shared client util imported by server/services/openAI.ts
COPY src/utils/trainLine.ts ./src/utils/trainLine.ts

EXPOSE 8000

CMD ["npm", "run", "serve"]
