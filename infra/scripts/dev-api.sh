#!/bin/sh
set -eu
pids=''
. infra/scripts/dev-watch.sh
trap stop_watchers TERM INT EXIT

start_watcher @relay/shared
start_watcher @relay/api
pnpm --filter @relay/api dev &
app=$!
pids="$pids $app"
wait "$app"
