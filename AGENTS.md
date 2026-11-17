## Pull requests

- When you open a pull request, fill the body from `.github/pull_request_template.md`.

## Changesets and releases

The public packages are `@mongodb-js/atlas-agents-core`,
`@mongodb-js/atlas-explorer-agent`, `@mongodb-js/atlas-query-insights-agent`,
and `@mongodb-js/agent-engine-chat`. They share one version and release
together.

- If your pull request changes a public package in a way its users should
  see, add a changeset. Skip it for tests and internal docs.
- Add the changeset with one command (it doesn't prompt when you pass these
  flags):

  ```bash
  pnpm changeset --patch <package-name> \
    -m "One-line summary of the change, written for package users."
  ```

  - Replace `<package-name>` with the full npm name of each package you
    changed, comma-separated, e.g. `@mongodb-js/atlas-agents-core`.
  - Use `--patch` for fixes and features, and `--minor` for breaking changes.
    Never use `--major`.
  - Check it with `pnpm changeset status --since=origin/main`.
- Never edit `version` in a `package.json`. The release workflow publishes any
  version that npm doesn't have yet, as soon as it reaches `main`.
- Merging a changeset doesn't publish. Changesets accumulate in a pull request
  that the release bot opens on the `changeset-release/main` branch, and
  merging that pull request publishes. Don't create, edit, or merge it unless
  asked.
- Run `pnpm check:packages` when you change a public package's `exports`,
  `files`, or dependencies.

## Writing for the user

### Who the user is

Use this information to guide your writing with empathy toward the user:

- The user is a busy engineer.
- The user didn't see your exploration.
- The user doesn't necessarily have full context on the codebase.

### Style

In chat, plans, and PR bodies:

- Lead with the answer, then give only the detail needed to act on it.
- Use short paragraphs or bullets, one idea each.
- Explain any term or finding from the codebase or your exploration the first time you use it, or leave it out.
- Say each thing once. Don't repeat reasoning across sections.
- Take longer to think and rewrite if it makes the writing clearer.
- Limit lines of text to approximately 80 characters. Add a new line as appropriate.
  - This helps keep the git diffs more readable.
  - In shell commands, you can use the \ character to wrap the line.
