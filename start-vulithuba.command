#!/bin/bash

cd "$(dirname "$0")" || exit 1

if ! curl --silent --fail http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
  nohup node --env-file-if-exists=.env server.js >/tmp/vulithuba-server.log 2>&1 &
  for i in {1..20}; do
    curl --silent --fail http://127.0.0.1:3000/api/health >/dev/null 2>&1 && break
    sleep 0.25
  done
fi

open -a Safari http://127.0.0.1:3000/index.html
