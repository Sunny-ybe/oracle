#!/bin/bash
# One command for demo day: public HTTPS link + correct QR + server, and the Mac stays awake.
cd "$(dirname "$0")/.."
lsof -ti :3000 | xargs kill 2>/dev/null
pkill -f "cloudflared tunnel --url" 2>/dev/null
LOG=/tmp/oracle-tunnel.log
: > "$LOG"
cloudflared tunnel --url http://localhost:3000 > "$LOG" 2>&1 &
TPID=$!
caffeinate -dims &
CPID=$!
trap 'kill $TPID $CPID 2>/dev/null' EXIT
echo "Starting public link..."
for i in $(seq 1 40); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | grep -v '//api\.' | head -1)
  [ -n "$URL" ] && break
  sleep 1
done
if [ -z "$URL" ]; then echo "The public link didn't start. Details: $LOG"; exit 1; fi
grep -v '^PUBLIC_URL=' .env > .env.tmp && mv .env.tmp .env
echo "PUBLIC_URL=$URL" >> .env
echo ""
echo "  Public link: $URL"
echo "  Join page:   $URL/join"
echo "  Dashboard:   http://localhost:3000  (refresh it with Cmd+Shift+R)"
echo ""
npm run dev
