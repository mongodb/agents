#!/usr/bin/env bash
# Runs on Cursor's default Cloud Agent image, which already has gh, git,
# Node, and pnpm. Adds Docker and the MongoDB agentengine CLI.
set -euo pipefail

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    return 0
  fi

  sudo apt-get update
  sudo apt-get install -y --no-install-recommends ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl --retry 3 --retry-delay 5 -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  # Cursor's current image is Ubuntu 24.04 (noble). The Docker package pin matches it.
  source /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    -o Dpkg::Options::="--force-confdef" \
    -o Dpkg::Options::="--force-confold" \
    docker-ce=5:28.5.2-1~ubuntu.24.04~noble \
    docker-ce-cli=5:28.5.2-1~ubuntu.24.04~noble \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin \
    fuse-overlayfs \
    iptables
  sudo update-alternatives --set iptables /usr/sbin/iptables-legacy
  sudo update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy
}

install_docker

# Cloud Agents run inside a container. fuse-overlayfs is the storage driver
# Cursor documents for that setup.
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "storage-driver": "fuse-overlayfs"
}
EOF
sudo groupadd -f docker
sudo usermod -aG docker "${USER:-ubuntu}"

curl -fsSL https://agentengine.mongodb.com/api/v1/cli/install.sh | bash

bin="${HOME}/.local/bin/agentengine"
if [[ ! -x "${bin}" ]]; then
  echo "agentengine install did not produce ${bin}" >&2
  exit 1
fi

sudo ln -sfn "${bin}" /usr/local/bin/agentengine
agentengine --version

# GH_TOKEN, when set, is a personal classic PAT. gh prefers it over the
# sandbox GitHub App login. setup-git makes git use that same token.
if [[ -n "${GH_TOKEN:-}" ]]; then
  gh auth setup-git
fi
