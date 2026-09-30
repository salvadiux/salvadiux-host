import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import os from "node:os";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  promises as fs,
} from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import archiver from "archiver";
import extract from "extract-zip";
import { CronExpressionParser } from "cron-parser";
import { eq, desc, lt } from "drizzle-orm";
import { WebSocket } from "ws";
import {
  createDatabase,
  instances,
  activityEvents,
  installedPlugins,
  backups,
  scheduledTasks,
  appSettings,
  statsHistory,
  networks,
  networkMembers,
} from "@salvadiux/database";
import { safeResolve, isTextFile } from "@salvadiux/filesystem";
import { parseProperties, updateProperties } from "@salvadiux/config-engine";
import { countLoadedChunks, createBlockTextureAtlas, findWorldRegions, findWorldSpawn, renderMapTile } from "./map.js";
import { registerNetworkRoutes } from "./network.js";
import {
  downloadFile,
  ensureRuntime,
  installServer,
  installerRegistry,
} from "@salvadiux/minecraft";
import { compatible, providerRegistry } from "@salvadiux/providers";
import {
  capabilities,
  instanceCreateSchema,
  type Software,
} from "@salvadiux/shared";

try { process.loadEnvFile(resolve(process.cwd(), ".env")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
const dataDir = resolve(process.env.SALVADIUX_DATA_DIR ?? "data");
mkdirSync(dataDir, { recursive: true });
const { db } = createDatabase(join(dataDir, "salvadiux.sqlite"));
const app = Fastify({ logger: true, bodyLimit: 64 * 1024 * 1024 });
await app.register(cors, {
  origin: process.env.SALVADIUX_DASHBOARD_ORIGIN ?? "http://127.0.0.1:5173",
  credentials: true,
});
await app.register(websocket);
await app.register(multipart, { limits: { fileSize: 1024 * 1024 * 1024 } });
const sessionToken = process.env.SALVADIUX_SESSION_TOKEN ?? "dev-session-token";
const agentToken = process.env.SALVADIUX_AGENT_TOKEN ?? "dev-agent-token";
const agentUrl = `http://127.0.0.1:${process.env.SALVADIUX_AGENT_PORT ?? 3211}`;
const ok = <T>(data: T) => ({ ok: true, data });
const fail = (code: string, message: string, status = 400) => ({
  status,
  payload: {
    ok: false,
    error: { code, message, userMessage: message, recoverable: status < 500 },
  },
});
async function agent(path: string, init?: RequestInit) {
  const response = await fetch(`${agentUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${agentToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response
    .json()
    .catch(() => ({ error: `Agent returned ${response.status}` }));
  if (!response.ok)
    throw new Error((body as any).error ?? "Agent operation failed");
  return body;
}
app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/api/health") return;
  if (req.url.startsWith("/api/internal/networks/")) return;
  const supplied =
    req.headers.authorization?.replace(/^Bearer /, "") ??
    (req.query as any)?.token;
  if (supplied !== sessionToken)
    return reply
      .code(401)
      .send(fail("UNAUTHORIZED", "Authentication required", 401).payload);
});
app.setErrorHandler((error, req, reply) => {
  req.log.error(error);
  const status = (error as any).statusCode ?? 500;
  reply
    .code(status)
    .send(fail("REQUEST_FAILED", (error as Error).message, status).payload);
});
const getInstance = async (id: string) => {
  const [row] = await db.select().from(instances).where(eq(instances.id, id));
  if (!row)
    throw Object.assign(new Error("Instance not found"), { statusCode: 404 });
  return row;
};
const activity = async (
  instanceId: string | undefined,
  type: string,
  message: string,
  details?: unknown,
) => {
  await db.insert(activityEvents).values({
    id: randomUUID(),
    instanceId,
    type,
    message,
    detailsJson: details ? JSON.stringify(details) : null,
    createdAt: new Date().toISOString(),
  });
  if (instanceId && customDiscordTriggers.has(type)) void dispatchDiscordEvent(instanceId, type, { event: message }).catch((error) => app.log.warn({ err: error }, "Discord notification failed"));
};
async function startInstanceById(id: string) {
  const instance = await getInstance(id);
  const state: any = await agent(`/instances/${id}/status`);
  if (state.running) return { status: state.status ?? "online", alreadyRunning: true };
  const port: any = await agent(`/instances/${id}/port-check?host=${encodeURIComponent(instance.host)}&port=${instance.port}`);
  if (!port.available) throw Object.assign(new Error(`Port ${instance.port} for ${instance.name} is already in use`), { statusCode: 409 });
  const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";
  const architecture = process.arch === "arm64" ? "aarch64" : process.arch;
  const runtime = JSON.parse(await fs.readFile(join(dataDir, "runtimes", `java${instance.javaMajor}-${platform}-${architecture}`, "runtime.json"), "utf8"));
  const result: any = await agent(`/instances/${id}/start`, { method: "POST", body: JSON.stringify({ javaPath: runtime.javaPath, cwd: instance.path, minMemoryMb: instance.minMemoryMb, maxMemoryMb: instance.maxMemoryMb, software: instance.software, host: instance.host, port: instance.port }) });
  await db.update(instances).set({ status: "starting", pid: result.pid, updatedAt: new Date().toISOString() }).where(eq(instances.id, id));
  await activity(id, "instance.started", "Server start requested");
  return { ...result, status: "starting", alreadyRunning: false };
}
async function stopInstanceById(id: string) {
  await getInstance(id);
  const state: any = await agent(`/instances/${id}/status`);
  if (!state.running) {
    await db.update(instances).set({ status: "offline", pid: null, updatedAt: new Date().toISOString() }).where(eq(instances.id, id));
    return { status: "offline", alreadyStopped: true };
  }
  await agent(`/instances/${id}/stop`, { method: "POST", body: "{}" });
  await db.update(instances).set({ status: "stopping", updatedAt: new Date().toISOString() }).where(eq(instances.id, id));
  await activity(id, "instance.stopped", "Clean server stop requested");
  return { status: "stopping", alreadyStopped: false };
}
registerNetworkRoutes(app, { db, getInstance, agent, activity, ok, safeResolve, updateProperties, startInstance: startInstanceById, stopInstance: stopInstanceById });

type DiscordTemplate = { id: string; name: string; mode: "message" | "embed"; content: string; title: string; description: string; color: string; imageData: string | null };
type DiscordCustomEvent = { id: string; name: string; trigger: string; enabled: boolean; template: DiscordTemplate };
type DiscordConfig = { enabled: boolean; events: string[]; templates: DiscordTemplate[]; customEvents: DiscordCustomEvent[]; webhookCipher?: string };
const defaultDiscordTemplates: DiscordTemplate[] = [
  { id: "server-online", name: "Server online", mode: "embed", content: "", title: "🟢 {{server}} is online", description: "The Minecraft server is ready at **{{address}}**.", color: "#30d158", imageData: null },
  { id: "server-offline", name: "Server offline", mode: "embed", content: "", title: "⚫ {{server}} is offline", description: "The Minecraft server has stopped.", color: "#8e8e93", imageData: null },
  { id: "player-join", name: "Player joined", mode: "embed", content: "", title: "👋 {{player}} joined", description: "There are now **{{count}}** players online.", color: "#0a84ff", imageData: null },
  { id: "player-leave", name: "Player left", mode: "message", content: "👋 **{{player}}** left {{server}} · {{count}} players online.", title: "", description: "", color: "#0a84ff", imageData: null },
  { id: "player-death", name: "Player died", mode: "embed", content: "", title: "☠️ {{player}} died", description: "A player has fallen in **{{server}}**. {{count}} players remain online.", color: "#ff453a", imageData: null },
  { id: "backup-created", name: "Backup created", mode: "embed", content: "", title: "📦 Backup complete", description: "A backup for **{{server}}** has been created.", color: "#bf5af2", imageData: null },
  { id: "community", name: "Scarll Universe", mode: "embed", content: "", title: "🌌 Scarll Universe", description: "Join the community: https://discord.gg/XnJjTqyKDM", color: "#a855f7", imageData: null },
];
const defaultDiscordEvents = ["server.online", "server.offline", "player.join", "player.leave", "player.death", "backup.created"];
const defaultDiscordConfig = (): DiscordConfig => ({ enabled: false, events: [...defaultDiscordEvents], templates: structuredClone(defaultDiscordTemplates), customEvents: [] });
const discordSettingsKey = (id: string) => `discord:${id}`;
async function readDiscordConfig(instanceId: string): Promise<DiscordConfig> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, discordSettingsKey(instanceId)));
  if (!row) return defaultDiscordConfig();
  try {
    const defaults = defaultDiscordConfig(), stored = JSON.parse(row.valueJson) as Partial<DiscordConfig>;
    return { ...defaults, ...stored, templates: defaults.templates.map((template) => ({ ...template, ...(stored.templates ?? []).find((saved) => saved.id === template.id) })), customEvents: stored.customEvents ?? defaults.customEvents };
  }
  catch { return defaultDiscordConfig(); }
}
async function writeDiscordConfig(instanceId: string, value: DiscordConfig) {
  const now = new Date().toISOString();
  await db.insert(appSettings).values({ key: discordSettingsKey(instanceId), valueJson: JSON.stringify(value), updatedAt: now }).onConflictDoUpdate({ target: appSettings.key, set: { valueJson: JSON.stringify(value), updatedAt: now } });
}
let discordKeyPromise: Promise<Buffer> | undefined;
function discordEncryptionKey(): Promise<Buffer> {
  discordKeyPromise ??= (async () => {
    const keyPath = join(dataDir, ".discord-webhook-key");
    try { return await fs.readFile(keyPath); }
    catch {
      const key = randomBytes(32);
      try { await fs.writeFile(keyPath, key, { flag: "wx", mode: 0o600 }); return key; }
      catch { return fs.readFile(keyPath); }
    }
  })();
  return discordKeyPromise;
}
async function encryptWebhook(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await discordEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}
async function decryptWebhook(value?: string) {
  if (!value) return null;
  try {
    const [, iv, tag, body] = value.split(".");
    if (!iv || !tag || !body) return null;
    const decipher = createDecipheriv("aes-256-gcm", await discordEncryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch { return null; }
}
function validateDiscordWebhook(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Enter a valid Discord webhook URL."); }
  if (url.protocol !== "https:" || !["discord.com", "discordapp.com"].includes(url.hostname) || !/^\/api\/webhooks\/\d+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname)) throw new Error("Only HTTPS Discord webhook URLs are supported.");
  return url.toString();
}
function imageAttachment(template: DiscordTemplate) {
  if (!template.imageData) return null;
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(template.imageData);
  if (!match) throw new Error("The image must be PNG, JPG, WebP, or GIF.");
  const mime = match[1]!;
  const data = Buffer.from(match[2]!, "base64");
  if (!data.length || data.length > 4_000_000) throw new Error("Discord images must be smaller than 4 MB.");
  const extension = mime === "image/jpeg" ? "jpg" : mime.split("/")[1] ?? "png";
  return { data, mime, fileName: `salvadiux-image.${extension}` };
}
function fillTemplate(value: string, variables: Record<string, string>) {
  return value.replace(/\{\{(server|address|player|count|event)\}\}/gi, (_match, name: string) => variables[name.toLowerCase()] ?? "");
}
async function postDiscordWebhook(url: string, template: DiscordTemplate, variables: Record<string, string>) {
  const attachment = imageAttachment(template);
  const content = fillTemplate(template.content, variables).slice(0, 2000);
  const payload: Record<string, unknown> = { allowed_mentions: { parse: [] } };
  if (template.mode === "embed") {
    const color = /^#[0-9a-f]{6}$/i.test(template.color) ? parseInt(template.color.slice(1), 16) : 0x0a84ff;
    payload.embeds = [{ title: fillTemplate(template.title, variables).slice(0, 256), description: fillTemplate(template.description, variables).slice(0, 4096), color, timestamp: new Date().toISOString(), ...(attachment ? { image: { url: `attachment://${attachment.fileName}` } } : {}) }];
    if (content) payload.content = content;
  } else payload.content = content;
  try {
    const response = attachment ? await (async () => {
      const form = new FormData();
      form.set("payload_json", JSON.stringify(payload));
      form.append("files[0]", new Blob([new Uint8Array(attachment.data)], { type: attachment.mime }), attachment.fileName);
      return fetch(url, { method: "POST", body: form, redirect: "error", signal: AbortSignal.timeout(10_000) });
    })() : await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Discord returned HTTP ${response.status}.`);
  } catch (error) { throw new Error(error instanceof Error ? error.message : "Discord webhook delivery failed."); }
}
const templateForEvent: Record<string, string> = { "server.online": "server-online", "server.offline": "server-offline", "player.join": "player-join", "player.leave": "player-leave", "player.death": "player-death", "backup.created": "backup-created" };
async function dispatchDiscordEvent(instanceId: string, event: string, variables: Record<string, string> = {}) {
  try {
    const config = await readDiscordConfig(instanceId);
    if (!config.enabled) return;
    const webhook = await decryptWebhook(config.webhookCipher);
    if (!webhook) return;
    const instance = await getInstance(instanceId);
    const context = { server: instance.name, address: `${instance.host}:${instance.port}`, ...variables };
    if (config.events.includes(event)) {
      const template = config.templates.find((item) => item.id === templateForEvent[event]);
      if (template) await postDiscordWebhook(webhook, template, context);
    }
    for (const custom of config.customEvents ?? []) if (custom.enabled && custom.trigger === event) await postDiscordWebhook(webhook, custom.template, { ...context, event: custom.name });
  } catch (error) { app.log.warn({ err: error, instanceId, event }, "Discord webhook notification failed"); }
}
async function sendCustomDiscordEvent(instanceId: string, eventId: string) {
  const config = await readDiscordConfig(instanceId);
  if (!config.enabled) throw new Error("Enable Discord notifications first.");
  const webhook = await decryptWebhook(config.webhookCipher);
  if (!webhook) throw new Error("Connect a Discord webhook first.");
  const event = config.customEvents.find((item) => item.id === eventId);
  if (!event) throw Object.assign(new Error("Custom announcement not found."), { statusCode: 404 });
  const instance = await getInstance(instanceId);
  await postDiscordWebhook(webhook, event.template, { server: instance.name, address: `${instance.host}:${instance.port}`, event: event.name, player: "", count: "0" });
}

app.get("/api/health", async () => {
  let agentState = "unavailable";
  try {
    await agent("/health");
    agentState = "ready";
  } catch {}
  return ok({
    api: "ready",
    database: "ready",
    agent: agentState,
    version: "0.1.0",
  });
});
let lastCpuSnapshot: { idle: number; total: number } | null = null;
app.get("/api/system/stats", async () => {
  const cpus = os.cpus();
  const load = os.platform() === "win32" ? null : os.loadavg();
  const cpuSnapshot = cpus.reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle, total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });
  const cpuUsage = lastCpuSnapshot && cpuSnapshot.total > lastCpuSnapshot.total
    ? Math.max(0, Math.min(100, (1 - (cpuSnapshot.idle - lastCpuSnapshot.idle) / (cpuSnapshot.total - lastCpuSnapshot.total)) * 100))
    : null;
  lastCpuSnapshot = cpuSnapshot;
  return ok({
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    hostname: os.hostname(),
    cpuModel: cpus[0]?.model ?? "Unknown",
    cpuCores: cpus.length,
    cpuUsage,
    loadAverage: load,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    uptime: os.uptime(),
    nodeVersion: process.version,
    processMemory: process.memoryUsage(),
  });
});
let historyCpuSnapshot: { idle: number; total: number } | null = null;
async function collectHistoricalMetrics() {
  const now = new Date();
  const cpus = os.cpus();
  const cpu = cpus.reduce((sum, item) => ({ idle: sum.idle + item.times.idle, total: sum.total + Object.values(item.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });
  const hostCpu = historyCpuSnapshot && cpu.total > historyCpuSnapshot.total ? Math.max(0, Math.min(100, (1 - (cpu.idle - historyCpuSnapshot.idle) / (cpu.total - historyCpuSnapshot.total)) * 100)) : null;
  historyCpuSnapshot = cpu;
  const hostMemory = os.totalmem() - os.freemem();
  const servers = await db.select().from(instances);
  for (const instance of servers) {
    try {
      if (instance.pid) await agent(`/instances/${instance.id}/observe`, { method: "POST", body: JSON.stringify({ pid: instance.pid, host: "127.0.0.1", port: instance.port }) });
      const state: any = await agent(`/instances/${instance.id}/status`);
      await db.insert(statsHistory).values({ id: randomUUID(), instanceId: instance.id, sampledAt: now.toISOString(), serverCpu: state.metrics?.cpu ?? null, serverMemory: state.metrics?.memory ?? null, players: state.running ? Number(state.playerCount ?? state.players?.length ?? 0) : 0, hostCpu, hostMemory, hostMemoryTotal: os.totalmem() });
    } catch (error) { app.log.debug({ err: error, instanceId: instance.id }, "Metrics sample skipped"); }
  }
  const keepAfter = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString();
  await db.delete(statsHistory).where(lt(statsHistory.sampledAt, keepAfter));
}
const metricSampler = setInterval(() => { void collectHistoricalMetrics().catch((error) => app.log.warn({ err: error }, "Historical metric sample failed")); }, 60_000);
metricSampler.unref();
void collectHistoricalMetrics().catch((error) => app.log.warn({ err: error }, "Initial metric sample failed"));
app.get("/api/instances/:id/metrics/history", async (req) => {
  const instanceId = (req.params as any).id;
  await getInstance(instanceId);
  const requestedHours = Number((req.query as any)?.hours ?? 24);
  const hours = Number.isFinite(requestedHours) ? Math.max(1, Math.min(168, requestedHours)) : 24;
  const since = new Date(Date.now() - hours * 60 * 60_000).toISOString();
  const rows = await db.select().from(statsHistory).where(eq(statsHistory.instanceId, instanceId)).orderBy(desc(statsHistory.sampledAt)).limit(Math.min(hours * 60 + 5, 10_085));
  return ok(rows.filter((row) => row.sampledAt >= since).reverse());
});
app.get("/api/instances/:id/storage", async (req) => {
  const instance = await getInstance((req.params as any).id);
  const stats = await fs.statfs(instance.path);
  const blockSize = Number(stats.bsize);
  const total = Number(stats.blocks) * blockSize;
  const free = Number(stats.bavail) * blockSize;
  return ok({ total, free, used: Math.max(0, total - free), path: instance.path });
});
app.get("/api/software", async () =>
  ok(
    [...installerRegistry.values()].map((i) => ({
      id: i.id,
      name: i.displayName,
      capabilities: capabilities[i.id],
    })),
  ),
);
app.get("/api/software/:software/versions", async (req) => {
  const i = installerRegistry.get((req.params as any).software);
  if (!i) throw new Error("Unsupported software");
  return ok(await i.getVersions((req.query as any).snapshots === "true"));
});
app.get("/api/software/:software/versions/:version/builds", async (req) => {
  const p = req.params as any;
  const i = installerRegistry.get(p.software);
  if (!i) throw new Error("Unsupported software");
  return ok(await i.getBuilds(p.version));
});
app.get("/api/instances", async () =>
  ok(
    await db
      .select()
      .from(instances)
      .orderBy(desc(instances.favorite), desc(instances.updatedAt)),
  ),
);
app.get("/api/instances/:id", async (req) =>
  ok(await getInstance((req.params as any).id)),
);
app.post("/api/instances", async (req, reply) => {
  const input = instanceCreateSchema.parse(req.body);
  const id = randomUUID();
  const root = join(dataDir, "servers", id);
  const now = new Date().toISOString();
  const installer = installerRegistry.get(input.software)!;
  const javaMajor = await installer.resolveJavaRequirement(input.software === "velocity" ? input.softwareVersion! : input.minecraftVersion);
  const runtime = await ensureRuntime(dataDir, javaMajor);
  const build = await installServer({ path: root, ...input, softwareVersion: input.softwareVersion });
  await db.insert(instances).values({
    id,
    name: input.name,
    description: input.description,
    software: input.software,
    softwareVersion: input.softwareVersion ?? null,
    minecraftVersion: input.minecraftVersion,
    build: build.id,
    path: root,
    status: "offline",
    minMemoryMb: input.minMemoryMb,
    maxMemoryMb: input.maxMemoryMb,
    host: input.host,
    port: input.port,
    javaMajor,
    runtimeId: runtime.id,
    pid: null,
    favorite: false,
    restartRequired: false,
    createdAt: now,
    updatedAt: now,
  });
  await activity(id, "instance.created", `Created ${input.name}`, {
    software: input.software,
    version: input.software === "velocity" ? input.softwareVersion : input.minecraftVersion,
  });
  return reply.code(201).send(ok(await getInstance(id)));
});
app.patch("/api/instances/:id", async (req) => {
  const id = (req.params as any).id;
  const current = await getInstance(id);
  const b = req.body as any;
  const values: any = { updatedAt: new Date().toISOString() };
  for (const k of ["name", "description", "favorite", "restartRequired"])
    if (b[k] !== undefined) values[k] = b[k];
  await db.update(instances).set(values).where(eq(instances.id, id));
  if (b.name && b.name !== current.name)
    await activity(id, "instance.renamed", `Renamed server to ${b.name}`);
  return ok(await getInstance(id));
});
app.delete("/api/instances/:id", async (req) => {
  const id = (req.params as any).id;
  const current = await getInstance(id);
  const [proxyNetwork] = await db.select().from(networks).where(eq(networks.proxyInstanceId, id));
  const [backendNetwork] = await db.select().from(networkMembers).where(eq(networkMembers.instanceId, id));
  if (proxyNetwork || backendNetwork) throw Object.assign(new Error("Remove this instance from its configured network and restore the network files first."), { statusCode: 409 });
  const state = await agent(`/instances/${id}/status`);
  if ((state as any).running)
    throw Object.assign(new Error("Stop the server before deleting it"), {
      statusCode: 409,
    });
  await fs.rm(current.path, { recursive: true, force: true });
  await db.delete(instances).where(eq(instances.id, id));
  return ok({ deleted: id });
});
app.post("/api/instances/:id/start", async (req) => {
  return ok(await startInstanceById((req.params as any).id));
});
app.post("/api/instances/:id/stop", async (req) => {
  return ok(await stopInstanceById((req.params as any).id));
});
app.post("/api/instances/:id/kill", async (req) => {
  const id = (req.params as any).id;
  await agent(`/instances/${id}/kill`, { method: "POST", body: "{}" });
  await activity(id, "instance.killed", "Server process was force killed");
  return ok({ status: "offline" });
});
app.post("/api/instances/:id/restart", async (req) => {
  const id = (req.params as any).id;
  const i = await getInstance(id);
  await agent(`/instances/${id}/stop`, { method: "POST", body: "{}" });
  await db
    .update(instances)
    .set({ status: "restarting" })
    .where(eq(instances.id, id));
  for (let n = 0; n < 60; n++) {
    await new Promise((r) => setTimeout(r, 1000));
    const state: any = await agent(`/instances/${id}/status`);
    if (!state.running) break;
    if (n === 59) throw new Error("Server did not stop within 60 seconds");
  }
  const runtime = JSON.parse(
    await fs.readFile(
      join(
        dataDir,
        "runtimes",
        `java${i.javaMajor}-${process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux"}-${process.arch === "arm64" ? "aarch64" : process.arch}`,
        "runtime.json",
      ),
      "utf8",
    ),
  );
  const result = await agent(`/instances/${id}/start`, {
    method: "POST",
    body: JSON.stringify({
      javaPath: runtime.javaPath,
      cwd: i.path,
      minMemoryMb: i.minMemoryMb,
      maxMemoryMb: i.maxMemoryMb,
    }),
  });
  await db
    .update(instances)
    .set({
      status: "starting",
      pid: (result as any).pid,
      restartRequired: false,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(instances.id, id));
  await activity(id, "instance.restarted", "Server restarted cleanly");
  return ok({ status: "starting", pid: (result as any).pid });
});
app.post("/api/instances/:id/command", async (req) =>
  ok(
    await agent(`/instances/${(req.params as any).id}/command`, {
      method: "POST",
      body: JSON.stringify(req.body),
    }),
  ),
);
const observedRuntime = new Map<string, { status: string; players: Set<string>; logSequence: number }>();
app.get("/api/instances/:id/status", async (req) => {
  const id = (req.params as any).id;
  const instance = await getInstance(id);
  if (instance.pid) {
    await agent(`/instances/${id}/observe`, {
      method: "POST",
      body: JSON.stringify({ pid: instance.pid, host: "127.0.0.1", port: instance.port }),
    }).catch(() => undefined);
  }
  const state: any = await agent(`/instances/${id}/status`);
  const previous = observedRuntime.get(id);
  const currentPlayers = new Set<string>(state.players ?? []);
  if (state.status === "online" && previous?.status !== "online") void dispatchDiscordEvent(id, "server.online");
  if (previous?.status === "online" && state.status === "offline") void dispatchDiscordEvent(id, "server.offline");
  if (state.status === "online") {
    for (const player of currentPlayers) if (previous && !previous.players.has(player)) void dispatchDiscordEvent(id, "player.join", { player, count: String(currentPlayers.size) });
    for (const player of previous?.players ?? []) if (!currentPlayers.has(player)) void dispatchDiscordEvent(id, "player.leave", { player, count: String(currentPlayers.size) });
  }
  const logs: string[] = state.logs ?? [];
  const logBase = Number(state.logSequence ?? 0) - logs.length;
  if (previous && state.status === "online") for (let index = 0; index < logs.length; index++) {
    if (logBase + index + 1 <= previous.logSequence) continue;
    const death = logs[index]!.match(/:\s*([A-Za-z0-9_]{1,16}) (?:was|fell|drowned|burned|suffocated|starved|froze|tried|hit the ground|walked into|went up|experienced kinetic energy|discovered the floor|withered away)\b/i);
    if (death?.[1] && currentPlayers.has(death[1])) void dispatchDiscordEvent(id, "player.death", { player: death[1], count: String(currentPlayers.size) });
  }
  observedRuntime.set(id, { status: state.status, players: currentPlayers, logSequence: Number(state.logSequence ?? 0) });
  await db
    .update(instances)
    .set({
      status: state.status,
      pid: state.pid ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(instances.id, id));
  return ok(state);
});
app.get("/api/instances/:id/console", { websocket: true }, (socket, req) => {
  const id = (req.params as any).id;
  const upstream = new WebSocket(
    `${agentUrl.replace("http", "ws")}/instances/${id}/logs?token=${encodeURIComponent(agentToken)}`,
  );
  upstream.on(
    "message",
    (data) => socket.readyState === 1 && socket.send(data.toString()),
  );
  upstream.on("close", () => socket.close());
  upstream.on("error", () =>
    socket.send(
      JSON.stringify({ type: "error", message: "Agent console unavailable" }),
    ),
  );
  socket.on("close", () => upstream.close());
});

app.get("/api/instances/:id/files", async (req) => {
  const i = await getInstance((req.params as any).id);
  const rel = String((req.query as any).path ?? "");
  const target = safeResolve(i.path, rel);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const data = await Promise.all(
    entries.map(async (e) => {
      const p = join(target, e.name);
      const s = await fs.stat(p);
      return {
        name: e.name,
        path: relative(i.path, p).replaceAll("\\", "/"),
        type: e.isDirectory() ? "directory" : "file",
        size: s.size,
        modifiedAt: s.mtime.toISOString(),
        editable: e.isFile() && isTextFile(e.name),
      };
    }),
  );
  return ok(data);
});
app.get("/api/instances/:id/file", async (req) => {
  const i = await getInstance((req.params as any).id);
  const rel = String((req.query as any).path ?? "");
  const target = safeResolve(i.path, rel);
  const stat = await fs.stat(target);
  if (stat.size > 5 * 1024 * 1024)
    throw new Error("This file is too large to edit safely");
  if (!isTextFile(target))
    return ok({
      binary: true,
      name: basename(target),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  return ok({
    binary: false,
    content: await fs.readFile(target, "utf8"),
    name: basename(target),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  });
});
app.put("/api/instances/:id/file", async (req) => {
  const i = await getInstance((req.params as any).id);
  const b = req.body as any;
  const target = safeResolve(i.path, b.path);
  if (!isTextFile(target))
    throw new Error("Binary files cannot be edited as text");
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target)) {
    mkdirSync(join(i.path, ".salvadiux", "history"), { recursive: true });
    await fs.copyFile(
      target,
      join(
        i.path,
        ".salvadiux",
        "history",
        `${basename(target)}.${Date.now()}.bak`,
      ),
    );
  }
  await fs.writeFile(target, String(b.content), "utf8");
  await db
    .update(instances)
    .set({ restartRequired: true })
    .where(eq(instances.id, i.id));
  await activity(i.id, "file.updated", `Updated ${b.path}`);
  return ok({ saved: true, restartRequired: true });
});
app.post("/api/instances/:id/files", async (req) => {
  const i = await getInstance((req.params as any).id);
  const b = req.body as any;
  const target = safeResolve(i.path, b.path);
  if (b.type === "directory") await fs.mkdir(target, { recursive: false });
  else {
    mkdirSync(dirname(target), { recursive: true });
    await fs.writeFile(target, String(b.content ?? ""), { flag: "wx" });
  }
  return ok({ created: true });
});
app.post("/api/instances/:id/files/upload", async (req) => {
  const i = await getInstance((req.params as any).id);
  const upload = await req.file();
  if (!upload) throw Object.assign(new Error("Select a file to upload"), { statusCode: 400 });
  const name = basename(upload.filename.replaceAll("\\", "/"));
  if (!name || name === "." || name === "..") throw Object.assign(new Error("Invalid file name"), { statusCode: 400 });
  const directory = safeResolve(i.path, String((req.query as any).path ?? ""));
  const [realRoot, realDirectory] = await Promise.all([fs.realpath(i.path), fs.realpath(directory)]);
  const directoryRelative = relative(realRoot, realDirectory);
  if (directoryRelative === ".." || directoryRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(directoryRelative))
    throw Object.assign(new Error("Path escapes the instance directory"), { statusCode: 400 });
  const target = safeResolve(realDirectory, name);
  try { await pipeline(upload.file, createWriteStream(target, { flags: "wx" })); }
  catch (error) { await fs.rm(target, { force: true }); throw error; }
  if (upload.file.truncated) {
    await fs.rm(target, { force: true });
    throw Object.assign(new Error("The uploaded file exceeded the size limit"), { statusCode: 413 });
  }
  await db.update(instances).set({ restartRequired: true }).where(eq(instances.id, i.id));
  await activity(i.id, "file.uploaded", `Uploaded ${relative(i.path, target).replaceAll("\\", "/")}`);
  return ok({ uploaded: true, name });
});
app.post("/api/instances/:id/files/reveal", async (req) => {
  const i = await getInstance((req.params as any).id);
  const body = req.body as { path?: string; folder?: boolean };
  const target = safeResolve(i.path, String(body?.path ?? ""));
  const [realRoot, realTarget] = await Promise.all([fs.realpath(i.path), fs.realpath(target)]);
  const realRelative = relative(realRoot, realTarget);
  if (realRelative === ".." || realRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(realRelative))
    throw Object.assign(new Error("Path escapes the instance directory"), { statusCode: 400 });
  const stat = await fs.stat(realTarget);
  const isDirectory = stat.isDirectory();
  return ok(await agent("/files/reveal", {
    method: "POST",
    body: JSON.stringify({ path: realTarget, select: !body?.folder && !isDirectory }),
  }));
});
app.delete("/api/instances/:id/file", async (req) => {
  const i = await getInstance((req.params as any).id);
  const target = safeResolve(i.path, String((req.query as any).path ?? ""));
  if (target === i.path) throw new Error("Cannot delete the instance root");
  await fs.rm(target, { recursive: true, force: false });
  return ok({ deleted: true });
});
app.get("/api/instances/:id/config", async (req) => {
  const i = await getInstance((req.params as any).id);
  const path = safeResolve(i.path, i.software === "velocity" ? "velocity.toml" : "server.properties");
  const raw = await fs.readFile(path, "utf8");
  return ok({
    raw,
    values: parseProperties(raw),
    restartRequired: i.restartRequired,
  });
});
app.put("/api/instances/:id/config", async (req) => {
  const i = await getInstance((req.params as any).id);
  const path = safeResolve(i.path, i.software === "velocity" ? "velocity.toml" : "server.properties");
  const raw = await fs.readFile(path, "utf8");
  const b = req.body as any;
  if (i.software === "velocity" && b.raw === undefined) throw new Error("Velocity TOML must be saved from the raw editor.");
  const next =
    b.raw !== undefined ? String(b.raw) : updateProperties(raw, b.values ?? {});
  await fs.copyFile(path, `${path}.${Date.now()}.bak`);
  await fs.writeFile(path, next);
  await db
    .update(instances)
    .set({ restartRequired: true })
    .where(eq(instances.id, i.id));
  await activity(i.id, "configuration.changed", "Updated server.properties");
  return ok({ saved: true, restartRequired: true });
});

const decodeMotd = (value: string) =>
  value.replace(/\\u00a7/gi, "§").replace(/\\n/g, "\n");
const encodeMotd = (value: string) =>
  value.replace(/§/g, "\\u00A7").replace(/\r?\n/g, "\\n");
const plainMotd = (value: string) =>
  value
    .replace(/§[0-9a-fk-or]/gi, "")
    .replace(/<\/?(?:#[0-9a-f]{6}|[a-z_]+)>/gi, "")
    .replace(/\s*\n\s*/g, " · ")
    .trim();
const readTomlString = (raw: string, key: string, fallback = "") => {
  const match = raw.match(new RegExp(`^\\s*${key}\\s*=\\s*("(?:\\\\.|[^"\\\\])*")`, "m"));
  if (!match) return fallback;
  try { return JSON.parse(match[1]!); } catch { return fallback; }
};
const updateTomlString = (raw: string, key: string, value: string) => {
  const expression = new RegExp(`^\\s*${key}\\s*=\\s*.*$`, "m");
  const line = `${key} = ${JSON.stringify(value)}`;
  return expression.test(raw) ? raw.replace(expression, line) : `${raw.trimEnd()}\n${line}\n`;
};
app.get("/api/instances/:id/appearance", async (req) => {
  const i = await getInstance((req.params as any).id);
  const isVelocity = i.software === "velocity";
  const configPath = join(i.path, isVelocity ? "velocity.toml" : "server.properties");
  const raw = await fs.readFile(configPath, "utf8");
  const values = isVelocity ? null : parseProperties(raw);
  const iconPath = join(i.path, "server-icon.png");
  const icon = existsSync(iconPath)
    ? `data:image/png;base64,${(await fs.readFile(iconPath)).toString("base64")}`
    : null;
  return ok({
    name: i.name,
    description: i.description ?? "",
    motd: isVelocity ? readTomlString(raw, "motd") : decodeMotd(values?.motd ?? ""),
    icon,
    maxPlayers: Number(isVelocity ? readTomlString(raw, "show-max-players", "100") : values?.["max-players"] ?? 20),
    address: `${i.host}:${i.port}`,
    software: i.software,
  });
});
app.put("/api/instances/:id/appearance", async (req) => {
  const i = await getInstance((req.params as any).id);
  const b = req.body as any;
  const name = String(b.name ?? "").trim();
  const motd = String(b.motd ?? "");
  if (!name || name.length > 80)
    throw new Error("Server name must be between 1 and 80 characters");
  if (motd.length > 1000) throw new Error("Server description is too long");
  const isVelocity = i.software === "velocity";
  const configPath = join(i.path, isVelocity ? "velocity.toml" : "server.properties");
  const raw = await fs.readFile(configPath, "utf8");
  await fs.copyFile(configPath, `${configPath}.${Date.now()}.bak`);
  await fs.writeFile(configPath, isVelocity ? updateTomlString(raw, "motd", motd) : updateProperties(raw, { motd: encodeMotd(motd) }));
  if (b.icon !== undefined) {
    const iconPath = join(i.path, "server-icon.png");
    if (b.icon === null) {
      await fs.rm(iconPath, { force: true });
    } else {
      const match = String(b.icon).match(
        /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/,
      );
      if (!match) throw new Error("The server icon must be a PNG image");
      const buffer = Buffer.from(match[1]!, "base64");
      if (
        buffer.length > 2 * 1024 * 1024 ||
        buffer.length < 24 ||
        buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a"
      )
        throw new Error("The server icon is not a valid PNG image");
      if (buffer.readUInt32BE(16) !== 64 || buffer.readUInt32BE(20) !== 64)
        throw new Error("The server icon must be exactly 64 by 64 pixels");
      if (existsSync(iconPath))
        await fs.copyFile(iconPath, `${iconPath}.${Date.now()}.bak`);
      await fs.writeFile(iconPath, buffer);
    }
  }
  await db
    .update(instances)
    .set({
      name,
      description: String(b.description ?? plainMotd(motd)).slice(0, 500),
      restartRequired: true,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(instances.id, i.id));
  await activity(
    i.id,
    "appearance.changed",
    `Updated ${isVelocity ? "Velocity proxy" : "server"} name, MOTD, and icon`,
  );
  return ok({ saved: true, restartRequired: true });
});

app.get("/api/instances/:id/plugins/search", async (req) => {
  const i = await getInstance((req.params as any).id);
  if (!capabilities[i.software as Software].plugins)
    throw Object.assign(
      new Error("This server software does not support plugins"),
      { statusCode: 409 },
    );
  const q = String((req.query as any).q ?? "");
  const providers = String(
    (req.query as any).provider ?? "hangar,modrinth",
  ).split(",");
  const target = {
    minecraftVersion: i.minecraftVersion,
    software: i.software as Software,
    capabilities: Object.entries(capabilities[i.software as Software])
      .filter(([, v]) => v)
      .map(([k]) => k),
  };
  const results = await Promise.allSettled(
    providers.map((p) => providerRegistry.get(p)?.search(q, target) ?? []),
  );
  return ok(results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])));
});
const recommendedPluginCache = new Map<string, { expiresAt: number; projects: unknown[] }>();
app.get("/api/instances/:id/plugins/recommended", async (req) => {
  const i = await getInstance((req.params as any).id);
  if (!capabilities[i.software as Software].plugins) return ok([]);
  const cacheKey = `${i.software}:${i.minecraftVersion}`;
  const cached = recommendedPluginCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return ok(cached.projects);
  const target = { minecraftVersion: i.minecraftVersion, software: i.software as Software, capabilities: Object.entries(capabilities[i.software as Software]).filter(([, value]) => value).map(([key]) => key) };
  const suggestions = ["LuckPerms", "EssentialsX", "WorldEdit", "ViaVersion", "CoreProtect"];
  const matches = await Promise.all(suggestions.map(async (suggestion) => {
    try {
      const candidates = await providerRegistry.get("modrinth")!.search(suggestion, target);
      const normalized = suggestion.toLowerCase().replace(/[^a-z0-9]/g, "");
      const project = candidates.find((candidate) => `${candidate.name} ${candidate.slug ?? ""}`.toLowerCase().replace(/[^a-z0-9]/g, "").includes(normalized));
      if (!project) return null;
      const versions = await providerRegistry.get(project.provider)!.getVersions(project.id, target);
      const compatibleRelease = versions.some((version) => version.releaseType === "release" && compatible(version, target));
      return compatibleRelease ? { ...project, recommendation: suggestion } : null;
    } catch (error) { app.log.debug({ err: error, suggestion }, "Plugin recommendation unavailable"); return null; }
  }));
  const projects = matches.filter(Boolean);
  recommendedPluginCache.set(cacheKey, { expiresAt: Date.now() + 15 * 60_000, projects });
  return ok(projects);
});
app.get(
  "/api/instances/:id/plugins/:provider/:project/versions",
  async (req) => {
    const i = await getInstance((req.params as any).id);
    const p = req.params as any;
    const provider = providerRegistry.get(p.provider);
    if (!provider) throw new Error("Unknown provider");
    const target = {
      minecraftVersion: i.minecraftVersion,
      software: i.software as Software,
      capabilities: [],
    };
    const versions = await provider.getVersions(p.project, target);
    return ok(
      versions.map((v) => ({ ...v, compatible: compatible(v, target) })),
    );
  },
);
app.post("/api/instances/:id/plugins/install", async (req) => {
  const i = await getInstance((req.params as any).id);
  const b = req.body as any;
  const provider = providerRegistry.get(b.provider);
  if (!provider) throw new Error("Unknown provider");
  const target = {
    minecraftVersion: i.minecraftVersion,
    software: i.software as Software,
    capabilities: [],
  };
  const versions = await provider.getVersions(b.projectId, target);
  const version = versions.find((v) => v.id === b.versionId);
  if (!version || !compatible(version, target))
    throw new Error("A compatible plugin file could not be resolved");
  const file = join(i.path, "plugins", basename(version.fileName));
  const [existing] = await db.select().from(installedPlugins).where(eq(installedPlugins.instanceId, i.id)).then((rows) => rows.filter((row) => row.provider === b.provider && row.projectId === b.projectId));
  let previousFile: string | null = null;
  if (existing) {
    const existingPath = safeResolve(join(i.path, "plugins"), existing.fileName);
    if (!existingPath) throw new Error("Unsafe installed plugin path");
    if (existsSync(existingPath)) {
      const rollbackDir = join(i.path, ".salvadiux", "plugin-rollback");
      await fs.mkdir(rollbackDir, { recursive: true });
      previousFile = `.salvadiux/plugin-rollback/${randomUUID()}-${existing.fileName}`;
      await fs.copyFile(existingPath, safeResolve(i.path, previousFile)!);
    }
    if (existingPath !== file) await fs.rm(existingPath, { force: true });
  }
  await downloadFile(
    version.fileUrl,
    file,
    version.hashes?.sha256
      ? { algorithm: "sha256", value: version.hashes.sha256 }
      : version.hashes?.sha1
        ? { algorithm: "sha1", value: version.hashes.sha1 }
        : undefined,
  );
  if (existing) await db.update(installedPlugins).set({ versionId: version.id, name: b.name ?? version.name, fileName: basename(file), previousFile, installedAt: new Date().toISOString() }).where(eq(installedPlugins.id, existing.id));
  else await db.insert(installedPlugins).values({ id: randomUUID(), instanceId: i.id, provider: b.provider, projectId: b.projectId, versionId: version.id, name: b.name ?? version.name, fileName: basename(file), managed: true, previousFile: null, installedAt: new Date().toISOString() });
  await db
    .update(instances)
    .set({ restartRequired: true })
    .where(eq(instances.id, i.id));
  await activity(
    i.id,
    "plugin.installed",
    `Installed ${b.name ?? version.name}`,
    { provider: b.provider },
  );
  return ok({
    installed: true,
    fileName: basename(file),
    restartRequired: true,
  });
});
app.post("/api/instances/:id/plugins/:pluginId/rollback", async (req) => {
  const i = await getInstance((req.params as any).id);
  const state: any = await agent(`/instances/${i.id}/status`);
  if (state.running) throw Object.assign(new Error("Stop the server before rolling back a plugin"), { statusCode: 409 });
  const [plugin] = await db.select().from(installedPlugins).where(eq(installedPlugins.id, (req.params as any).pluginId));
  if (!plugin || plugin.instanceId !== i.id || !plugin.managed || !plugin.previousFile) throw new Error("No managed rollback is available for this plugin");
  const oldPath = safeResolve(i.path, plugin.previousFile);
  const currentPath = safeResolve(join(i.path, "plugins"), plugin.fileName);
  if (!oldPath || !currentPath || !existsSync(oldPath)) throw new Error("The saved plugin rollback file is missing");
  const backupName = basename(plugin.previousFile);
  const restoredName = backupName.replace(/^[0-9a-f-]{36}-/, "");
  if (!restoredName || restoredName.includes("/")) throw new Error("Invalid rollback filename");
  const restoredPath = safeResolve(join(i.path, "plugins"), restoredName);
  if (!restoredPath) throw new Error("Invalid rollback destination");
  const rollbackDir = join(i.path, ".salvadiux", "plugin-rollback");
  await fs.mkdir(rollbackDir, { recursive: true });
  const newPrevious = `.salvadiux/plugin-rollback/${randomUUID()}-${plugin.fileName}`;
  await fs.copyFile(currentPath, safeResolve(i.path, newPrevious)!);
  await fs.copyFile(oldPath, restoredPath);
  if (currentPath !== restoredPath) await fs.rm(currentPath, { force: true });
  await db.update(installedPlugins).set({ fileName: restoredName, previousFile: newPrevious, installedAt: new Date().toISOString() }).where(eq(installedPlugins.id, plugin.id));
  await db.update(instances).set({ restartRequired: true }).where(eq(instances.id, i.id));
  await activity(i.id, "plugin.rollback", `Rolled back ${plugin.name}`);
  return ok({ rolledBack: true, fileName: restoredName, restartRequired: true });
});
app.get("/api/instances/:id/plugins", async (req) => {
  const i = await getInstance((req.params as any).id);
  const tracked = await db
    .select()
    .from(installedPlugins)
    .where(eq(installedPlugins.instanceId, i.id));
  const files = existsSync(join(i.path, "plugins"))
    ? (await fs.readdir(join(i.path, "plugins"))).filter((x) =>
        x.endsWith(".jar"),
      )
    : [];
  return ok(
    files.map(
      (file) =>
        tracked.find((p) => p.fileName === file) ?? {
          id: file,
          instanceId: i.id,
          name: file,
          fileName: file,
          managed: false,
          provider: null,
          versionId: null,
          projectId: null,
          installedAt: null,
        },
    ),
  );
});

async function zipDirectory(
  source: string,
  destination: string,
  ignore: string[] = [],
) {
  await new Promise<void>((res, rej) => {
    const output = createWriteStream(destination);
    const archive = archiver("zip", { zlib: { level: 6 } });
    output.on("close", res);
    archive.on("error", rej);
    archive.pipe(output);
    archive.glob("**/*", { cwd: source, ignore, dot: true });
    void archive.finalize();
  });
}
app.get("/api/instances/:id/backups", async (req) =>
  ok(
    await db
      .select()
      .from(backups)
      .where(eq(backups.instanceId, (req.params as any).id))
      .orderBy(desc(backups.createdAt)),
  ),
);
app.post("/api/instances/:id/backups", async (req) => {
  const i = await getInstance((req.params as any).id);
  const id = randomUUID(),
    createdAt = new Date().toISOString(),
    name =
      (req.body as any)?.name ?? `backup-${createdAt.replace(/[:.]/g, "-")}`;
  const path = join(i.path, "backups", `${id}.zip`);
  await zipDirectory(i.path, path, ["backups/**", "logs/**"]);
  const stat = await fs.stat(path);
  await db.insert(backups).values({
    id,
    instanceId: i.id,
    path,
    name,
    size: stat.size,
    description: (req.body as any)?.description,
    automatic: false,
    createdAt,
  });
  await activity(i.id, "backup.created", `Created backup ${name}`);
  return ok({ id, name, size: stat.size, createdAt });
});
app.post("/api/instances/:id/backups/:backupId/restore", async (req) => {
  const i = await getInstance((req.params as any).id);
  const state: any = await agent(`/instances/${i.id}/status`);
  if (state.running)
    throw Object.assign(
      new Error("Stop the server before restoring a backup"),
      { statusCode: 409 },
    );
  const [backup] = await db
    .select()
    .from(backups)
    .where(eq(backups.id, (req.params as any).backupId));
  if (!backup || backup.instanceId !== i.id)
    throw new Error("Backup not found");
  const safety = join(i.path, "backups", `safety-${Date.now()}.zip`);
  await zipDirectory(i.path, safety, ["backups/**", "logs/**"]);
  await extract(backup.path, {
    dir: i.path,
    onEntry(entry) {
      const target = safeResolve(i.path, entry.fileName);
      if (!target) throw new Error("Unsafe archive entry");
    },
  });
  await activity(i.id, "backup.restored", `Restored backup ${backup.name}`);
  return ok({ restored: true, safetySnapshot: safety });
});
app.delete("/api/instances/:id/backups/:backupId", async (req) => {
  const [b] = await db
    .select()
    .from(backups)
    .where(eq(backups.id, (req.params as any).backupId));
  if (!b) throw new Error("Backup not found");
  await fs.rm(b.path, { force: true });
  await db.delete(backups).where(eq(backups.id, b.id));
  return ok({ deleted: true });
});
app.get("/api/instances/:id/worlds", async (req) => {
  const i = await getInstance((req.params as any).id);
  const directories = (await fs.readdir(i.path, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && !entry.name.startsWith("."),
  );
  const names = await Promise.all(
    directories.map(async (entry) => {
      try {
        const levelData = safeResolve(i.path, `${entry.name}/level.dat`);
        return (await fs.stat(levelData)).isFile() ? entry : null;
      } catch {
        return null;
      }
    }),
  );
  return ok(
    await Promise.all(
      names.filter((entry) => entry !== null).map(async (e) => ({
        name: e.name,
        path: e.name,
        modifiedAt: (await fs.stat(safeResolve(i.path, e.name))).mtime.toISOString(),
      })),
    ),
  );
});
const salvadiuxStagedMaps = [
  { id: "hub", name: "Salvadiux Hub · Server Spawn/Lobby 1.03", folder: "hub-world", author: "mikele12327", source: "https://www.curseforge.com/minecraft/worlds/server-spawn-lobby/files/7604500", compatibility: ["1.21.10"], attribution: "Creator permits use on personal and general servers. Do not reupload as your own." },
  { id: "welcome", name: "Welcome Lobby · Xemtori Small Party Lobby", folder: "welcome-world", author: "Xemtori", source: "https://www.curseforge.com/minecraft/worlds/xemtori-small-party-lobby/files/7882017", compatibility: ["1.21.10"], attribution: "Keep the map's credit shields in place." },
];
app.get("/api/instances/:id/worlds/staged", async (req) => {
  const instance = await getInstance((req.params as any).id);
  return ok(await Promise.all(salvadiuxStagedMaps.filter((map) => map.compatibility.includes(instance.minecraftVersion)).map(async (map) => {
    const directory = safeResolve(dataDir, `maps/staging/prepared/${map.folder}`);
    const ready = Boolean(directory && existsSync(safeResolve(directory, "level.dat")));
    return { id: map.id, name: map.name, author: map.author, source: map.source, attribution: map.attribution, ready };
  })));
});
app.get("/api/instances/:id/worlds/:world/export", async (req, reply) => {
  const i = await getInstance((req.params as any).id); await ensureStopped(i);
  const worldName = safeWorldName((req.params as any).world), source = safeResolve(i.path, worldName);
  try { if (!(await fs.stat(safeResolve(source, "level.dat"))).isFile()) throw new Error("World not found."); } catch { throw Object.assign(new Error("World not found."), { statusCode: 404 }); }
  const archivePath = join(dataDir, `world-export-${randomUUID()}.zip`);
  await zipDirectory(source, archivePath);
  const stream = createReadStream(archivePath);
  stream.once("close", () => { void fs.rm(archivePath, { force: true }); });
  reply.header("content-type", "application/zip").header("content-disposition", `attachment; filename="${worldName.replace(/[^a-zA-Z0-9_-]/g, "-")}.zip"`).header("cache-control", "no-store");
  return reply.send(stream);
});
const worldSearchCache = new Map<string, { expiresAt: number; value: unknown }>();
const curseforgeKey = () => process.env.CURSEFORGE_API_KEY?.trim();
app.get("/api/instances/:id/worlds/providers", async (req) => {
  await getInstance((req.params as any).id);
  return ok([
    { id: "modrinth", name: "Modrinth", configured: true, url: "https://modrinth.com/discover/worlds" },
    { id: "curseforge", name: "CurseForge", configured: Boolean(curseforgeKey()), setupHint: curseforgeKey() ? undefined : "Configura CURSEFORGE_API_KEY en el entorno del servidor para habilitar este proveedor.", url: "https://www.curseforge.com/minecraft/search?class=worlds" },
    { id: "planetminecraft", name: "Planet Minecraft", configured: true, external: true, url: "https://www.planetminecraft.com/projects/" },
  ]);
});
app.get("/api/instances/:id/worlds/discover", async (req) => {
  const i = await getInstance((req.params as any).id);
  const query = req.query as any;
  const provider = String(query.provider ?? "modrinth");
  const search = String(query.q ?? "").slice(0, 120).trim();
  const offset = Math.max(0, Math.min(500, Number(query.offset ?? 0) || 0));
  const cacheKey = `${provider}:${i.minecraftVersion}:${search}:${offset}`;
  const cached = worldSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return ok(cached.value);
  let result: any;
  if (provider === "modrinth") {
    const url = new URL("https://api.modrinth.com/v2/search");
    url.searchParams.set("facets", JSON.stringify([[`versions:${i.minecraftVersion}`]]));
    url.searchParams.set("index", "downloads");
    url.searchParams.set("limit", "12");
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("query", search || "minecraft map");
    const response = await fetch(url, { headers: { "User-Agent": "SalvadiuxHost/0.1 (world browser)" }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw Object.assign(new Error(`Modrinth respondió ${response.status}`), { statusCode: 502 });
    const body = await response.json() as any;
    const projects = await Promise.all((body.hits ?? []).map(async (hit: any) => {
      try {
        const versionsUrl = new URL(`https://api.modrinth.com/v2/project/${encodeURIComponent(hit.project_id)}/version`);
        versionsUrl.searchParams.set("game_versions", JSON.stringify([i.minecraftVersion])); versionsUrl.searchParams.set("include_changelog", "false");
        const versionsResponse = await fetch(versionsUrl, { headers: { "User-Agent": "SalvadiuxHost/0.1 (world browser)" }, signal: AbortSignal.timeout(10000) });
        if (!versionsResponse.ok) return null;
        const versions = await versionsResponse.json() as any[];
        const archives = versions.filter((version) => version.status === "listed").flatMap((version) => (version.files ?? []).filter((file: any) => file.filename?.toLowerCase().endsWith(".zip")).map((file: any) => ({ versionId: version.id, versionName: version.name || version.version_number, date: version.date_published, name: file.filename, size: file.size })));
        if (!archives.length) return null;
        return { provider, id: hit.project_id, slug: hit.slug, title: hit.title, description: hit.description, author: hit.author, icon: hit.icon_url, gallery: (hit.gallery ?? []).slice(0, 4), downloads: hit.downloads, updatedAt: hit.date_modified, versions: archives, url: `https://modrinth.com/${hit.project_type}/${hit.slug ?? hit.project_id}` };
      } catch { return null; }
    }));
    result = { total: projects.filter(Boolean).length, projects: projects.filter(Boolean) };
  } else if (provider === "curseforge") {
    const key = curseforgeKey();
    if (!key) throw Object.assign(new Error("CurseForge requiere CURSEFORGE_API_KEY configurada en el servidor."), { statusCode: 503 });
    const url = new URL("https://api.curseforge.com/v1/mods/search");
    url.searchParams.set("gameId", "432"); url.searchParams.set("classId", "17"); url.searchParams.set("pageSize", "24"); url.searchParams.set("index", String(offset)); url.searchParams.set("sortField", "6"); url.searchParams.set("sortOrder", "desc"); url.searchParams.set("gameVersion", i.minecraftVersion);
    if (search) url.searchParams.set("searchFilter", search);
    const response = await fetch(url, { headers: { "x-api-key": key, Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw Object.assign(new Error(`CurseForge respondió ${response.status}`), { statusCode: 502 });
    const body = await response.json() as any;
    result = { total: body.pagination?.totalCount ?? 0, projects: (body.data ?? []).map((hit: any) => ({ provider, id: String(hit.id), slug: hit.slug, title: hit.name, description: hit.summary, author: hit.authors?.[0]?.name ?? "CurseForge", icon: hit.logo?.url, gallery: (hit.screenshots ?? []).map((image: any) => image.url).filter(Boolean).slice(0, 4), downloads: hit.downloadCount, updatedAt: hit.dateModified, url: hit.links?.websiteUrl, latestFiles: hit.latestFiles?.map((file: any) => ({ id: String(file.id), name: file.displayName ?? file.fileName, version: file.displayName ?? file.fileName, date: file.fileDate, size: file.fileLength })) ?? [] })) };
  } else {
    throw Object.assign(new Error("Proveedor de mundos desconocido."), { statusCode: 400 });
  }
  worldSearchCache.set(cacheKey, { value: result, expiresAt: Date.now() + 5 * 60_000 });
  return ok(result);
});
app.get("/api/instances/:id/worlds/discover/:provider/:project/versions", async (req) => {
  const i = await getInstance((req.params as any).id);
  const p = req.params as any;
  if (p.provider === "modrinth") {
    const url = new URL(`https://api.modrinth.com/v2/project/${encodeURIComponent(p.project)}/version`);
    url.searchParams.set("game_versions", JSON.stringify([i.minecraftVersion]));
    url.searchParams.set("include_changelog", "false");
    const response = await fetch(url, { headers: { "User-Agent": "SalvadiuxHost/0.1 (world browser)" }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw Object.assign(new Error(`No se pudieron cargar versiones de Modrinth (${response.status}).`), { statusCode: 502 });
    const versions = await response.json() as any[];
    return ok(versions.filter((v) => v.status === "listed").map((v) => ({ id: v.id, name: v.name || v.version_number, date: v.date_published, files: v.files?.filter((f: any) => f.filename?.toLowerCase().endsWith(".zip")).map((f: any) => ({ name: f.filename, size: f.size })) ?? [] })).filter((v) => v.files.length));
  }
  if (p.provider === "curseforge") {
    const key = curseforgeKey();
    if (!key) throw Object.assign(new Error("CurseForge requiere CURSEFORGE_API_KEY configurada en el servidor."), { statusCode: 503 });
    const url = new URL(`https://api.curseforge.com/v1/mods/${encodeURIComponent(p.project)}/files`);
    url.searchParams.set("gameVersion", i.minecraftVersion); url.searchParams.set("pageSize", "50"); url.searchParams.set("index", "0");
    const response = await fetch(url, { headers: { "x-api-key": key, Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw Object.assign(new Error(`No se pudieron cargar archivos de CurseForge (${response.status}).`), { statusCode: 502 });
    const body = await response.json() as any;
    return ok((body.data ?? []).filter((f: any) => f.fileName?.toLowerCase().endsWith(".zip") && f.downloadUrl).map((f: any) => ({ id: String(f.id), name: f.displayName ?? f.fileName, date: f.fileDate, files: [{ name: f.fileName, size: f.fileLength }] })));
  }
  throw Object.assign(new Error("Proveedor de mundos desconocido."), { statusCode: 400 });
});
function safeWorldName(input: unknown) {
  const name = String(input ?? "").normalize("NFKC").replace(/[^\p{L}\p{N} _.()-]/gu, "-").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "").slice(0, 48);
  if (!name || name === "." || name === "..") throw Object.assign(new Error("Escribe un nombre válido para el mundo."), { statusCode: 400 });
  return name;
}
function allowedWorldDownloadHost(hostname: string) {
  const host = hostname.toLowerCase();
  return ["cdn.modrinth.com", "forgecdn.net", "curseforge.com", "overwolf.com"].some((domain) => host === domain || host.endsWith(`.${domain}`));
}
async function ensureStopped(i: any) {
  const state: any = await agent(`/instances/${i.id}/status`);
  if (state.running) throw Object.assign(new Error("Detén el servidor antes de cambiar mundos para evitar daños en los datos."), { statusCode: 409 });
}
async function snapshotWorld(i: any, worldName: string, tag: string) {
  const source = safeResolve(i.path, worldName);
  if (!source) throw Object.assign(new Error("Ruta de mundo inválida."), { statusCode: 400 });
  const archiveName = `world-${worldName.replace(/[^a-zA-Z0-9_-]/g, "-")}-${tag}-${Date.now()}.zip`;
  const backupPath = join(i.path, "backups", archiveName);
  await fs.mkdir(dirname(backupPath), { recursive: true });
  await zipDirectory(source, backupPath);
  const stat = await fs.stat(backupPath), createdAt = new Date().toISOString();
  await db.insert(backups).values({ id: randomUUID(), instanceId: i.id, path: backupPath, name: `World snapshot: ${worldName} (${tag})`, size: stat.size, description: `Automatic safety copy created before ${tag} action.`, automatic: false, createdAt });
  return backupPath;
}
app.post("/api/instances/:id/worlds/install-staged", async (req) => {
  const instance = await getInstance((req.params as any).id);
  await ensureStopped(instance);
  const body = req.body as any;
  const map = salvadiuxStagedMaps.find((candidate) => candidate.id === String(body?.mapId ?? ""));
  if (!map || !map.compatibility.includes(instance.minecraftVersion)) throw Object.assign(new Error("El mapa seleccionado no está disponible para esta versión de Minecraft."), { statusCode: 400 });
  const worldName = safeWorldName(body?.worldName ?? (map.id === "welcome" ? "welcome_lobby" : "salvadiux_hub"));
  const source = safeResolve(dataDir, `maps/staging/prepared/${map.folder}`);
  const sourceLevel = safeResolve(source, "level.dat");
  if (!source || !sourceLevel || !(await fs.stat(sourceLevel).catch(() => null))?.isFile()) throw Object.assign(new Error("El mapa preparado no está disponible. Vuelve a descargarlo antes de instalarlo."), { statusCode: 404 });
  const destination = safeResolve(instance.path, worldName);
  const propertiesPath = safeResolve(instance.path, "server.properties");
  if (!destination || !propertiesPath) throw new Error("No se pudo resolver de forma segura la carpeta del mundo.");
  try { await fs.access(destination); throw Object.assign(new Error(`Ya existe la carpeta ${worldName}; el mapa anterior se conserva intacto.`), { statusCode: 409 }); } catch (error: any) { if (error?.statusCode) throw error; }
  const oldProperties = await fs.readFile(propertiesPath, "utf8");
  const backupPath = safeResolve(instance.path, `.salvadiux/map-config-backups/${worldName}-${Date.now()}.properties`);
  if (!backupPath) throw new Error("No se pudo crear una copia segura de server.properties.");
  await fs.mkdir(dirname(backupPath), { recursive: true });
  await fs.copyFile(propertiesPath, backupPath);
  try {
    await fs.cp(source, destination, { recursive: true, errorOnExist: true, force: false, filter: async (path) => !(await fs.lstat(path)).isSymbolicLink() });
    await fs.rm(safeResolve(destination, "session.lock"), { force: true });
    await fs.writeFile(propertiesPath, updateProperties(oldProperties, { "level-name": worldName }), "utf8");
    await db.update(instances).set({ restartRequired: true, updatedAt: new Date().toISOString() }).where(eq(instances.id, instance.id));
  } catch (error) {
    await fs.rm(destination, { recursive: true, force: true }).catch(() => undefined);
    await fs.writeFile(propertiesPath, oldProperties, "utf8").catch(() => undefined);
    throw error;
  }
  await activity(instance.id, "world.staged-map.installed", `Installed ${map.name} as ${worldName}`, { mapId: map.id, author: map.author, source: map.source, previousWorldPreserved: true });
  return ok({ installed: true, mapId: map.id, worldName, levelName: worldName, restartRequired: true, previousWorldPreserved: true, attribution: map.attribution });
});
app.post("/api/instances/:id/worlds/install", async (req) => {
  const i = await getInstance((req.params as any).id); await ensureStopped(i);
  const body = req.body as any, provider = String(body?.provider ?? ""), project = String(body?.projectId ?? ""), versionId = String(body?.versionId ?? "");
  const targetName = safeWorldName(body?.name);
  if (!project || !versionId) throw new Error("Selecciona un mapa y una versión.");
  let fileUrl = "", expectedSize = 0, expectedHash: string | undefined;
  if (provider === "modrinth") {
    const url = new URL(`https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`);
    const response = await fetch(url, { headers: { "User-Agent": "SalvadiuxHost/0.1 (world installer)" }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw Object.assign(new Error("No se pudo verificar la versión de Modrinth."), { statusCode: 502 });
    const version = await response.json() as any;
    if (version.project_id !== project || !version.game_versions?.includes(i.minecraftVersion)) throw new Error("La versión del mapa no corresponde al proyecto o versión de Minecraft del servidor.");
    const file = version.files?.find((f: any) => f.primary && f.filename?.toLowerCase().endsWith(".zip")) ?? version.files?.find((f: any) => f.filename?.toLowerCase().endsWith(".zip"));
    if (!file) throw new Error("Esta versión no contiene un archivo ZIP de mundo.");
    fileUrl = file.url; expectedSize = Number(file.size ?? 0); expectedHash = file.hashes?.sha1;
  } else if (provider === "curseforge") {
    const key = curseforgeKey(); if (!key) throw Object.assign(new Error("CurseForge requiere CURSEFORGE_API_KEY configurada en el servidor."), { statusCode: 503 });
    const url = new URL(`https://api.curseforge.com/v1/mods/${encodeURIComponent(project)}/files/${encodeURIComponent(versionId)}`);
    const response = await fetch(url, { headers: { "x-api-key": key, Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw Object.assign(new Error("No se pudo verificar el archivo de CurseForge."), { statusCode: 502 });
    const file = (await response.json() as any).data;
    if (!file?.fileName?.toLowerCase().endsWith(".zip") || !(file.gameVersions ?? []).includes(i.minecraftVersion)) throw new Error("El archivo no es un mapa ZIP compatible con la versión del servidor.");
    fileUrl = file.downloadUrl; expectedSize = Number(file.fileLength ?? 0); expectedHash = file.hashes?.find((hash: any) => hash.algo === 1)?.value;
    if (!fileUrl) {
      const downloadUrl = await fetch(`https://api.curseforge.com/v1/mods/${encodeURIComponent(project)}/files/${encodeURIComponent(versionId)}/download-url`, { headers: { "x-api-key": key, Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
      if (downloadUrl.ok) fileUrl = String((await downloadUrl.json() as any).data ?? "");
    }
    if (!fileUrl) throw new Error("CurseForge no proporcionó una URL de descarga para este archivo.");
  } else throw Object.assign(new Error("Proveedor de mundos desconocido."), { statusCode: 400 });
  const parsed = new URL(fileUrl);
  if (parsed.protocol !== "https:" || !allowedWorldDownloadHost(parsed.hostname)) throw new Error("El proveedor devolvió un dominio de descarga no permitido.");
  const target = safeResolve(i.path, targetName)!;
  try { await fs.access(target); throw Object.assign(new Error("Ya existe un mundo con ese nombre."), { statusCode: 409 }); } catch (error: any) { if (error?.statusCode) throw error; }
  const stagingRoot = await fs.mkdtemp(join(dataDir, "world-install-"));
  const archivePath = join(stagingRoot, "download.zip"), extractDir = join(stagingRoot, "extracted");
  try {
    const response = await fetch(parsed, { signal: AbortSignal.timeout(120000), redirect: "follow" });
    if (!response.ok || !response.body) throw Object.assign(new Error(`Descarga del mapa fallida (${response.status}).`), { statusCode: 502 });
    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== "https:" || !allowedWorldDownloadHost(finalUrl.hostname)) throw new Error("La descarga redirigió a un dominio no permitido.");
    const contentLength = Number(response.headers.get("content-length") ?? expectedSize ?? 0);
    if (contentLength > 768 * 1024 * 1024) throw new Error("El mapa excede el límite de descarga de 768 MB.");
    let received = 0;
    const hasher = createHash("sha1");
    const limiter = new Transform({ transform(chunk, _encoding, callback) { received += chunk.length; if (received > 768 * 1024 * 1024) return callback(new Error("El mapa excede el límite de descarga de 768 MB.")); hasher.update(chunk); callback(null, chunk); } });
    await pipeline(Readable.fromWeb(response.body as any), limiter, createWriteStream(archivePath));
    if (expectedHash && hasher.digest("hex").toLowerCase() !== expectedHash.toLowerCase()) throw new Error("La verificación SHA-1 del mapa descargado no coincide.");
    await fs.mkdir(extractDir, { recursive: true });
    let entryCount = 0, expandedBytes = 0;
    await extract(archivePath, { dir: extractDir, onEntry(entry) { entryCount++; expandedBytes += Number((entry as any).uncompressedSize ?? 0); const mode = (entry.externalFileAttributes >>> 16) & 0xffff, kind = mode & 0o170000; if (kind === 0o120000 || (kind !== 0 && kind !== 0o100000 && kind !== 0o040000) || entryCount > 100_000 || expandedBytes > 2 * 1024 * 1024 * 1024) throw new Error("El ZIP del mapa es inseguro o excede los límites permitidos."); safeResolve(extractDir, entry.fileName); } });
    const directLevel = safeResolve(extractDir, "level.dat");
    let worldRoot = extractDir;
    try { await fs.access(directLevel); } catch {
      const children = (await fs.readdir(extractDir, { withFileTypes: true })).filter((entry) => entry.isDirectory());
      const valid: string[] = [];
      for (const entry of children) try { await fs.access(safeResolve(extractDir, `${entry.name}/level.dat`)!); valid.push(entry.name); } catch { /* skip folder */ }
      if (valid.length !== 1) throw new Error("El ZIP no contiene un mundo reconocible con level.dat en la raíz o una carpeta única.");
      worldRoot = safeResolve(extractDir, valid[0])!;
    }
    const levelPath = safeResolve(worldRoot, "level.dat");
    if (!levelPath || !(await fs.stat(levelPath)).isFile()) throw new Error("El mapa no incluye un archivo level.dat válido.");
    await fs.rename(worldRoot, target);
  } finally { await fs.rm(stagingRoot, { recursive: true, force: true }); }
  await activity(i.id, "world.installed", `Installed world ${targetName}`, { provider, project });
  return ok({ installed: true, name: targetName, path: targetName });
});
app.post("/api/instances/:id/worlds/import", async (req) => {
  const i = await getInstance((req.params as any).id); await ensureStopped(i);
  const targetName = safeWorldName((req.query as any)?.name);
  const upload = await req.file();
  if (!upload || !upload.filename.toLowerCase().endsWith(".zip")) throw new Error("Selecciona un archivo ZIP de mundo.");
  const target = safeResolve(i.path, targetName)!;
  try { await fs.access(target); throw Object.assign(new Error("Ya existe un mundo con ese nombre."), { statusCode: 409 }); } catch (error: any) { if (error?.statusCode) throw error; }
  const stagingRoot = await fs.mkdtemp(join(dataDir, "world-import-"));
  const archivePath = join(stagingRoot, "upload.zip"), extractDir = join(stagingRoot, "extracted");
  try {
    let received = 0;
    const limiter = new Transform({ transform(chunk, _encoding, callback) { received += chunk.length; callback(received > 768 * 1024 * 1024 ? new Error("El ZIP excede el límite de 768 MB.") : null, chunk); } });
    await pipeline(upload.file, limiter, createWriteStream(archivePath));
    if (upload.file.truncated) throw new Error("La subida del ZIP excedió el límite permitido.");
    await fs.mkdir(extractDir, { recursive: true });
    let entryCount = 0, expandedBytes = 0;
    await extract(archivePath, { dir: extractDir, onEntry(entry) { entryCount++; expandedBytes += Number((entry as any).uncompressedSize ?? 0); const mode = (entry.externalFileAttributes >>> 16) & 0xffff, kind = mode & 0o170000; if (kind === 0o120000 || (kind !== 0 && kind !== 0o100000 && kind !== 0o040000) || entryCount > 100_000 || expandedBytes > 2 * 1024 * 1024 * 1024) throw new Error("El ZIP del mapa es inseguro o excede los límites permitidos."); safeResolve(extractDir, entry.fileName); } });
    let worldRoot = extractDir;
    try { await fs.access(safeResolve(extractDir, "level.dat")); } catch {
      const children = (await fs.readdir(extractDir, { withFileTypes: true })).filter((entry) => entry.isDirectory());
      const valid: string[] = [];
      for (const entry of children) try { await fs.access(safeResolve(extractDir, `${entry.name}/level.dat`)!); valid.push(entry.name); } catch { /* skip non-world folder */ }
      if (valid.length !== 1) throw new Error("El ZIP no contiene un mundo reconocible con level.dat en la raíz o una carpeta única.");
      worldRoot = safeResolve(extractDir, valid[0])!;
    }
    const levelPath = safeResolve(worldRoot, "level.dat");
    if (!(await fs.stat(levelPath)).isFile()) throw new Error("El mapa no incluye un archivo level.dat válido.");
    await fs.rename(worldRoot, target);
  } finally { await fs.rm(stagingRoot, { recursive: true, force: true }); }
  await activity(i.id, "world.imported", `Imported world ${targetName}`, { source: "uploaded ZIP" });
  return ok({ imported: true, name: targetName, path: targetName });
});
app.delete("/api/instances/:id/worlds/:world", async (req) => {
  const i = await getInstance((req.params as any).id); await ensureStopped(i);
  const worldName = safeWorldName((req.params as any).world);
  const worldPath = safeResolve(i.path, worldName);
  if (!worldPath) throw new Error("Ruta de mundo inválida.");
  const levelPath = safeResolve(worldPath, "level.dat");
  try { if (!(await fs.stat(levelPath)).isFile()) throw new Error("No se encontró un mundo en esa carpeta."); } catch (error: any) { if (error?.message === "No se encontró un mundo en esa carpeta.") throw error; throw Object.assign(new Error("No se encontró un mundo en esa carpeta."), { statusCode: 404 }); }
  const backup = await snapshotWorld(i, worldName, "deleted");
  await fs.rm(worldPath, { recursive: true, force: true });
  await activity(i.id, "world.deleted", `Deleted world ${worldName}`, { backup });
  return ok({ deleted: true, name: worldName, backup: relative(i.path, backup) });
});
app.post("/api/instances/:id/worlds/:world/duplicate", async (req) => {
  const i = await getInstance((req.params as any).id); await ensureStopped(i);
  const sourceName = safeWorldName((req.params as any).world), newName = safeWorldName((req.body as any)?.name);
  const source = safeResolve(i.path, sourceName), target = safeResolve(i.path, newName);
  try { if (!(await fs.stat(safeResolve(source, "level.dat"))).isFile()) throw new Error("World not found."); } catch { throw Object.assign(new Error("World not found."), { statusCode: 404 }); }
  try { await fs.access(target); throw Object.assign(new Error("A world with that name already exists."), { statusCode: 409 }); } catch (error: any) { if (error?.statusCode) throw error; }
  await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false, filter: async (path) => !(await fs.lstat(path)).isSymbolicLink() });
  await activity(i.id, "world.duplicated", `Duplicated ${sourceName} as ${newName}`, { source: sourceName, duplicate: newName });
  return ok({ duplicated: true, source: sourceName, name: newName });
});
app.post("/api/instances/:id/worlds/:world/reset", async (req) => {
  const i = await getInstance((req.params as any).id); await ensureStopped(i);
  const worldName = safeWorldName((req.params as any).world);
  const worldPath = safeResolve(i.path, worldName);
  if (!worldPath) throw new Error("Ruta de mundo inválida.");
  try { if (!(await fs.stat(safeResolve(worldPath, "level.dat"))).isFile()) throw new Error("No se encontró un mundo en esa carpeta."); } catch (error: any) { if (error?.message === "No se encontró un mundo en esa carpeta.") throw error; throw Object.assign(new Error("No se encontró un mundo en esa carpeta."), { statusCode: 404 }); }
  const backup = await snapshotWorld(i, worldName, "before-reset");
  await fs.rm(worldPath, { recursive: true, force: true });
  await activity(i.id, "world.reset", `Reset world ${worldName}`, { backup });
  return ok({ reset: true, name: worldName, backup: relative(i.path, backup), note: "Minecraft generará este mundo de nuevo al iniciar el servidor." });
});
app.get("/api/instances/:id/map/worlds", async (req) => {
  const instance = await getInstance((req.params as any).id);
  const entries = await fs.readdir(instance.path, { withFileTypes: true });
  const worlds = await Promise.all(entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map(async (entry) => {
    const root = safeResolve(instance.path, entry.name);
    try { if (!(await fs.stat(safeResolve(root, "level.dat"))).isFile()) return null; } catch { return null; }
    const dimensions = await findWorldRegions(root);
    return { name: entry.name, spawn: await findWorldSpawn(root), dimensions: await Promise.all(dimensions.map(async (dimension) => ({ id: dimension.id, label: dimension.label, chunks: await countLoadedChunks(dimension.path) }))) };
  }));
  return ok(worlds.filter(Boolean));
});
app.get("/api/instances/:id/map/tile", async (req, reply) => {
  const instance = await getInstance((req.params as any).id);
  const query = req.query as any;
  const worldName = String(query.world ?? "");
  const entries = await fs.readdir(instance.path, { withFileTypes: true });
  if (!entries.some((entry) => entry.isDirectory() && entry.name === worldName)) throw Object.assign(new Error("World not found."), { statusCode: 404 });
  const worldPath = safeResolve(instance.path, worldName);
  const dimensions = await findWorldRegions(worldPath);
  const dimension = dimensions.find((item) => item.id === String(query.dimension ?? ""));
  if (!dimension) throw Object.assign(new Error("Dimension has no saved region files."), { statusCode: 404 });
  const centerX = Number(query.x ?? 0), centerZ = Number(query.z ?? 0), scale = Number(query.scale ?? 2);
  const width = Number(query.width ?? 512), height = Number(query.height ?? 256);
  if (!Number.isFinite(centerX) || !Number.isFinite(centerZ) || Math.abs(centerX) > 30_000_000 || Math.abs(centerZ) > 30_000_000 || ![1, 2, 4, 8, 16, 32, 64].includes(scale) || ![256, 384, 512].includes(width) || ![192, 256, 320].includes(height) || width * height > 131_072) throw new Error("Invalid map coordinates, dimensions or zoom.");
  const tile = await renderMapTile(dimension.path, Math.floor(centerX), Math.floor(centerZ), scale, width, height);
  reply.header("content-type", "application/octet-stream").header("cache-control", "no-store").header("x-map-meta", Buffer.from(JSON.stringify({ startX: tile.startX, startZ: tile.startZ, width: tile.width, height: tile.height, blocksPerPixel: tile.blocksPerPixel, chunksLoaded: tile.chunksLoaded, structures: tile.structures, biomes: tile.biomes, blockPalette: tile.blockPalette })).toString("base64url"));
  return reply.send(Buffer.concat([tile.pixels, tile.heights, tile.biomePixels, tile.blockPixels]));
});
app.post("/api/instances/:id/map/atlas", async (req, reply) => {
  await getInstance((req.params as any).id);
  const requested = (req.body as any)?.blocks;
  if (!Array.isArray(requested) || requested.length > 512 || requested.some((block) => typeof block !== "string" || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/i.test(block))) throw new Error("Invalid block texture list.");
  const atlas = await createBlockTextureAtlas(requested);
  reply.header("content-type", "image/svg+xml; charset=utf-8").header("cache-control", "private, max-age=3600").header("x-map-textures", atlas.textured ? "local-minecraft-assets" : "color-fallback");
  return reply.send(atlas.svg);
});
app.get("/api/instances/:id/map/players", async (req) => {
  const id = (req.params as any).id;
  await getInstance(id);
  const state: any = await agent(`/instances/${id}/status`);
  return ok({ available: Boolean(state.positionTracking), players: state.positions ?? [] });
});
const mojangProfileCache = new Map<string, { expiresAt: number; profile: any | null }>();
async function mojangProfile(name: string) {
  const normalized = name.toLowerCase();
  const cached = mojangProfileCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;
  let profile = null;
  try {
    const response = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(2500) });
    if (response.ok) {
      const data = await response.json() as { id?: string; name?: string };
      if (data.id && data.name) profile = { id: data.id, name: data.name, head: `https://mc-heads.net/avatar/${data.id}/64` };
    }
  } catch {}
  mojangProfileCache.set(normalized, { profile, expiresAt: Date.now() + (profile ? 6 * 60 * 60_000 : 2 * 60_000) });
  return profile;
}
app.get("/api/instances/:id/players", async (req) => {
  const i = await getInstance((req.params as any).id);
  const read = async (name: string) =>
    JSON.parse(
      await fs
        .readFile(join(i.path, name), "utf8")
        .catch(() => Buffer.from("[]"))
        .then(String),
    );
  const [whitelist, operators, bannedPlayers, bannedIps] = await Promise.all([read("whitelist.json"), read("ops.json"), read("banned-players.json"), read("banned-ips.json")]);
  const properties = await fs.readFile(join(i.path, "server.properties"), "utf8").then(parseProperties).catch(() => ({} as Record<string, string>));
  const onlineMode = properties["online-mode"] !== "false";
  const uniqueNames = [...new Set([...whitelist, ...operators, ...bannedPlayers].map((player: any) => player.name).filter((name: unknown): name is string => typeof name === "string" && /^[A-Za-z0-9_]{1,16}$/.test(name)))].slice(0, 32);
  const profiles = onlineMode ? Object.fromEntries(await Promise.all(uniqueNames.map(async (name) => [name.toLowerCase(), await mojangProfile(name)] as const))) : {};
  const attachProfiles = (players: any[]) => players.map((player) => {
    const profile = profiles[String(player.name).toLowerCase()] ?? null;
    const sameAccount = profile && typeof player.uuid === "string" && player.uuid.replaceAll("-", "").toLowerCase() === profile.id.toLowerCase();
    return { ...player, onlineMode, profile: sameAccount || !onlineMode ? profile : null };
  });
  let live: any = { running: false, players: [] };
  try { live = await agent(`/instances/${(req.params as any).id}/status`); } catch {}
  const online = await Promise.all((live.players ?? []).map(async (name: string) => ({ name, onlineMode, profile: await mojangProfile(name) })));
  return ok({ onlineMode, controlReady: Boolean(live.running && live.managed === true), online, whitelist: attachProfiles(whitelist), operators: attachProfiles(operators), bannedPlayers: attachProfiles(bannedPlayers), bannedIps });
});
const customDiscordTriggers = new Set(["manual", "server.online", "server.offline", "player.join", "player.leave", "player.death", "backup.created", "instance.killed", "instance.restarted", "player.action", "backup.restored"]);
function cleanDiscordTemplate(raw: any, fallback: DiscordTemplate): DiscordTemplate {
  const value = raw ?? fallback;
  const template: DiscordTemplate = {
    id: fallback.id,
    name: String(value.name ?? fallback.name).trim().slice(0, 48),
    mode: value.mode === "message" ? "message" : "embed",
    content: String(value.content ?? "").slice(0, 2000),
    title: String(value.title ?? "").slice(0, 256),
    description: String(value.description ?? "").slice(0, 4000),
    color: /^#[0-9a-f]{6}$/i.test(value.color ?? "") ? value.color : "#0a84ff",
    imageData: typeof value.imageData === "string" ? value.imageData : null,
  };
  imageAttachment(template);
  if (template.mode === "message" && !template.content.trim() && !template.imageData) throw new Error("A plain message needs text or an image.");
  if (template.mode === "embed" && !template.title.trim() && !template.description.trim() && !template.content.trim() && !template.imageData) throw new Error("An embed needs a title, description, message, or image.");
  return template;
}
const publicDiscordConfig = (config: DiscordConfig) => ({ enabled: config.enabled, events: config.events, templates: config.templates, customEvents: config.customEvents, webhookConfigured: Boolean(config.webhookCipher) });
app.get("/api/instances/:id/discord", async (req) => {
  const id = (req.params as any).id;
  await getInstance(id);
  return ok(publicDiscordConfig(await readDiscordConfig(id)));
});
app.put("/api/instances/:id/discord", async (req) => {
  const id = (req.params as any).id;
  await getInstance(id);
  const body = req.body as any;
  const config = await readDiscordConfig(id);
  if (body.webhookUrl) config.webhookCipher = await encryptWebhook(validateDiscordWebhook(String(body.webhookUrl).trim()));
  if (body.clearWebhook) config.webhookCipher = undefined;
  config.enabled = Boolean(body.enabled);
  const allowedEvents = new Set(defaultDiscordEvents);
  config.events = Array.isArray(body.events) ? [...new Set<string>(body.events.filter((event: unknown): event is string => typeof event === "string" && allowedEvents.has(event)))] : config.events;
  if (Array.isArray(body.templates)) config.templates = defaultDiscordTemplates.map((template) => cleanDiscordTemplate(body.templates.find((item: any) => item.id === template.id), template));
  if (Array.isArray(body.customEvents)) {
    if (body.customEvents.length > 20) throw new Error("You can create up to 20 custom events.");
    config.customEvents = body.customEvents.map((event: any, index: number) => {
      const eventId = String(event.id ?? `custom-${index}`).slice(0, 48);
      if (!/^[a-z0-9_-]{1,48}$/i.test(eventId) || !customDiscordTriggers.has(event.trigger)) throw new Error("Invalid custom announcement event.");
      const fallback: DiscordTemplate = { id: eventId, name: String(event.name ?? "Custom announcement").slice(0, 48), mode: "embed", content: "", title: "{{event}}", description: "{{server}} · {{address}}", color: "#0a84ff", imageData: null };
      return { id: eventId, name: String(event.name ?? fallback.name).trim().slice(0, 48), trigger: event.trigger, enabled: Boolean(event.enabled), template: cleanDiscordTemplate({ ...event.template, id: eventId }, fallback) } satisfies DiscordCustomEvent;
    });
  }
  if (config.enabled && !config.webhookCipher) throw new Error("Connect and save a Discord webhook before enabling notifications.");
  await writeDiscordConfig(id, config);
  return ok(publicDiscordConfig(config));
});
app.delete("/api/instances/:id/discord/webhook", async (req) => {
  const id = (req.params as any).id;
  await getInstance(id);
  const config = await readDiscordConfig(id);
  config.webhookCipher = undefined;
  config.enabled = false;
  await writeDiscordConfig(id, config);
  return ok({ disconnected: true });
});
app.post("/api/instances/:id/discord/test", async (req) => {
  const id = (req.params as any).id;
  const config = await readDiscordConfig(id);
  const webhook = await decryptWebhook(config.webhookCipher);
  if (!webhook) throw new Error("Connect and save a Discord webhook first.");
  const template = config.templates.find((item) => item.id === (req.body as any)?.templateId) ?? config.templates[0]!;
  const instance = await getInstance(id);
  await postDiscordWebhook(webhook, template, { server: instance.name, address: `${instance.host}:${instance.port}`, player: "Alex", count: "1", event: "Test" });
  return ok({ sent: true });
});
app.post("/api/instances/:id/discord/announce/:eventId", async (req) => {
  await sendCustomDiscordEvent((req.params as any).id, (req.params as any).eventId);
  return ok({ sent: true });
});
app.post("/api/instances/:id/players/action", async (req) => {
  const id = (req.params as any).id;
  const b = req.body as any;
  const allowed = new Set([
    "kick",
    "ban",
    "pardon",
    "op",
    "deop",
    "whitelist add",
    "whitelist remove",
  ]);
  if (!allowed.has(b.action) || !/^[A-Za-z0-9_]{1,16}$/.test(b.player))
    throw new Error("Invalid player action");
  await agent(`/instances/${id}/command`, {
    method: "POST",
    body: JSON.stringify({ command: `${b.action} ${b.player}` }),
  });
  await activity(id, "player.action", `${b.action} ${b.player}`);
  return ok({ sent: true, confirmed: false });
});
// Playit agent lifecycle is owned by the local API so its executable and logs
// stay on this host. The binary is accepted only from Playit's signed release
// assets and is checked against the release SHA-256 before launch.
let playitProcess: ChildProcess | undefined;
let playitClaimUrl: string | undefined;
let playitClaimCode: string | undefined;
let playitClaimTimer: ReturnType<typeof setTimeout> | undefined;
let playitClaimEpoch = 0;
let playitClaimState: string | undefined;
let playitLog = "";
let playitVersion: string | undefined;
const playitBinary = join(dataDir, "playit", "playit-windows-x86_64-signed.exe");
const playitPipe = "\\\\.\\pipe\\playitd-system";
function playitIpc(request: Record<string, unknown>) {
  return new Promise<any>((resolve, reject) => {
    const socket = createConnection(playitPipe);
    let input = "", sent = false, settled = false;
    const finish = (error?: Error, value?: any) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    socket.setTimeout(10000, () => finish(new Error("Timed out connecting to the Playit agent.")));
    socket.once("error", (error) => finish(new Error(`Could not communicate with the Playit agent: ${error.message}`)));
    socket.on("data", (chunk) => {
      input += chunk.toString("utf8");
      let newline = input.indexOf("\n");
      while (newline >= 0) {
        const line = input.slice(0, newline).trim(); input = input.slice(newline + 1); newline = input.indexOf("\n");
        if (!line) continue;
        let message: any;
        try { message = JSON.parse(line); } catch { return finish(new Error("Playit returned an invalid IPC message.")); }
        if (message.message_kind === "hello" && !sent) {
          if (message.data?.protocol?.ipc_version !== 2) return finish(new Error("Unsupported Playit IPC version."));
          sent = true;
          socket.write(`${JSON.stringify({ ipc_version: 2, request_id: 1, request })}\n`);
        } else if (message.message_kind === "response" && message.data?.request_id === 1) {
          const response = message.data.response;
          if (response?.type === "error") return finish(new Error(response.data?.message ?? "Playit rejected the request."));
          finish(undefined, response);
        }
      }
    });
  });
}
async function playitCloudPost(path: string, body: unknown) {
  const response = await fetch(`https://api.playit.gg${path}`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Salvadiux-Host" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const result = await response.json() as any;
  if (!response.ok || result.status !== "success") throw new Error(result?.data ?? result?.message ?? `Playit returned HTTP ${response.status}.`);
  return result.data;
}
function schedulePlayitClaimCheck(epoch: number) {
  if (playitClaimTimer) clearTimeout(playitClaimTimer);
  playitClaimTimer = setTimeout(() => { void checkPlayitClaim(epoch); }, 2000);
}
async function checkPlayitClaim(epoch: number) {
  const code = playitClaimCode;
  if (!code || epoch !== playitClaimEpoch || !playitProcess || playitProcess.exitCode !== null) return;
  try {
    const state = await playitCloudPost("/claim/setup", { code, agent_type: "assignable", version: `playit ${playitVersion ?? "1.0"}` });
    if (state === "UserRejected") { playitClaimState = "rejected"; playitClaimUrl = undefined; return; }
    if (state === "UserAccepted") {
      const exchange = await playitCloudPost("/claim/exchange", { code }) as { secret_key?: string };
      if (!exchange.secret_key) throw new Error("Playit did not return an agent key.");
      const provision = await playitIpc({ type: "set_secret", secret: exchange.secret_key });
      if (!provision?.data?.accepted) throw new Error(provision?.data?.message ?? "Playit could not authorize the agent.");
      playitClaimState = "linked"; playitClaimCode = undefined; playitClaimUrl = undefined;
      playitLog = `${playitLog}\nPlayit account linked. The agent is connecting.`.slice(-1200);
      return;
    }
    playitClaimState = state === "WaitingForUser" ? "approval" : "waiting";
  } catch (error) {
    playitClaimState = "error";
    playitLog = `${playitLog}\n${(error as Error).message}`.slice(-1200);
  }
  if (code && epoch === playitClaimEpoch) schedulePlayitClaimCheck(epoch);
}
app.get("/api/playit/status", async () => {
  const ips = Object.values(os.networkInterfaces()).flatMap((items) => (items ?? []).filter((item) => item.family === "IPv4" && !item.internal).map((item) => item.address));
  let lifecycle: any = null;
  try { lifecycle = (await playitIpc({ type: "get_state" }))?.data ?? null; } catch {}
  const running = Boolean(playitProcess && playitProcess.exitCode === null && !playitProcess.killed) || lifecycle?.state === "running";
  const authenticated = lifecycle?.state === "running";
  const tunnels = authenticated ? lifecycle?.data?.tunnels ?? [] : [];
  return ok({ installed: existsSync(playitBinary), running, authenticated, lifecycle: lifecycle?.state ?? null, claimUrl: playitClaimUrl, claimState: playitClaimState, version: playitVersion, tunnels, localAddresses: [...new Set(ips)], log: playitLog.slice(-1200) });
});
app.post("/api/playit/start", async (req) => {
  const instance = await getInstance(String((req.body as any)?.instanceId ?? ""));
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Automatic Playit setup currently supports Windows 64-bit.");
  if (playitProcess && playitProcess.exitCode === null && !playitProcess.killed) return ok({ started: true, alreadyRunning: true, claimUrl: playitClaimUrl });
  try {
    const lifecycle = (await playitIpc({ type: "get_state" }))?.data;
    if (lifecycle?.state === "running") {
      playitClaimState = "linked";
      playitClaimUrl = undefined;
      playitClaimCode = undefined;
      playitLog = "Using the already running Playit agent service.";
      await activity(instance.id, "network.playit.reused", "Connected Salvadiux to the existing Playit service");
      return ok({ started: true, alreadyRunning: true, version: lifecycle?.data?.version, localHost: "127.0.0.1", localPort: instance.port });
    }
  } catch {}
  await fs.mkdir(dirname(playitBinary), { recursive: true });
  const releaseResponse = await fetch("https://api.github.com/repos/playit-cloud/playit-agent/releases/latest", { headers: { "User-Agent": "Salvadiux-Host", Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(15000) });
  if (!releaseResponse.ok) throw new Error("Could not read the latest official Playit release.");
  const release = await releaseResponse.json() as { tag_name?: string; assets?: Array<{ name: string; browser_download_url: string; digest?: string }> };
  const asset = release.assets?.find((item) => item.name === "playit-windows-x86_64-signed.exe");
  if (!asset?.digest?.startsWith("sha256:")) throw new Error("The official Playit release did not provide a SHA-256 digest.");
  let binaryMatchesRelease = false;
  if (existsSync(playitBinary)) {
    const existing = await fs.readFile(playitBinary);
    binaryMatchesRelease = createHash("sha256").update(existing).digest("hex") === asset.digest.slice("sha256:".length);
  }
  if (!binaryMatchesRelease) {
    const binaryResponse = await fetch(asset.browser_download_url, { headers: { "User-Agent": "Salvadiux-Host" }, signal: AbortSignal.timeout(120000) });
    if (!binaryResponse.ok) throw new Error("Could not download the official Playit agent.");
    const binary = Buffer.from(await binaryResponse.arrayBuffer());
    const digest = createHash("sha256").update(binary).digest("hex");
    if (digest !== asset.digest.slice("sha256:".length)) throw new Error("Playit download checksum does not match the official release.");
    await fs.writeFile(playitBinary, binary, { mode: 0o700 });
  }
  playitVersion = release.tag_name;
  playitClaimUrl = undefined;
  playitClaimCode = undefined;
  playitClaimState = undefined;
  playitLog = "";
  playitProcess = spawn(playitBinary, [], { cwd: dirname(playitBinary), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const capture = (chunk: Buffer) => {
    playitLog = `${playitLog}${chunk.toString("utf8")}`.slice(-1200);
    const match = playitLog.match(/https:\/\/playit\.gg\/(?:claim\/[A-Za-z0-9_-]+|claim\?[^\s"']+)/i);
    if (match) playitClaimUrl = match[0].replace(/[),.;]+$/, "");
  };
  playitProcess.stdout?.on("data", capture);
  playitProcess.stderr?.on("data", capture);
  playitProcess.once("error", (error) => { playitLog += `\n${error.message}`; });
  playitProcess.once("exit", (code) => { playitLog += `\nPlayit agent exited (${code ?? "unknown"}).`; if (playitClaimTimer) clearTimeout(playitClaimTimer); playitClaimTimer = undefined; });
  const claimCode = randomBytes(5).toString("hex");
  try {
    await playitCloudPost("/claim/setup", { code: claimCode, agent_type: "assignable", version: `playit ${playitVersion}` });
  } catch (error) {
    playitProcess.kill(); playitProcess = undefined;
    throw new Error(`Could not prepare the official Playit claim: ${(error as Error).message}`);
  }
  playitClaimCode = claimCode;
  playitClaimState = "waiting";
  playitClaimUrl = `https://playit.gg/claim/${claimCode}`;
  schedulePlayitClaimCheck(++playitClaimEpoch);
  await activity(instance.id, "network.playit.started", `Started Playit ${playitVersion}`);
  return ok({ started: true, version: playitVersion, localHost: "127.0.0.1", localPort: instance.port, claimUrl: playitClaimUrl });
});
app.post("/api/playit/stop", async () => {
  playitClaimEpoch++;
  if (playitClaimTimer) clearTimeout(playitClaimTimer);
  playitClaimTimer = undefined;
  if (playitProcess && playitProcess.exitCode === null && !playitProcess.killed) playitProcess.kill();
  playitProcess = undefined;
  return ok({ stopped: true });
});
app.get("/api/instances/:id/activity", async (req) =>
  ok(
    await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.instanceId, (req.params as any).id))
      .orderBy(desc(activityEvents.createdAt))
      .limit(100),
  ),
);
app.get("/api/instances/:id/tasks", async (req) =>
  ok(
    await db
      .select()
      .from(scheduledTasks)
      .where(eq(scheduledTasks.instanceId, (req.params as any).id)),
  ),
);
app.post("/api/instances/:id/tasks", async (req, reply) => {
  const b = req.body as any;
  const action = b.action === "command" ? "command" : b.action === "backup" ? "backup" : null;
  if (!action) throw new Error("Scheduled action is not supported.");
  const payload = action === "command" ? [...String(b.command ?? "")].map((character) => character.charCodeAt(0) < 32 ? " " : character).join("").trim().slice(0, 240) : "";
  if (action === "command" && (!payload || !/^say\s+\S/i.test(payload))) throw new Error("Scheduled announcements must use the say command.");
  const expression = CronExpressionParser.parse(String(b.cron));
  const row = {
    id: randomUUID(),
    instanceId: (req.params as any).id,
    name: String(b.name),
    enabled: true,
    cron: String(b.cron),
    action,
    payloadJson: action === "command" ? JSON.stringify({ command: payload }) : null,
    lastRun: null,
    nextRun: expression.next().toDate().toISOString(),
    lastResult: null,
  };
  await db.insert(scheduledTasks).values(row);
  return reply.code(201).send(ok(row));
});
setInterval(() => {
  void (async () => {
    const now = new Date();
    const tasks = await db.select().from(scheduledTasks);
    for (const task of tasks.filter(
      (t) => t.enabled && t.nextRun && new Date(t.nextRun) <= now,
    )) {
      let result = "success";
      try {
        const i = await getInstance(task.instanceId);
        if (task.action === "command") {
          const command = String((task.payloadJson ? JSON.parse(task.payloadJson) : {}).command ?? "");
          const state: any = await agent(`/instances/${i.id}/status`);
          if (!state.running) result = "skipped · server offline";
          else { await agent(`/instances/${i.id}/command`, { method: "POST", body: JSON.stringify({ command }) }); await activity(i.id, "announcement.sent", task.name); }
        } else {
        const id = randomUUID(),
          createdAt = new Date().toISOString(),
          name = `scheduled-${createdAt.replace(/[:.]/g, "-")}`,
          path = join(i.path, "backups", `${id}.zip`);
        await zipDirectory(i.path, path, ["backups/**", "logs/**"]);
        const stat = await fs.stat(path);
        await db.insert(backups).values({
          id,
          instanceId: i.id,
          path,
          name,
          size: stat.size,
          description: `Created by ${task.name}`,
          automatic: true,
          createdAt,
        });
        await activity(i.id, "backup.created", `Scheduled backup ${name}`);
        }
      } catch (error) {
        result = (error as Error).message;
        app.log.error(error);
      }
      const next = CronExpressionParser.parse(task.cron, { currentDate: now })
        .next()
        .toDate()
        .toISOString();
      await db
        .update(scheduledTasks)
        .set({ lastRun: now.toISOString(), nextRun: next, lastResult: result })
        .where(eq(scheduledTasks.id, task.id));
    }
  })().catch((error) => app.log.error(error));
}, 15_000).unref();
app.get("/api/diagnostics", async () => {
  let agentHealth: any;
  try {
    agentHealth = await agent("/health");
  } catch (e) {
    agentHealth = { error: (e as Error).message };
  }
  return ok({
    appVersion: "0.1.0",
    api: "ready",
    database: "ready",
    agent: agentHealth,
    dataDirectory: dataDir,
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    providers: [...providerRegistry.values()].map((p) => ({
      id: p.id,
      name: p.name,
      status: "configured",
    })),
  });
});
const port = Number(process.env.SALVADIUX_API_PORT ?? 3210);
await app.listen({ host: "127.0.0.1", port });
