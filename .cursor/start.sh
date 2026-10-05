#!/usr/bin/env bash
# Copyright 2026 MongoDB, Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

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
