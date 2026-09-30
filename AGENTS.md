# Repository instructions

- Preserve the control-plane/agent boundary and keep host operations out of React.
- Never expose a visible control without a real backend operation or an explicit unavailable state.
- Use `safeResolve` for every instance-relative path.
- Use provider metadata; do not hardcode Minecraft versions, builds, or plugin compatibility.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` after functional changes.
