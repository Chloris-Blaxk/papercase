#!/bin/zsh
set -u

ROOT="${0:A:h}"
HOST="${PAPERCASE_HOST:-127.0.0.1}"
PORT="${PAPERCASE_PORT:-4317}"
URL="http://${HOST}:${PORT}/"
PID=""

cd -- "$ROOT" || exit 1

cleanup() {
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null
    wait "$PID" 2>/dev/null
  fi
}
trap cleanup EXIT INT TERM HUP

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required."
  read -r "?Press Return to close…"
  exit 1
fi

if /usr/bin/curl --silent --fail --max-time 1 "${URL}health" 2>/dev/null | /usr/bin/grep --quiet '"service":"papercase"'; then
  /usr/bin/open "$URL"
  exit 0
fi

PAPERCASE_HOST="$HOST" PAPERCASE_PORT="$PORT" /usr/bin/env node server.mjs &
PID=$!

for attempt in {1..50}; do
  if /usr/bin/curl --silent --fail --max-time 1 "${URL}health" 2>/dev/null | /usr/bin/grep --quiet '"service":"papercase"'; then
    /usr/bin/open "$URL"
    echo "PaperCase is running at $URL"
    echo "Close this window or press Control-C to stop it."
    wait "$PID"
    exit $?
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    wait "$PID" 2>/dev/null
    echo "PaperCase could not start. Port ${PORT} may already be in use."
    read -r "?Press Return to close…"
    exit 1
  fi
  sleep 0.1
done

echo "PaperCase did not become ready in time."
read -r "?Press Return to close…"
exit 1
