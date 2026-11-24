# Start a TypeScript watcher and wait for its first emission before starting
# the application. Node's watcher would otherwise restart a healthy listener
# during initial compilation.
start_watcher() {
  project=$1
  log=$(mktemp)
  pnpm --filter "$project" watch > "$log" 2>&1 &
  watcher=$!
  pids="$pids $watcher"
  tail -n +1 -f "$log" &
  pids="$pids $!"
  while ! grep -q 'Watching for file changes' "$log"; do
    kill -0 "$watcher"
    sleep 1
  done
  test -z "$(grep -E 'Found [1-9][0-9]* errors?' "$log" || true)"
}

stop_watchers() {
  # The list is assembled from child PIDs only.
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  wait || true
}
