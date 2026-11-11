# Changesets

This folder holds the release notes for the four packages published to npm:
`@mongodb-js/agent-engine-core`, `@mongodb-js/atlas-explorer-agent`,
`@mongodb-js/atlas-query-insights-agent` and `@mongodb-js/agent-engine-chat`.
The other workspaces are private and are never versioned or published.

Run `pnpm changeset` in a pull request that changes one of the four packages,
pick the packages and a bump type, and write a one-line summary. Commit the
file it creates here. See "Releasing" in [CONTRIBUTING](../CONTRIBUTING.md).

The packages are at `0.x`. Use `minor` for a breaking change and `patch` for
everything else. Do not use `major` without agreeing on a `1.0.0` release.
