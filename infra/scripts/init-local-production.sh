#!/bin/sh
set -eu
if [ -f .env.production ]; then exit 0; fi
umask 077
mkdir -p .relay-tls
if [ ! -s .relay-tls/fullchain.pem ] || [ ! -s .relay-tls/privkey.pem ]; then
  # Use a temporary OpenSSL config for LibreSSL and OpenSSL compatibility.
  req_config=$(mktemp)
  trap 'rm -f "$req_config"' EXIT
  cat > "$req_config" <<'CONFIG'
[req]
distinguished_name=dn
x509_extensions=local
prompt=no
[dn]
CN=localhost
[local]
subjectAltName=DNS:localhost,IP:127.0.0.1
CONFIG
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -config "$req_config" \
    -keyout .relay-tls/privkey.pem -out .relay-tls/fullchain.pem 2>/dev/null
fi
storage=$(openssl rand -hex 24)
cat > .env.production <<CONFIG
APP_ENV=production
COOKIE_SECURE=true
TRUST_PROXY=1
RELAY_SERVER_NAME=localhost
RELAY_HTTPS_PUBLIC_PORT=:8443
PUBLIC_BIND=127.0.0.1
HTTP_PORT=8088
HTTPS_PORT=8443
CORS_ORIGINS=https://localhost:8443
JWT_ACCESS_SECRET=$(openssl rand -hex 48)
JWT_REFRESH_SECRET=$(openssl rand -hex 48)
MONGO_URL=mongodb://mongo:27017/relay?replicaSet=rs0
REDIS_URL=redis://redis:6379
KAFKA_BROKERS=kafka:9092
KAFKA_PARTITIONS=6
KAFKA_REPLICATION_FACTOR=1
MINIO_ROOT_USER=relay-local-prod
MINIO_ROOT_PASSWORD=$storage
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=https://localhost:8443
S3_BUCKET=relay-media
S3_ACCESS_KEY=relay-local-prod
S3_SECRET_KEY=$storage
GRAFANA_PORT=3003
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=$(openssl rand -hex 24)
CONFIG
printf '%s\n' 'Generated local TLS files and .env.production for https://localhost:8443.'
