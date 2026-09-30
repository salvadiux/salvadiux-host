# Architecture

The React dashboard talks only to the Fastify control-plane API. The API owns persistent metadata, validates input, resolves instance-scoped paths, selects installers and providers, and asks the local agent to perform host process operations. The agent owns Java child processes, standard input/output, process metrics, and live console streams.

The monorepo keeps domain types in `packages/shared`, SQLite/Drizzle schema in `packages/database`, path containment in `packages/filesystem`, property parsing in `packages/config-engine`, server/runtime installers in `packages/minecraft`, and plugin adapters in `packages/providers`.

Every instance has a UUID directory under `data/servers`. Its visible name is metadata and never determines a filesystem path. Downloads are written to `.part`, checked when the upstream exposes a hash, and renamed only after completion. Configuration edits preserve a small file backup and set `restartRequired` rather than claiming the running process has reloaded.

The local agent is an explicit future node boundary. It listens on loopback and requires an internal bearer token. A later remote-node transport can implement the same calls without moving host logic into React.
