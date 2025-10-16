#!/usr/bin/env bash
set -e

# Skriv runtime-konfiguration från miljövariabler till /config.js
if [ -f /usr/share/nginx/html/config.template.js ]; then
  envsubst < /usr/share/nginx/html/config.template.js > /usr/share/nginx/html/config.js
fi

# Starta Nginx i förgrunden
exec nginx -g 'daemon off;'
