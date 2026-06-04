#!/usr/bin/env bash
set -euo pipefail

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
REPO_ROOT="/Users/one/chatgpt-backup-automation"
USER_DATA_DIR="$REPO_ROOT/.local/chrome-user-data-cdp"
EXTENSION_PATH="$REPO_ROOT/extension/chatgpt-backup"
CDP_HOST="127.0.0.1"
CDP_PORT="9222"

if [[ ! -x "$CHROME" ]]; then
  echo "Google Chrome Stable was not found at: $CHROME" >&2
  exit 1
fi

if command -v lsof >/dev/null 2>&1; then
  if lsof -nP -iTCP:"$CDP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $CDP_PORT is already in use." >&2
    echo "Close the old automation Chrome, or edit this script to use another port." >&2
    exit 1
  fi
elif command -v nc >/dev/null 2>&1; then
  if nc -z "$CDP_HOST" "$CDP_PORT" >/dev/null 2>&1; then
    echo "Port $CDP_PORT is already in use." >&2
    echo "Close the old automation Chrome, or edit this script to use another port." >&2
    exit 1
  fi
fi

mkdir -p "$USER_DATA_DIR"

echo "Starting automation-only Chrome with:"
echo "  user-data-dir: $USER_DATA_DIR"
echo "  extension:     $EXTENSION_PATH"
echo "  CDP:           http://$CDP_HOST:$CDP_PORT"
echo
echo "After Chrome opens:"
echo "  1. Log in to the target ChatGPT account."
echo "  2. Confirm Personal space."
echo "  3. Confirm English UI."
echo "  4. Open a recent chat, not a project chat."
echo "  5. In a second Terminal, run: .local/bin/npm run phase3c:smoke"
echo

exec "$CHROME" \
  --remote-debugging-address="$CDP_HOST" \
  --remote-debugging-port="$CDP_PORT" \
  --user-data-dir="$USER_DATA_DIR" \
  --disable-extensions-except="$EXTENSION_PATH" \
  --load-extension="$EXTENSION_PATH" \
  --no-first-run \
  --no-default-browser-check \
  "https://chatgpt.com/"
