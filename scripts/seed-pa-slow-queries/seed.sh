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

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./seed.sh
  ./seed.sh <mongodb-uri>
  ./seed.sh <cluster-domain-or-uri> <username>

Seeds an Atlas cluster with the highImpact Performance Advisor slow-query
dataset (collections dbA–dbD plus unindexed finds that generate high-impact
slow logs).

With no arguments, uses MONGODB_URI from the environment or .env.

Examples:
  ./seed.sh "mongodb+srv://myDbUser:myPassword@cluster0.xxxxx.mongodb.net/"
  ./seed.sh cluster0.xxxxx.mongodb.net myDbUser
  ./seed.sh "mongodb+srv://cluster0.xxxxx.mongodb.net/" myDbUser

If the URI already includes a username and password, do not pass a second
argument. Credentials in the URI are visible in process listings and shell
history.

When username is passed separately, mongosh prompts for the password unless
MONGODB_PASSWORD is set.
Requires mongosh on PATH.
EOF
}

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if [[ -f "${script_dir}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${script_dir}/.env"
  set +a
fi

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 1
fi

if [[ $# -eq 0 && -n "${MONGODB_URI:-}" ]]; then
  set -- "$MONGODB_URI"
fi

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage
  exit 1
fi

if ! command -v mongosh >/dev/null 2>&1; then
  echo "error: mongosh is not installed or not on PATH" >&2
  exit 1
fi

cluster_or_uri=$1
username=${2:-}

if [[ "$cluster_or_uri" == mongodb://* || "$cluster_or_uri" == mongodb+srv://* ]]; then
  uri=$cluster_or_uri
else
  uri="mongodb+srv://${cluster_or_uri}/"
fi

js_file="${script_dir}/highImpactPAMockData.js"

if [[ ! -f "$js_file" ]]; then
  echo "error: missing seed script at ${js_file}" >&2
  exit 1
fi

cmd=(
  mongosh
  "$uri"
  --apiVersion 1
  --file "$js_file"
)

if [[ -n "$username" ]]; then
  cmd+=(--username "$username")
  if [[ -n "${MONGODB_PASSWORD:-}" ]]; then
    cmd+=(--password "$MONGODB_PASSWORD")
  fi
fi

exec "${cmd[@]}"
