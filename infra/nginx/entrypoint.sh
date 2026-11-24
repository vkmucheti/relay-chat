#!/bin/sh
set -eu
case "$RELAY_SERVER_NAME" in ''|*[!a-zA-Z0-9.-]*) exit 1;; esac
case "$S3_BUCKET" in ''|*[!a-z0-9.-]*) exit 1;; esac
case "$RELAY_HTTPS_PUBLIC_PORT" in
  :*) port=${RELAY_HTTPS_PUBLIC_PORT#:}; case "$port" in ''|*[!0-9]*) exit 1;; esac ;;
  '') ;;
  *) exit 1 ;;
esac
envsubst '${RELAY_SERVER_NAME} ${S3_BUCKET} ${RELAY_HTTPS_PUBLIC_PORT}' < /etc/nginx/site.conf.template > /tmp/relay-site.conf
exec nginx -g 'daemon off;'
