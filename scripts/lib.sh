#!/usr/bin/env bash
# Shared plumbing for the launch scripts. Sourced, never run directly.
#
# The fiddly parts live here rather than in triplicate: starting a background
# process and actually reaping it afterwards is different on Windows (Git Bash)
# and on mac/linux, and getting it wrong leaves an orphan broker holding port
# 8787 that makes the *next* session fail with something unrelated.

set -euo pipefail

BROKER_PORT=8787
GAME_PORT=5173
METRICS_PORT=20241          # pinned so we can ask cloudflared its own hostname

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) WINDOWS=1 ;;
  *)                    WINDOWS=0 ;;
esac

# ---------------------------------------------------------------- output --

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }
warn()  { printf '\033[33m%s\033[0m\n' "$*" >&2; }
die()   { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
rule()  { printf '\033[2m%s\033[0m\n' "----------------------------------------------------------------"; }

# ------------------------------------------------------------- processes --

PIDS=()

# start_bg "<label>" <command...>  — runs it quietly, remembers the pid.
start_bg() {
  local label="$1"; shift
  "$@" >"/tmp/deadline-${label}.log" 2>&1 &
  local pid=$!
  PIDS+=("$pid")
  dim "  started ${label} (pid ${pid}, log /tmp/deadline-${label}.log)"
}

# npm's wrapper spawns the real server as a child, so killing the pid we know
# about is not enough — the tree has to go.
kill_tree() {
  local pid="$1"
  if [ "$WINDOWS" = "1" ]; then
    taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true
  else
    pkill -P "$pid" >/dev/null 2>&1 || true
    kill "$pid" >/dev/null 2>&1 || true
  fi
}

cleanup() {
  local code=$?
  if [ "${#PIDS[@]}" -gt 0 ]; then
    echo
    dim "shutting down…"
    for pid in "${PIDS[@]}"; do kill_tree "$pid"; done
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM

# ------------------------------------------------------------------ ports --

# Is something listening on this port?
#
# Deliberately not netstat: a minimal Linux install (Debian/Ubuntu slim, Alpine,
# most containers) ships no net-tools, and `ss`/`lsof` are absent on plenty of
# Windows and mac setups — this machine has netstat but neither of the others.
# A tool-detection chain is fragile in both directions. Node is the one thing
# guaranteed present, because it is what runs the game, so just try to connect.
port_busy() {
  node -e '
    const net = require("net");
    const s = net.connect({ host: "127.0.0.1", port: Number(process.argv[1]) });
    const no = () => { s.destroy(); process.exit(1); };
    s.on("connect", () => { s.destroy(); process.exit(0); });
    s.on("error", no);
    s.setTimeout(1500, no);
  ' "$1" 2>/dev/null
}

require_free_port() {
  local port="$1" what="$2"
  if port_busy "$port"; then
    # No shell-specific kill command here: this is read from a cmd window as
    # often as from bash, and the two disagree about slashes.
    die "port ${port} is already in use (${what}).

A game, broker or tunnel from an earlier session is still running. Close that
window and try again — whatever started it owns it. If there is no such window
left, end the stray 'node' or 'cloudflared' process in Task Manager."
  fi
}

wait_for_port() {
  local port="$1" label="$2" tries=60
  while [ "$tries" -gt 0 ]; do
    port_busy "$port" && return 0
    sleep 0.5
    tries=$((tries - 1))
  done
  die "${label} did not come up on port ${port} after 30s — check /tmp/deadline-*.log"
}

# ----------------------------------------------------------------- system --

preflight() {
  command -v node >/dev/null 2>&1 || die "node is not installed — get it from https://nodejs.org (18 or newer)"
  if [ ! -d node_modules ]; then
    bold "First run — installing dependencies…"
    npm install
  fi
}

lan_ip() {
  if [ "$WINDOWS" = "1" ]; then
    ipconfig 2>/dev/null | grep -i 'IPv4' | head -1 | sed 's/.*: *//' | tr -d '\r'
  elif command -v ipconfig >/dev/null 2>&1; then
    ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true
  else
    hostname -I 2>/dev/null | awk '{print $1}'
  fi
}

open_url() {
  [ "${NO_OPEN:-0}" = "1" ] && return 0
  if [ "$WINDOWS" = "1" ]; then cmd //c start "" "$1" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "$1" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 || true
  fi
}

# Which build this checkout is. Delegated to the one definition that
# vite.config.js also imports, so the number a player reads here is by
# construction the number the handshake compares.
build_id() {
  node scripts/build-id.mjs 2>/dev/null || echo dev
}
