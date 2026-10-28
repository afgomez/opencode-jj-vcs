# OpenCode Jujutsu support

An OpenCode V2 plugin that detects Jujutsu (`jj`) repositories and provides:

- Instructions encouraging the agent to use `jj` and Git-format diffs.
- A Jujutsu VCS provider for status, diffs, and bookmarks. Branch diffs use `trunk()` by default.
- An OpenCode worktree strategy backed by Jujutsu workspaces.

## Requirements

- OpenCode 2.2.0 and a `jj` executable available to the OpenCode server.
- Jujutsu 0.38 or newer for workspace paths in `jj workspace list`.
- Bun for running the development tests.

## Local installation

Install the package dependencies, then add the absolute path to the plugin directory to `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-jj-vcs"]
}
```

OpenCode detects a `jj` repository when the plugin loads for a location. If a repository is initialized later, use `/reload` to detect it.

## Workspaces

OpenCode-managed workspaces are created without Git colocation. Only workspaces created by this plugin are listed as managed worktrees or removed by it. Removal requires force when the working copy, its history, or ignored files have changed. The default parent of a new workspace follows `jj workspace add`; an explicitly selected starting ref is passed to `--revision`.

OpenCode's project discovery still uses its built-in Git and Mercurial detectors; native Jujutsu project discovery is not provided by this plugin. When `trunk()` resolves to `root()`, branch diffs can cover the entire repository.

## Development

```sh
bun install
bun run typecheck
bun test
```
