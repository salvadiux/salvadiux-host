# Testing

`pnpm test` runs deterministic unit tests for path containment, compatibility, and configuration parsing. `pnpm typecheck`, `pnpm lint`, and `pnpm build` verify all workspaces.

A release smoke test should use a clean data directory and a real Paper server: create, resolve Java, install, start, wait for `Done`, send `list`, stop, edit `server.properties`, restart, install a compatible plugin, restart, verify the plugin in logs, create and restore a backup, then restart the app and verify reconciliation. External downloads are deliberately excluded from ordinary unit tests.
