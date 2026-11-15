#!/bin/bash
# Deploy the current folder to the always-on server and restart it. Usage: npm run deploy
# Needs SSH access: your public key in /root/.ssh/authorized_keys on the server (ask a teammate who has access).
# The server keeps its own .env; this never copies yours. Open questions are lost on restart, so don't deploy mid-demo.
set -e
cd "$(dirname "$0")/.."
HOST="${ORACLE_SERVER:-root@YOUR_SERVER_IP}"
KEY="${ORACLE_SSH_KEY:-$HOME/.ssh/oracle_vultr}"
SSH="ssh -i $KEY -o IdentitiesOnly=yes"
for f in src/*.js src/*/*.js mcp/*.js; do node --check "$f"; done
rsync -az --delete --exclude node_modules --exclude .git --exclude ios --exclude .env --exclude '.env.*' --exclude public/speedtest.bin -e "$SSH" ./ "$HOST":/opt/oracle/
$SSH "$HOST" 'cd /opt/oracle && npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 && systemctl restart oracle && sleep 6 && systemctl is-active oracle && curl -s -o /dev/null -w "server answers: %{http_code}\n" localhost:3000/api/ping'
