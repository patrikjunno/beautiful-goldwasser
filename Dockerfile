# === Bygg steg ===
FROM node:20-alpine AS build
WORKDIR /app

# Installera beroenden
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Kopiera hela projektet och bygg
COPY . .
RUN npm run build || (echo "Build misslyckades" && exit 1)

# === Produktionssteg (Nginx) ===
FROM nginx:1.27-alpine

# Kopiera färdigbyggd app (React/Vite hamnar i dist eller build)
COPY --from=build /app/build /usr/share/nginx/html

# Kopiera Nginx-konfiguration
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

# Lägg till bash och gettext (för envsubst)
RUN apk add --no-cache bash gettext

# Kopiera deploy-filer för runtime-config
COPY deploy/config.template.js /usr/share/nginx/html/config.template.js
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Hälso-check och port
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ || exit 1

# Kör som icke-root
USER 101:101

# Starta via entrypoint
ENTRYPOINT ["/entrypoint.sh"]
