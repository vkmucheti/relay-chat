#!/bin/sh
set -eu
host=${MONGO_REPLICA_HOST:-mongo:27017}
mongosh --host mongo --quiet --eval "
try { rs.status() } catch (e) {
  if (e.code !== 94) throw e;
  rs.initiate({_id:'rs0',members:[{_id:0, host:'$host'}]});
}"
for attempt in $(seq 1 60); do
  if mongosh --host mongo --quiet --eval 'quit(db.hello().isWritablePrimary ? 0 : 1)'; then exit 0; fi
  sleep 1
done
exit 1
