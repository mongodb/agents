#!/usr/bin/env bash
# Idempotent Cloud Agent install: MongoDB agentengine CLI.
# pnpm is already on the base image; do not install it here.
set -euo pipefail

curl -fsSL https://agentengine.mongodb.com/api/v1/cli/install.sh | bash

bin="${HOME}/.local/bin/agentengine"
if [[ ! -x "${bin}" ]]; then
  echo "agentengine install did not produce ${bin}" >&2
  exit 1
fi

sudo ln -sfn "${bin}" /usr/local/bin/agentengine
agentengine --version
