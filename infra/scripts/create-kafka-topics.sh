#!/bin/sh
set -eu
case "${KAFKA_PARTITIONS:-6}" in ''|*[!0-9]*) exit 1;; esac
test "${KAFKA_PARTITIONS:-6}" -ge 6
for topic in chat.messages.created chat.messages.persisted chat.receipts chat.notifications chat.dlq; do
  /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --create --if-not-exists \
    --topic "$topic" --partitions "${KAFKA_PARTITIONS:-6}" --replication-factor "${KAFKA_REPLICATION_FACTOR:-1}"
done
