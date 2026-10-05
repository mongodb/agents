#!/usr/bin/env bash
# Runs on every Cloud Agent boot. install.sh is snapshotted with the
# environment build and does not run again, so Docker and the agentengine
# session are started here.
set -euo pipefail

sudo service docker start

# install.sh does not run again on an existing snapshot. Install addlicense
# on boot when the image was built before that step existed.
if ! command -v addlicense >/dev/null 2>&1; then
  go install github.com/google/addlicense@v1.2.0
  license_bin="$(go env GOPATH)/bin/addlicense"
  if [[ ! -x "${license_bin}" ]]; then
    echo "addlicense install did not produce ${license_bin}" >&2
    exit 1
  fi
  sudo ln -sfn "${license_bin}" /usr/local/bin/addlicense
fi

# Reads AGENTENGINE_REFRESH_TOKEN from the environment. The resulting
# session stays in the runtime user's home directory instead of the
# shared snapshot.
agentengine auth login --from-refresh-token --base-url https://agentengine.mongodb.com
