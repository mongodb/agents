# Cloud Agent environment build failure

Recurring environment build `bld-20261005-6ff07085-f684-4228-80fe-5a186fd5d33e` failed with `INSTALL_FAILED`. The platform setup succeeded. `.cursor/install.sh` exited while installing Docker.

## What the build did

The build ran on 2026-10-05 from 14:56:15Z to 14:58:17Z for the `mongodb-agents` environment (`.cursor/environment.json`).

These steps completed:

- Cloned the repo into `/workspace` and checked out `main`.
- Installed the exec daemon and the agent-store FUSE helper.
- Skipped VNC, Chrome, fonts, themes, and locales because those assets were already on the image.
- Configured git, linked `gh`, created artifact directories, and started core dumps, the desktop, and the exec daemon.
- Upgraded `ca-certificates`, `curl`, and GnuPG.
- Added the Docker apt repository and downloaded Docker CE 28.5.2, containerd, Buildx, Compose, iptables, and `fuse-overlayfs`.
- Configured the `docker-ce` package.

The script never reached the steps after the Docker package install: writing `/etc/docker/daemon.json`, adding the `ubuntu` user to the `docker` group, or installing the `agentengine` CLI.

A snapshot was captured after the failed install. The build status is `FAILED`, so that snapshot is not a usable image.

## Why it failed

`fuse-overlayfs` depends on `fuse3`. The base image already has `/etc/fuse.conf`, created outside the `fuse3` package, with this contents:

```
user_allow_other
```

`dpkg` does not own that file. Configuring `fuse3` stopped on an interactive conffile prompt, and the non-interactive install has no TTY:

```
*** fuse.conf (Y/I/N/O/D/Z) [default=N] ?
dpkg: error processing package fuse3 (--configure):
 end of file on stdin at conffile prompt
dpkg: dependency problems prevent configuration of fuse-overlayfs:
 fuse-overlayfs depends on fuse3; however:
  Package fuse3 is not configured yet.
E: Sub-process /usr/bin/dpkg returned an error code (1)
```

`set -euo pipefail` in `.cursor/install.sh` turned apt's exit code 100 into the build failure. The earlier `debconf` "no dialog frontend" lines and the `ca-certificates.crt` rehash warning are harmless. `policy-rc.d` blocking `docker.service` during the image build is also expected. Docker is started later by `"start": "sudo service docker start"` in `.cursor/environment.json`.

## What to change

Edit the `apt-get install` inside `install_docker` in `.cursor/install.sh`. Keep the existing `/etc/fuse.conf`. That file's `user_allow_other` line is what lets `fuse-overlayfs` run inside the Cloud Agent container. Replacing it with the package default would comment that line out and break the storage driver at runtime.

Replace:

```bash
  sudo apt-get install -y --no-install-recommends \
    docker-ce=5:28.5.2-1~ubuntu.24.04~noble \
    docker-ce-cli=5:28.5.2-1~ubuntu.24.04~noble \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin \
    fuse-overlayfs \
    iptables
```

with:

```bash
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
```

`--force-confold` keeps the current `/etc/fuse.conf`. `--force-confdef` applies only when a package ships a conffile that is not already on disk.

No change to `.cursor/environment.json` is required.

## How to confirm

1. Merge the install-script change.
2. Trigger a new environment build.
3. Confirm the build status is successful and that the install log configures `fuse3` and `fuse-overlayfs` without a conffile prompt.
4. Confirm the log continues past the Docker install and prints an `agentengine --version` line.
