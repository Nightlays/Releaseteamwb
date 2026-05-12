FROM harbor.wildberries.ru/devops/ci/base-images/node:22-alpine3.23 as builder

ARG NEXUS_PROXY=https://nexus-proxy.wb.ru
ENV NPM_CONFIG_REGISTRY="${NEXUS_PROXY}/repository/npm-group"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build

FROM harbor.wildberries.ru/devops/ci/base-images/nginx:stable-alpine

COPY nginx-main.conf /etc/nginx/nginx.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

CMD ["sh", "-c", "mkdir -p /dev/shm/nginx/client_temp /dev/shm/nginx/proxy_temp /dev/shm/nginx/fastcgi_temp /dev/shm/nginx/uwsgi_temp /dev/shm/nginx/scgi_temp && nginx -g 'daemon off;'"]
