#!/bin/sh
set -eu
# Separate image repositories preserve Kamal service labels and rollback tags.
version="${GITHUB_SHA:-$(git rev-parse HEAD)}"
kamal deploy -c config/deploy.worker.yml --version "$version" --lock-wait --lock-wait-timeout 600 "$@"
kamal app exec -c config/deploy.worker.yml --version "$version" --reuse \
  "node -e 'fetch(\"http://127.0.0.1:42069/ready\").then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'"
kamal deploy --version "$version" --lock-wait --lock-wait-timeout 600 "$@"
