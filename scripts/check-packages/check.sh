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

# Packs the publishable packages, lints the tarballs, then installs them into
# an empty project and checks that they import and type-check. Workspace tests
# only see linked sources, so this is the check that covers `exports`, `files`,
# and peer dependencies as a consumer gets them.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
packages=(
  agent-engine-core
  atlas-explorer-agent
  atlas-query-insights-agent
  agent-engine-chat
)

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir "$work/tarballs" "$work/consumer"

for dir in "${packages[@]}"; do
  # `prepack` builds the package, so this packs fresh output.
  (cd "$root/packages/$dir" && pnpm pack --pack-destination "$work/tarballs" >/dev/null)
done

for tarball in "$work"/tarballs/*.tgz; do
  echo "Linting $(basename "$tarball")"
  npx --yes publint@0.3.25 run "$tarball"
  npx --yes @arethetypeswrong/cli@0.18.5 "$tarball" --profile esm-only
done

# Install each dependency and required peer at the version the workspace
# lockfile resolved, so the check does not depend on whether the latest
# releases of the LangChain packages agree with each other on a given day. `--legacy-peer-deps` skips
# npm's peer resolution, so a peer the packages import but do not declare
# fails the import below instead of being installed by accident.
peers="$(
  cd "$root" && node -e '
    const fs = require("node:fs");
    const found = new Set();
    const packagesUnderTest = new Set(
      process.argv.slice(1).map((dir) => `@mongodb-js/${dir}`),
    );
    for (const dir of process.argv.slice(1)) {
      const pkgDir = `packages/${dir}`;
      const pkg = JSON.parse(fs.readFileSync(`${pkgDir}/package.json`, "utf8"));
      const wanted = [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
      ];
      for (const name of wanted) {
        if (pkg.peerDependenciesMeta?.[name]?.optional) continue;
        if (packagesUnderTest.has(name)) continue;
        const installed = JSON.parse(
          fs.readFileSync(`${pkgDir}/node_modules/${name}/package.json`, "utf8"),
        );
        found.add(`${name}@${installed.version}`);
      }
    }
    console.log([...found].join(" "));
  ' "${packages[@]}"
)"
echo "Pinned: $peers"

cp "$root/scripts/check-packages/consumer.ts" "$work/consumer/consumer.ts"
cd "$work/consumer"
echo '{"name":"consumer","private":true,"type":"module"}' > package.json
# shellcheck disable=SC2086
npm install --ignore-scripts --legacy-peer-deps "$work"/tarballs/*.tgz $peers typescript@5 tsx @types/node@24
npx tsc --noEmit --strict --module nodenext --moduleResolution nodenext \
  --target es2022 --lib esnext --types node consumer.ts
npx tsx consumer.ts

# The agent packages ship their skills and a `sync-skills` bin that copies
# them into the consumer's ./skills during its build.
npx --no-install atlas-explorer-agent sync-skills
npx --no-install atlas-query-insights-agent sync-skills --dir query-insights-skills
for dir in skills query-insights-skills; do
  count="$(find "$dir" -mindepth 2 -maxdepth 2 -name SKILL.md | wc -l)"
  if [ "$count" -eq 0 ]; then
    echo "sync-skills copied no skills into $dir" >&2
    exit 1
  fi
  echo "$dir: $count skills"
done
