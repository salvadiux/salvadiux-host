# Security

Salvadiux binds the API and agent to loopback by default. Both protected surfaces require bearer tokens; production tokens must be long, random, distinct, and supplied through the environment. CORS permits only the configured dashboard origin.

All browser-supplied paths pass through `safeResolve`, which rejects absolute paths and traversal outside the instance root. Server commands are written to an existing process stdin; the app never interpolates user input into a shell. Java starts through `spawn` with an argument array. Plugin and server downloads resolve only through known provider metadata.

Archive restore validates every entry against the instance root. Destructive UI actions require an explicit confirmation. Logs must not contain tokens or provider secrets.

Report security issues privately to the repository owner. Do not include credentials or private server data in a report.
