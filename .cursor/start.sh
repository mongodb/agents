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

# Cursor writes ~/.gitconfig with url.<app token>.insteadOf rules that rewrite
# every https://github.com/ URL to carry a GitHub App token scoped to this repo
# only. Credentials embedded in the URL win over credential helpers, so
# `git clone` and `gh repo clone` of other repos (for example
# mongodb/ai-assistant) fail with "Repository not found" even though the
# GH_TOKEN PAT can read them via the API. Git uses the longest matching
# insteadOf prefix, so mapping each org prefix to itself (no embedded token)
# overrides the app-token rule and lets the gh credential helper supply GH_TOKEN.
# The file lives under XDG config, which Cursor does not manage, and no token
# is written to disk.
if [[ -n "${GH_TOKEN:-}" ]]; then
  git_xdg_config="${XDG_CONFIG_HOME:-${HOME}/.config}/git/config"
  mkdir -p "$(dirname "${git_xdg_config}")"
  cat >"${git_xdg_config}" <<'EOF'
[url "https://github.com/mongodb/"]
	insteadOf = https://github.com/mongodb/
[url "https://github.com/10gen/"]
	insteadOf = https://github.com/10gen/
[credential "https://github.com"]
	helper =
	helper = !gh auth git-credential
EOF
fi
