#!/bin/sh
set -eu
pids=''
. infra/scripts/dev-watch.sh
trap stop_watchers TERM INT EXIT

start_watcher @relay/shared
pnpm --filter @relay/web dev &
app=$!
pids="$pids $app"
wait "$app"
