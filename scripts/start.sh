#!/bin/bash
# One command for demo day: public HTTPS link + correct QR + server, and the Mac stays awake.
# The public link, best first (set these in .env):
#   1. TUNNEL_TOKEN + PUBLIC_DOMAIN  -> Cloudflare named tunnel, e.g. PUBLIC_DOMAIN=oracle.tryalethea.com (fixed, no warning page)
#   2. NGROK_DOMAIN                  -> ngrok fixed domain, e.g. NGROK_DOMAIN=name.ngrok-free.dev (fixed; browsers see a one-time notice)
#   3. neither                       -> Cloudflare quick tunnel (a new address every run)
cd "$(dirname "$0")/.."
val() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d '"'"'"; }
TUNNEL_TOKEN=$(val TUNNEL_TOKEN); PUBLIC_DOMAIN=$(val PUBLIC_DOMAIN); NGROK_DOMAIN=$(val NGROK_DOMAIN)
PORT=$(val PORT); PORT=${PORT:-3000}

# Stop older copies of this launcher and their idle watchers. A leftover watcher would start a second
# server on the next restart, and a second Telegram bot loses votes.
for p in $(pgrep -f "scripts/start.sh"); do [ "$p" != "$$" ] && [ "$p" != "$PPID" ] && kill "$p" 2>/dev/null; done
pkill -f "node --watch src/server.js" 2>/dev/null
lsof -ti :"$PORT" -sTCP:LISTEN | xargs kill 2>/dev/null
pkill -f "cloudflared tunnel" 2>/dev/null
pkill -f "ngrok http" 2>/dev/null
LOG=/tmp/oracle-tunnel.log
: > "$LOG"

if [ -n "$TUNNEL_TOKEN" ] && [ -n "$PUBLIC_DOMAIN" ]; then
  cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" run --token "$TUNNEL_TOKEN" > "$LOG" 2>&1 &
  URL="https://$PUBLIC_DOMAIN"
elif [ -n "$NGROK_DOMAIN" ]; then
  ngrok http "$PORT" --url "https://$NGROK_DOMAIN" --log=stdout > "$LOG" 2>&1 &
  URL="https://$NGROK_DOMAIN"
else
  cloudflared tunnel --url "http://localhost:$PORT" > "$LOG" 2>&1 &
  QUICK=1
fi
TPID=$!
caffeinate -dims &
CPID=$!
trap 'kill $TPID $CPID 2>/dev/null' EXIT

echo "Starting public link..."
if [ -n "$QUICK" ]; then
  for i in $(seq 1 40); do
    URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | grep -v '//api\.' | head -1)
    [ -n "$URL" ] && break
    sleep 1
  done
  if [ -z "$URL" ]; then echo "The public link didn't start. Details: $LOG"; exit 1; fi
else
  sleep 3
  if ! kill -0 $TPID 2>/dev/null; then echo "The public link didn't start. Details: $LOG"; tail -5 "$LOG"; exit 1; fi
fi
grep -v '^PUBLIC_URL=' .env > .env.tmp && mv .env.tmp .env
echo "PUBLIC_URL=$URL" >> .env
echo ""
echo "  Public link: $URL"
echo "  Join page:   $URL/join"
echo "  Claude MCP:  $URL/mcp   (claude.ai -> Settings -> Connectors -> Add custom connector)"
echo "  Dashboard:   http://localhost:$PORT  (refresh it with Cmd+Shift+R)"
echo ""
npm run dev
