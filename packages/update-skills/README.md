# update-skills

Refreshes an agent's vendored MongoDB skills from [`mongodb/agent-skills`](https://github.com/mongodb/agent-skills).

Each agent keeps its own copies of the skills in `skills/`. This tool copies the skills named in the agent's config from upstream into those directories. It doesn't touch any other skill.

## Usage

Run from the repository root:

```bash
pnpm update-skills agents/atlas-explorer --dry-run   # show what would change
pnpm update-skills agents/atlas-explorer             # apply the changes
pnpm update-skills agents/atlas-explorer --check     # exit 1 if anything is out of date
```

Relative paths resolve from the directory where you ran pnpm.

## Config file

Each agent has a `skills.config.json` next to its `skills/` directory:

```json
{
  "source": "mongodb/agent-skills",
  "skills": ["mongodb-connection", "mongodb-query-optimizer"]
}
```

- `source` is a GitHub `owner/repo`, a git URL, or a local path. Local paths that start with `/`, `./` or `../` resolve against the agent directory.
- `ref` (optional) is the branch, tag, or commit to fetch from a remote source. It isn't allowed with a local path.
- `skills` lists the skills to vendor. Each must exist in the source. Names use lowercase letters, digits and hyphens.

## What changes

- Each listed skill's directory is replaced with the upstream copy. Files that upstream removed are deleted.
- `skills.lock.json` records the source and a SHA-256 digest for each listed skill.
- Directories in `skills/` that aren't listed are reported and left alone. `--check` counts them as out of date.
- Nothing is written until every listed skill has been fetched.

## How it fetches

The tool runs the npm [`skills`](https://www.npmjs.com/package/skills) CLI, pinned to 1.7.2, in a temporary directory. It passes `-s` for each listed skill, so unlisted skills are never downloaded. Telemetry is off. The `skills` CLI needs Node 22.20 or newer.

## Tests

```bash
pnpm --filter @repo/update-skills test
pnpm --filter @repo/update-skills typecheck
```

The tests run the real `skills` CLI against a local fixture, so they don't need network access.
