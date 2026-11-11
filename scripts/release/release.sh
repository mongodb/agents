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

# Publish step run by the release workflow (changesets/action calls it once
# the "Version Packages" pull request has merged, and on every other push to
# main). It publishes only versions npm does not have yet.
#
# PUBLISH_DRY_RUN decides whether anything is uploaded. It defaults to true.
# Setting it to false is the one deliberate switch to publish for real.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

case "${PUBLISH_DRY_RUN:-true}" in
  true) mode="dry run (validates packaging, uploads nothing)" ;;
  false) mode="REAL PUBLISH to the public npm registry" ;;
  *)
    echo "PUBLISH_DRY_RUN must be true or false" >&2
    exit 1
    ;;
esac
echo "Release mode: $mode"

pnpm check:packages

if [ "${PUBLISH_DRY_RUN:-true}" = "false" ]; then
  # Skips versions that are already on npm and creates the git tags that
  # changesets/action turns into GitHub releases.
  pnpm changeset publish
else
  # Private workspaces are skipped by `pnpm -r publish`.
  pnpm -r publish --dry-run --no-git-checks
fi
