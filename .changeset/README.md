# Changesets

This folder holds the release notes for the public packages, the ones
published to npm. The other workspaces are private and are never versioned or
published.

Run `pnpm changeset` in a pull request that changes a public package, pick
the packages and a bump type, and write a one-line summary. Commit the file it
creates here. See "Releasing" in [CONTRIBUTING](../CONTRIBUTING.md).

The public packages are released together and share one version number, so a
changeset for any of them bumps all of them. They are at `0.x`. Use `minor`
for a breaking change and `patch` for everything else. Do not use `major`
without agreeing on a `1.0.0` release.
