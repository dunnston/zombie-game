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

# Windows prints LISTENING, mac/linux print LISTEN — -i catches both.
port_busy() {
  netstat -an 2>/dev/null | grep -E "[:.]$1[[:space:]]" | grep -qi listen
}

require_free_port() {
  local port="$1" what="$2"
  if port_busy "$port"; then
    die "port ${port} is already in use (${what}).
A broker or dev server from an earlier session is probably still running.
Close that window, or on Windows: taskkill //F //IM node.exe"
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

# Which build this checkout is — must match the exact rule in vite.config.js,
# because this is the number the two players read to each other.
build_id() {
  local sha dirty
  sha="$(git log -1 --format=%h -- src/ 2>/dev/null || true)"
  [ -z "$sha" ] && { echo "dev"; return; }
  dirty="$(git status --porcelain src/ 2>/dev/null || true)"
  if [ -n "$dirty" ]; then echo "${sha}-dirty"; else echo "$sha"; fi
}
