#!/usr/bin/env bash
# Play together on the same wifi. Run this on ONE machine — the host's.
#
# The other player needs nothing installed: no checkout, no script. They open
# the link this prints, in a browser, on the same network.
#
#   ./scripts/play-local.sh              # start, and open your browser
#   ./scripts/play-local.sh --no-open    # start, don't open a browser

cd "$(dirname "$0")/.."
NO_OPEN=0
[ "${1:-}" = "--no-open" ] && NO_OPEN=1
source scripts/lib.sh

preflight
require_free_port "$BROKER_PORT" "the signalling broker"
require_free_port "$GAME_PORT" "the game's dev server"

bold "Starting…"
start_bg broker node server/signal.js
# --host is genuinely required here, unlike the online script: the other
# machine connects to this dev server directly, and vite.config.js pins it to
# 127.0.0.1 otherwise.
start_bg vite npm run dev -- --host

wait_for_port "$BROKER_PORT" "the broker"
wait_for_port "$GAME_PORT" "the dev server"

ip="$(lan_ip)"
[ -z "$ip" ] && die "could not work out this machine's network address — check you are on wifi"

you="http://localhost:${GAME_PORT}/"
them="http://${ip}:${GAME_PORT}/?signal=ws://${ip}:${BROKER_PORT}"

echo
rule
bold "  You:     ${you}"
echo
bold "  Friend:  ${them}"
rule
echo
dim "Build id $(build_id). They are loading the game from this machine, so"
dim "they are on the same build automatically — nothing to compare."
echo
bold "You:    MULTIPLAYER -> HOST A GAME -> START HOSTING, then read out the code."
bold "Friend: MULTIPLAYER -> JOIN A GAME -> type that code."
echo
dim "Ctrl+C here stops both the game server and the broker."

open_url "$you"
wait
