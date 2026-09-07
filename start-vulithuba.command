#!/bin/bash

cd "$(dirname "$0")" || exit 1

NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ] && [ -x /opt/homebrew/bin/node ]; then
  NODE_BIN="/opt/homebrew/bin/node"
fi
if [ -z "$NODE_BIN" ] && [ -x /usr/local/bin/node ]; then
  NODE_BIN="/usr/local/bin/node"
fi

if [ -z "$NODE_BIN" ]; then
  echo "Node.js was not found. Install Node.js and run this file again."
  exit 1
fi

if ! curl --silent --fail http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
  nohup "$NODE_BIN" server.js >/tmp/vulithuba-server.log 2>&1 &
  SERVER_PID=$!
  for i in {1..20}; do
    curl --silent --fail http://127.0.0.1:3000/api/health >/dev/null 2>&1 && break
    sleep 0.25
  done

  if ! curl --silent --fail http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "Vulithuba failed to start. See /tmp/vulithuba-server.log:"
    cat /tmp/vulithuba-server.log
    kill "$SERVER_PID" 2>/dev/null || true
    exit 1
  fi
fi

open -a Safari http://127.0.0.1:3000/index.html
