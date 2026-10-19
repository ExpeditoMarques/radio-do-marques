#!/bin/sh
set -eu
: "${ICECAST_SOURCE_PASSWORD:?Configure ICECAST_SOURCE_PASSWORD}"
: "${ICECAST_ADMIN_PASSWORD:?Configure ICECAST_ADMIN_PASSWORD}"
: "${BROADCAST_TOKEN:?Configure BROADCAST_TOKEN}"
export ICECAST_RELAY_PASSWORD="${ICECAST_RELAY_PASSWORD:-relay-$(date +%s)-change-this}"
envsubst '${ICECAST_SOURCE_PASSWORD} ${ICECAST_RELAY_PASSWORD} ${ICECAST_ADMIN_PASSWORD} ${ICECAST_PORT}' \
  < /etc/icecast2/icecast.xml.template > /etc/icecast2/icecast.xml
icecast2 -c /etc/icecast2/icecast.xml -b
sleep 1
exec node /app/server.js
