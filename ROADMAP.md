# Roadmap

## Implemented foundation

- pnpm TypeScript monorepo, Fastify API and agent, React/Vite dashboard
- SQLite with versioned initial migration and Drizzle queries
- UUID multi-instance model and bounded filesystem paths
- Dynamic Paper, Purpur, and Vanilla discovery
- Dynamic Velocity release/build discovery with its Java minimum
- Managed Temurin runtime and transactional server downloads
- Velocity modern forwarding topology with loopback-only Paper backends and file restore
- Paper Network Core: hub compass selector, `/hub`, `/spawn`, `/back`, isolated Hub/Survival/Creative inventory profiles, and authenticated per-mode position persistence
- MariaDB/Redis private Compose template and Java 21 plugin build in CI
- Real process start, stop, force kill, stdin, console stream, and metrics
- File browser/editor, friendly/raw `server.properties`, Hangar/Modrinth search and install
- Backups/restore, world discovery, player-list inspection, scheduler records, activity and diagnostics

## Release hardening

- Durable agent reconciliation after agent restarts
- Full scheduler execution loop and task result history
- Plugin dependency plans, updates, rollback, and unmanaged identification
- World import/export and stronger archive preflight limits
- Runtime repair/cleanup, server software update/rollback, and instance import/export
- First-run password setup, encrypted provider secrets, LAN warning flow
- Automated real-server smoke matrix on Windows and Linux
- Packaged desktop distribution and update channel

## Network services not provisioned yet

- Start and secure MariaDB/Redis; configure shared LuckPerms and multi-node profile replication
- Geyser/Floodgate, Bedrock forms and canonical Java/Bedrock identity linking
- Matchmaking, party service, ephemeral minigame orchestration, economy and entitlements
- Production anti-cheat policy, external DDoS edge, HTTPS/VPN remote-node transport
- Prometheus/Grafana/Loki, alert delivery, S3 off-node backups, and verified restore drills
- Install and test the topology on actual Velocity, Hub, Survival, and Creative instances on the target host

Features remain hidden or labelled unavailable until their backend evidence is trustworthy.
