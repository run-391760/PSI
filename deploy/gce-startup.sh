#!/bin/bash
# SynapseSEO on a Compute Engine VM (Debian). Installed as the instance's `startup-script` metadata;
# runs as root on every boot: installs Docker, pulls the latest main branch, rebuilds the image and
# (re)starts the app + Caddy (automatic HTTPS). Idempotent.
#
# Optional instance metadata:
#   synapseseo-domain       custom domain (default: <ip-with-dashes>.sslip.io)
#   synapseseo-invite-code  sign-up invite code (default: random, stored on the VM)
#   synapseseo-env          extra .env lines, e.g. DATAFORSEO_LOGIN=..., OPENAI_API_KEY=...
#   synapseseo-branch       git branch to deploy (default: main)
set -euo pipefail
exec > >(tee -a /var/log/synapseseo-deploy.log) 2>&1
echo "== SynapseSEO deploy starting $(date -Is)"

REPO=https://github.com/run-391760/PSI.git
APP_DIR=/opt/synapseseo
CONF_DIR=/etc/synapseseo
DATA_DIR=/var/lib/synapseseo
md() { curl -fs -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/$1" || true; }
# Hex string of $1 characters (od reads a fixed byte count, so no SIGPIPE under pipefail).
rand() { local s; s=$(od -An -tx1 -N "$1" /dev/urandom | tr -d ' \n'); echo "${s:0:$1}"; }

IP=$(md network-interfaces/0/access-configs/0/external-ip)
DOMAIN=$(md attributes/synapseseo-domain)
[ -n "$DOMAIN" ] || DOMAIN="${IP//./-}.sslip.io"
BRANCH=$(md attributes/synapseseo-branch)
[ -n "$BRANCH" ] || BRANCH=main

# 1. Packages
# Debian 13 ships the Docker CLI separately (docker-cli) from the daemon (docker.io).
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y --no-install-recommends docker.io git ca-certificates curl
  apt-get install -y --no-install-recommends docker-cli || true
  apt-get install -y --no-install-recommends docker-buildx || true
  systemctl enable --now docker
fi
command -v docker >/dev/null 2>&1 || { echo "== docker CLI is not available after installation"; exit 1; }
command -v git >/dev/null 2>&1 || apt-get install -y --no-install-recommends git

# 2. Source
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" reset --hard FETCH_HEAD
else
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
echo "== source at $(git -C "$APP_DIR" rev-parse --short HEAD)"

# 3. Configuration (secrets are generated on the VM and never leave it)
install -d -m 700 "$CONF_DIR"
install -d -o 1001 -g 1001 -m 750 "$DATA_DIR"
[ -s "$CONF_DIR/app-secret" ] || (umask 077; rand 64 > "$CONF_DIR/app-secret")
INVITE=$(md attributes/synapseseo-invite-code)
if [ -z "$INVITE" ]; then
  [ -s "$CONF_DIR/invite-code" ] || (umask 077; rand 16 > "$CONF_DIR/invite-code")
  INVITE=$(cat "$CONF_DIR/invite-code")
fi
umask 077
{
  echo "APP_ORIGIN=https://$DOMAIN"
  echo "APP_SECRET=$(cat "$CONF_DIR/app-secret")"
  echo "ALLOW_SIGNUPS=false"
  echo "SIGNUP_INVITE_CODE=$INVITE"
  echo "LOCAL_WORKER=true"
  md attributes/synapseseo-env
  echo
} > "$CONF_DIR/env"
umask 022
cat > "$CONF_DIR/Caddyfile" <<CADDY
$DOMAIN {
	encode zstd gzip
	reverse_proxy synapseseo:3200
}
CADDY

# 4. Build, then replace the running containers (the old app keeps serving if the build fails)
docker network inspect synapse >/dev/null 2>&1 || docker network create synapse
docker build -t synapseseo:latest "$APP_DIR"
docker rm -f synapseseo >/dev/null 2>&1 || true
docker run -d --name synapseseo --restart unless-stopped --init --network synapse \
  --env-file "$CONF_DIR/env" -v "$DATA_DIR:/data" --stop-timeout 30 synapseseo:latest
docker rm -f caddy >/dev/null 2>&1 || true
docker run -d --name caddy --restart unless-stopped --network synapse \
  -p 80:80 -p 443:443 -p 443:443/udp \
  -v "$CONF_DIR/Caddyfile:/etc/caddy/Caddyfile:ro" -v caddy_data:/data -v caddy_config:/config caddy:2
docker image prune -f >/dev/null
docker builder prune -f >/dev/null 2>&1 || true

for i in $(seq 1 60); do
  if docker exec synapseseo node -e "fetch('http://127.0.0.1:3200/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "== SynapseSEO deployed: https://$DOMAIN (health OK)"
    exit 0
  fi
  sleep 3
done
echo "== SynapseSEO started but the health check did not pass yet; see: docker logs synapseseo"
