#!/usr/bin/env bash
# Runs on every Cloud Agent boot. install.sh is snapshotted with the
# environment build and does not run again, so Docker and the agentengine
# session are started here.
set -euo pipefail

sudo service docker start

# Reads AGENTENGINE_REFRESH_TOKEN from the environment. The resulting
# session stays in the runtime user's home directory instead of the
# shared snapshot.
agentengine auth login --from-refresh-token --base-url https://agentengine.mongodb.com
