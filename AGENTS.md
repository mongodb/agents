## Pull requests

- When you open a pull request, fill the body from `.github/pull_request_template.md`.

## Changesets and releases

- If you change a public package (one under `packages/` without
  `"private": true`) in a way its users should see, add a changeset:

  ```bash
  pnpm changeset --patch <package-name> -m "One-line summary for users."
  ```

  Use the full npm name, comma-separated for several packages. Use `--minor`
  for breaking changes, and never `--major`.
- Never edit `version` in a `package.json`. A new version publishes as soon
  as it reaches `main`.
- Don't touch the release bot's pull request (branch `changeset-release/main`)
  unless asked.

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
