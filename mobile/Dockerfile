# Mobile backend container.
# The Expo/React Native client is built and shipped separately via EAS;
# this image only runs the Node/Express API in mobile/server.

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=optional || npm install --omit=optional

COPY tsconfig*.json ./
COPY server ./server

EXPOSE 8000

CMD ["npm", "run", "serve"]
