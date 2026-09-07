#!/usr/bin/env bash
# Play together over the internet. Two modes, because the two sides do
# different work: the host runs a broker and a tunnel, the guest does not.
#
#   ./scripts/play-online.sh                          # HOST: prints a link to send
#   ./scripts/play-online.sh wss://xyz.trycloudflare.com   # GUEST: joins with that link
#   ./scripts/play-online.sh 'http://localhost:5173/?signal=wss://xyz...'  # also fine
#
# Both of you serve the game from your own checkout — only the tiny handshake
# goes through the tunnel, and once you are connected the game traffic is
# browser to browser. Run ./scripts/update.sh on both machines first.

cd "$(dirname "$0")/.."

NO_OPEN=0
ARG=""
for a in "$@"; do
  case "$a" in
    --no-open) NO_OPEN=1 ;;
    *)         ARG="$a" ;;
  esac
done

source scripts/lib.sh
preflight

# A guest may paste either the bare wss:// address or the whole link they were
# sent; take the signal address out of whichever it is.
signal_from_arg() {
  case "$1" in
    *\?signal=*) echo "${1#*\?signal=}" ;;
    *)           echo "$1" ;;
  esac
}

# ------------------------------------------------------------------ guest --

if [ -n "$ARG" ]; then
  signal="$(signal_from_arg "$ARG")"
  case "$signal" in
    ws://*|wss://*) ;;
    *) die "that does not look like a broker address.
Expected something like: wss://something.trycloudflare.com
or the whole link your friend sent you." ;;
  esac

  require_free_port "$GAME_PORT" "the game's dev server"
  bold "Starting your game…"
  start_bg vite npm run dev
  wait_for_port "$GAME_PORT" "the dev server"

  url="http://localhost:${GAME_PORT}/?signal=${signal}"
  echo
  rule
  bold "  Open:  ${url}"
  rule
  echo
  dim "Build id $(build_id) — this must match your friend's exactly."
  dim "If it doesn't, run ./scripts/update.sh on both machines."
  echo
  bold "MULTIPLAYER -> JOIN A GAME -> the six-character code they read you."
  echo
  dim "Ctrl+C stops the game server."
  open_url "$url"
  wait
fi

# ------------------------------------------------------------------- host --

command -v cloudflared >/dev/null 2>&1 || die "cloudflared is not installed.
On Windows:  winget install --id Cloudflare.cloudflared
On mac:      brew install cloudflared
Then open a NEW terminal so it is on your PATH."

require_free_port "$BROKER_PORT" "the signalling broker"
require_free_port "$GAME_PORT" "the game's dev server"
require_free_port "$METRICS_PORT" "cloudflared's metrics endpoint"

bold "Starting…"
start_bg broker node server/signal.js
# No --host: cloudflared runs on this machine and reaches the dev server over
# localhost, so there is nothing to expose on the network.
start_bg vite npm run dev
wait_for_port "$BROKER_PORT" "the broker"
wait_for_port "$GAME_PORT" "the dev server"

# The tunnel points at the BROKER, not the game. Pinning --metrics is what
# makes the hostname discoverable: cloudflared serves it at /quicktunnel, which
# is far sturdier than scraping the box it draws in the terminal.
start_bg tunnel cloudflared tunnel \
  --url "http://localhost:${BROKER_PORT}" \
  --metrics "127.0.0.1:${METRICS_PORT}"
wait_for_port "$METRICS_PORT" "cloudflared"

dim "  asking cloudflared for its address…"
host=""
for _ in $(seq 1 40); do
  host="$(curl -s --max-time 2 "http://127.0.0.1:${METRICS_PORT}/quicktunnel" 2>/dev/null \
          | sed -n 's/.*"hostname":"\([^"]*\)".*/\1/p')"
  [ -n "$host" ] && break
  sleep 0.5
done
[ -z "$host" ] && die "cloudflared came up but never reported a hostname — see /tmp/deadline-tunnel.log"

signal="wss://${host}"
you="http://localhost:${GAME_PORT}/?signal=${signal}"

echo
rule
bold "  Send your friend this line:"
echo
bold "    ./scripts/play-online.sh ${signal}"
echo
dim  "  (or, if they would rather not use the script, this link:)"
dim  "    ${you}"
rule
echo
bold "  You open:  ${you}"
rule
echo
dim "Build id $(build_id) — your friend must be on the same one."
echo
bold "MULTIPLAYER -> HOST A GAME -> START HOSTING, then read out the six-character code."
echo
dim "This address dies when you Ctrl+C — next session gets a new one."
dim "Ctrl+C stops the game server, the broker and the tunnel."

open_url "$you"
wait
