import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { connect, createServer } from "node:net";
import { dirname, join } from "node:path";
import pidusage from "pidusage";

const app = Fastify({ logger: true });
await app.register(websocket);
const token = process.env.SALVADIUX_AGENT_TOKEN ?? "dev-agent-token";
type PlayerPosition = {
  x: number;
  y: number;
  z: number;
  dimension: string;
  updatedAt: string;
};
type ManagedServer = {
  child: ChildProcessWithoutNullStreams;
  logs: string[];
  logSequence: number;
  startedAt: string;
  ready: boolean;
  intentional: boolean;
  players: Set<string>;
  positions: Map<string, PlayerPosition>;
  positionTimer?: ReturnType<typeof setInterval>;
  positionQuery: boolean;
  software: string;
  host: string;
  port: number;
};
const managed = new Map<string, ManagedServer>();
const sockets = new Map<string, Set<any>>();
const observed = new Map<string, { pid: number; host: string; port: number }>();
function encodeVarInt(value: number) {
  const bytes: number[] = [];
  do {
    let part = value & 0x7f;
    value >>>= 7;
    if (value !== 0) part |= 0x80;
    bytes.push(part);
  } while (value !== 0);
  return Buffer.from(bytes);
}
function decodeVarInt(data: Buffer, offset: number) {
  let value = 0,
    position = offset;
  for (let shift = 0; shift < 35; shift += 7) {
    if (position >= data.length) return null;
    const byte = data[position++]!;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, position };
  }
  return null;
}
function packet(id: number, payload: Buffer = Buffer.alloc(0)) {
  const body = Buffer.concat([encodeVarInt(id), payload]);
  return Buffer.concat([encodeVarInt(body.length), body]);
}
function mcString(value: string) {
  const bytes = Buffer.from(value);
  return Buffer.concat([encodeVarInt(bytes.length), bytes]);
}
async function pingMinecraft(host: string, port: number) {
  return new Promise<any>((resolve, reject) => {
    const socket = connect({ host, port });
    let input = Buffer.alloc(0),
      settled = false;
    const finish = (error?: Error, value?: any) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    socket.setTimeout(2500, () =>
      finish(new Error("Minecraft status timeout")),
    );
    socket.once("error", (error) => finish(error));
    socket.on("data", (chunk) => {
      input = Buffer.concat([input, chunk]);
      let frame = decodeVarInt(input, 0);
      if (!frame) return;
      while (frame && input.length >= frame.position + frame.value) {
        const end = frame.position + frame.value;
        const packetId = decodeVarInt(input, frame.position);
        if (packetId?.value === 0) {
          const length = decodeVarInt(input, packetId.position);
          if (length && input.length >= length.position + length.value) {
            try {
              return finish(
                undefined,
                JSON.parse(
                  input.toString(
                    "utf8",
                    length.position,
                    length.position + length.value,
                  ),
                ),
              );
            } catch {
              return finish(new Error("Invalid Minecraft status response"));
            }
          }
        }
        input = input.subarray(end);
        frame = decodeVarInt(input, 0);
      }
    });
    socket.once("connect", () => {
      const hostBytes = mcString(host);
      const handshake = packet(
        0,
        Buffer.concat([
          encodeVarInt(773),
          hostBytes,
          Buffer.from([port >> 8, port & 255]),
          encodeVarInt(1),
        ]),
      );
      socket.write(Buffer.concat([handshake, packet(0)]));
    });
  });
}
function emit(id: string, event: any) {
  const line = JSON.stringify(event);
  for (const ws of sockets.get(id) ?? [])
    if (ws.readyState === 1) ws.send(line);
}
function readPositionLine(state: ManagedServer, raw: string) {
  const position = raw.match(
    /: ([A-Za-z0-9_]{1,16}) has the following entity data: \[\s*(-?[\d.eE+]+)d?,\s*(-?[\d.eE+]+)d?,\s*(-?[\d.eE+]+)d?\s*\]/i,
  );
  if (position) {
    const [, name, x, y, z] = position;
    if (name && state.players.has(name))
      state.positions.set(name, {
        x: Number(x),
        y: Number(y),
        z: Number(z),
        dimension:
          state.positions.get(name)?.dimension ?? "minecraft:overworld",
        updatedAt: new Date().toISOString(),
      });
    return;
  }
  const dimension = raw.match(
    /: ([A-Za-z0-9_]{1,16}) has the following entity data: "([a-z0-9_.-]+:[a-z0-9_./-]+)"/i,
  );
  if (dimension) {
    const [, name, value] = dimension;
    if (name && value && state.positions.has(name))
      state.positions.set(name, {
        ...state.positions.get(name)!,
        dimension: value,
        updatedAt: new Date().toISOString(),
      });
  }
}
function collectPlayerPositions(state: ManagedServer) {
  if (!state.ready || state.positionQuery || !state.players.size) return;
  state.positionQuery = true;
  state.child.stdin.write("execute as @a run data get entity @s Pos\n");
  setTimeout(
    () =>
      state.child.stdin.write(
        "execute as @a run data get entity @s Dimension\n",
      ),
    250,
  );
  setTimeout(() => {
    state.positionQuery = false;
  }, 1200);
}
app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/health") return;
  const supplied =
    req.headers.authorization?.replace(/^Bearer /, "") ??
    (req.query as any)?.token;
  if (supplied !== token)
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
});
app.get("/health", async () => ({
  ok: true,
  agent: "ready",
  managed: managed.size,
}));
app.get("/instances/:id/port-check", async (req) => {
  const { host, port } = req.query as any;
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (error: any) =>
      resolve({ available: false, code: error.code }),
    );
    server.once("listening", () =>
      server.close(() => resolve({ available: true })),
    );
    server.listen(Number(port), host === "0.0.0.0" ? undefined : host);
  });
});
app.post("/files/reveal", async (req, reply) => {
  const body = req.body as { path?: string; select?: boolean };
  const target = String(body?.path ?? "");
  if (!target || !existsSync(target))
    return reply.code(404).send({ ok: false, error: "File or folder not found" });

  let command: string;
  let args: string[];
  if (process.platform === "win32") {
    command = "explorer.exe";
    args = body.select ? [`/select,${target}`] : [target];
  } else if (process.platform === "darwin") {
    command = "open";
    args = body.select ? ["-R", target] : [target];
  } else {
    command = "xdg-open";
    args = [body.select ? dirname(target) : target];
  }

  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.once("error", (error) => req.log.warn({ err: error }, "Could not open file location"));
  child.unref();
  return { ok: true };
});
app.post("/instances/:id/observe", async (req, reply) => {
  const body = req.body as any;
  const pid = Number(body.pid),
    port = Number(body.port);
  if (
    !Number.isSafeInteger(pid) ||
    pid < 1 ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65535
  )
    return reply
      .code(400)
      .send({ ok: false, error: "Invalid server process or port" });
  const host = String(body.host ?? "127.0.0.1");
  if (!["127.0.0.1", "localhost", "::1"].includes(host))
    return reply
      .code(400)
      .send({
        ok: false,
        error: "External process monitoring is limited to this computer",
      });
  observed.set((req.params as any).id, { pid, host, port });
  return { ok: true };
});
app.post("/instances/:id/start", async (req, reply) => {
  const id = (req.params as any).id;
  if (managed.has(id))
    return reply.code(409).send({ ok: false, error: "Already running" });
  const body = req.body as any;
  if (!existsSync(body.javaPath) || !existsSync(join(body.cwd, "server.jar")))
    return reply
      .code(400)
      .send({ ok: false, error: "Runtime or server JAR missing" });
  const args = [
    `-Xms${body.minMemoryMb}M`,
    `-Xmx${body.maxMemoryMb}M`,
    ...(body.jvmArgs ?? []),
    "-jar",
    "server.jar",
    ...(body.software === "velocity" ? [] : ["nogui"]),
    ...(body.serverArgs ?? []),
  ];
  const child = spawn(body.javaPath, args, {
    cwd: body.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const state: ManagedServer = {
    child,
    logs: [],
    logSequence: 0,
    startedAt: new Date().toISOString(),
    ready: false,
    intentional: false,
    players: new Set<string>(),
    positions: new Map<string, PlayerPosition>(),
    positionQuery: false,
    software: String(body.software ?? "paper"),
    host: String(body.host ?? "127.0.0.1"),
    port: Number(body.port),
  };
  managed.set(id, state);
  const push = (level: string, data: Buffer) => {
    for (const raw of data.toString("utf8").split(/\r?\n/)) {
      if (!raw) continue;
      state.logs.push(raw);
      state.logSequence++;
      if (state.logs.length > 2000) state.logs.shift();
      if (/Done \([\d.]+s\)!|Listening on .*:\d+/i.test(raw)) {
        state.ready = true;
        setTimeout(() => {
          if (managed.get(id) === state) {
            if (state.software !== "velocity") {
              child.stdin.write("list\n");
              state.positionTimer = setInterval(() => collectPlayerPositions(state), 5000);
            }
          }
        }, 1000);
      }
      readPositionLine(state, raw);
      const joined = raw.match(/: ([A-Za-z0-9_]{1,16}) joined the game/i);
      const left = raw.match(/: ([A-Za-z0-9_]{1,16}) left the game/i);
      if (joined) state.players.add(joined[1]!);
      if (left) {
        state.players.delete(left[1]!);
        state.positions.delete(left[1]!);
      }
      const list = raw.match(
        /There are \d+ of a max of \d+ players online:\s*(.*)$/i,
      );
      if (list) {
        state.players.clear();
        for (const name of list[1]!
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean))
          if (/^[A-Za-z0-9_]{1,16}$/.test(name)) state.players.add(name);
      }
      emit(id, {
        type: "console",
        level,
        line: raw,
        at: new Date().toISOString(),
      });
    }
  };
  child.stdout.on("data", (d) => push("info", d));
  child.stderr.on("data", (d) => push("error", d));
  child.on("exit", (code, signal) => {
    if (state.positionTimer) clearInterval(state.positionTimer);
    emit(id, {
      type: "exit",
      code,
      signal,
      intentional: state.intentional,
      at: new Date().toISOString(),
    });
    managed.delete(id);
  });
  emit(id, { type: "status", status: "starting", pid: child.pid });
  return { ok: true, pid: child.pid };
});
app.post("/instances/:id/command", async (req, reply) => {
  const s = managed.get((req.params as any).id);
  if (!s)
    return reply.code(409).send({ ok: false, error: "Server is offline" });
  const command = String((req.body as any).command ?? "")
    .replace(/[\r\n]/g, "")
    .trim();
  if (!command)
    return reply.code(400).send({ ok: false, error: "Command is empty" });
  s.child.stdin.write(`${command}\n`);
  return { ok: true };
});
app.post("/instances/:id/stop", async (req, reply) => {
  const s = managed.get((req.params as any).id);
  if (!s)
    return reply.code(409).send({ ok: false, error: "Server is offline" });
  s.intentional = true;
  s.child.stdin.write(`${s.software === "velocity" ? "shutdown" : "stop"}\n`);
  return { ok: true };
});
app.post("/instances/:id/kill", async (req, reply) => {
  const s = managed.get((req.params as any).id);
  if (!s)
    return reply.code(409).send({ ok: false, error: "Server is offline" });
  s.intentional = true;
  s.child.kill("SIGKILL");
  return { ok: true };
});
app.get("/instances/:id/status", async (req) => {
  const id = (req.params as any).id;
  const s = managed.get(id);
  if (s) {
    let metrics = null;
    try {
      metrics = await pidusage(s.child.pid!);
    } catch {}
    let players = [...s.players];
    let playerCount = players.length;
    let maxPlayers: number | undefined;
    if (s.software === "velocity" && s.ready) {
      try {
        const ping = await pingMinecraft(s.host, s.port);
        players = (ping.players?.sample ?? []).map((player: any) => String(player.name ?? "")).filter((name: string) => /^[A-Za-z0-9_]{1,16}$/.test(name));
        playerCount = Number(ping.players?.online ?? players.length);
        maxPlayers = Number(ping.players?.max ?? 100);
      } catch {}
    }
    return {
      running: true,
      status: s.ready ? "online" : "starting",
      pid: s.child.pid,
      startedAt: s.startedAt,
      players,
      playerCount,
      ...(maxPlayers === undefined ? {} : { maxPlayers }),
      positions: [...s.positions].map(([name, position]) => ({
        name,
        ...position,
      })),
      positionTracking: s.software !== "velocity" && s.ready,
      logSequence: s.logSequence,
      metrics: metrics
        ? { cpu: metrics.cpu, memory: metrics.memory, elapsed: metrics.elapsed }
        : null,
      logs: s.logs.slice(-100),
      managed: true,
    };
  }
  const external = observed.get(id);
  if (!external)
    return {
      running: false,
      status: "offline",
      players: [],
      playerCount: 0,
      positions: [],
      positionTracking: false,
      logSequence: 0,
      managed: false,
    };
  let metrics = null;
  try {
    metrics = await pidusage(external.pid);
  } catch {}
  let status: any = null;
  try {
    status = await pingMinecraft(external.host, external.port);
  } catch {}
  const players = (status?.players?.sample ?? [])
    .map((player: any) => String(player.name ?? ""))
    .filter((name: string) => /^[A-Za-z0-9_]{1,16}$/.test(name));
  return {
    running: Boolean(status),
    status: status ? "online" : "offline",
    pid: external.pid,
    players,
    playerCount: Number(status?.players?.online ?? players.length),
    maxPlayers: Number(status?.players?.max ?? 20),
    positions: [],
    positionTracking: false,
    logSequence: 0,
    metrics: metrics
      ? { cpu: metrics.cpu, memory: metrics.memory, elapsed: metrics.elapsed }
      : null,
    managed: false,
    external: true,
    controlReady: false,
    version: status?.version?.name ?? null,
  };
});
app.get("/instances/:id/logs", { websocket: true }, (socket, req) => {
  const id = (req.params as any).id;
  const set = sockets.get(id) ?? new Set();
  set.add(socket);
  sockets.set(id, set);
  const s = managed.get(id);
  for (const line of s?.logs.slice(-200) ?? [])
    socket.send(
      JSON.stringify({
        type: "console",
        level: "info",
        line,
        at: new Date().toISOString(),
      }),
    );
  socket.on("close", () => {
    set.delete(socket);
    if (!set.size) sockets.delete(id);
  });
});
const port = Number(process.env.SALVADIUX_AGENT_PORT ?? 3211);
await app.listen({ host: "127.0.0.1", port });
