#!/bin/sh
set -eu
# Never echo connection strings. The public process receives only the API role.
case "${VESSEL_PROCESS:-api}" in
  api)
    exec node node_modules/ponder/dist/esm/bin/ponder.js serve --schema="${PONDER_VIEWS_SCHEMA:-vessel}" --hostname=0.0.0.0
    ;;
  indexer)
    schema="${DATABASE_SCHEMA:-vessel_$(printf %s "${KAMAL_VERSION:-local}" | sha1sum | cut -c1-16)}"
    # Ponder start includes an HTTP server; bind it inside this container only.
    exec node node_modules/ponder/dist/esm/bin/ponder.js start --schema="$schema" --views-schema="${PONDER_VIEWS_SCHEMA:-vessel}" --hostname=127.0.0.1
    ;;
  *) echo 'Invalid VESSEL_PROCESS' >&2; exit 1 ;;
esac
