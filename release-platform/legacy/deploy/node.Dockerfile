FROM node:22-alpine

WORKDIR /app

COPY proxy-standalone.js /app/proxy-standalone.js
COPY glm-zai-local-adapter.mjs /app/glm-zai-local-adapter.mjs
