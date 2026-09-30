import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { desc, eq, and, asc, gt } from "drizzle-orm";
import { networks, networkMembers, instances, playerModeLocations, playerModeProfiles, networkModerationEvents } from "@salvadiux/database";

type Dependencies = {
  db: any;
  getInstance: (id: string) => Promise<any>;
  agent: (path: string, init?: RequestInit) => Promise<any>;
  startInstance: (id: string) => Promise<any>;
  stopInstance: (id: string) => Promise<any>;
  activity: (instanceId: string | undefined, type: string, message: string, details?: unknown) => Promise<void>;
  ok: (data: unknown) => unknown;
  safeResolve: (root: string, relativePath: string) => string;
  updateProperties: (source: string, values: Record<string, string>) => string;
};

const roles = new Set(["gateway", "hub", "survival", "creative", "minigame", "events"]);
const pluginJar = resolve(dirname(fileURLToPath(import.meta.url)), "../../../server-plugin/build/libs/SalvadiuxNetworkCore-0.1.0.jar");

export function hashNetworkServiceToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function matchesNetworkServiceToken(token: string, expectedHash: string) {
  const expected = Buffer.from(expectedHash, "hex");
  const supplied = Buffer.from(hashNetworkServiceToken(token), "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function setYamlPath(source: string, path: string[], key: string, value: string) {
  const lines = source.split(/\r?\n/);
  let start = 0;
  let end = lines.length;
  for (let depth = 0; depth < path.length; depth++) {
    const indent = " ".repeat(depth * 2);
    const matcher = new RegExp(`^${indent}${path[depth]}\\s*:`);
    let found = -1;
    for (let index = start; index < end; index++) {
      if (matcher.test(lines[index] ?? "")) { found = index; break; }
    }
    if (found < 0) {
      found = end;
      lines.splice(found, 0, `${indent}${path[depth]}:`);
    }
    start = found + 1;
    end = lines.length;
    for (let index = start; index < lines.length; index++) {
      const line = lines[index] ?? "";
      if (line.trim() && !line.trimStart().startsWith("#") && (line.match(/^ */)?.[0].length ?? 0) <= depth * 2) { end = index; break; }
    }
  }
  const indent = " ".repeat(path.length * 2);
  const matcher = new RegExp(`^${indent}${key}\\s*:`);
  const existing = lines.findIndex((line, index) => index >= start && index < end && matcher.test(line));
  if (existing >= 0) lines[existing] = `${indent}${key}: ${value}`;
  else lines.splice(end, 0, `${indent}${key}: ${value}`);
  return lines.join("\n").replace(/\n*$/, "\n");
}

export function removeYamlPath(source: string, path: string[]) {
  const lines = source.split(/\r?\n/);
  const locate = (from: number, to: number, depth: number, key: string) => {
    const indent = " ".repeat(depth * 2);
    const matcher = new RegExp(`^${indent}${key}\\s*:`);
    for (let index = from; index < to; index++) if (matcher.test(lines[index] ?? "")) return index;
    return -1;
  };
  let from = 0;
  let to = lines.length;
  const parents: { start: number; end: number; depth: number }[] = [];
  for (let depth = 0; depth < path.length; depth++) {
    const start = locate(from, to, depth, path[depth]!);
    if (start < 0) return source;
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index++) {
      const line = lines[index] ?? "";
      if (line.trim() && !line.trimStart().startsWith("#") && (line.match(/^ */)?.[0].length ?? 0) <= depth * 2) { end = index; break; }
    }
    parents.push({ start, end, depth });
    from = start + 1;
    to = end;
  }
  const target = parents.at(-1)!;
  lines.splice(target.start, target.end - target.start);
  for (let depth = parents.length - 2; depth >= 0; depth--) {
    const parent = parents[depth]!;
    const childIndent = " ".repeat((parent.depth + 1) * 2);
    let end = lines.length;
    for (let index = parent.start + 1; index < lines.length; index++) {
      const line = lines[index] ?? "";
      if (line.trim() && !line.trimStart().startsWith("#") && (line.match(/^ */)?.[0].length ?? 0) <= parent.depth * 2) { end = index; break; }
    }
    const hasChild = lines.slice(parent.start + 1, end).some((line) => line.trim() && !line.trimStart().startsWith("#") && (line.match(/^ */)?.[0].length ?? 0) >= childIndent.length);
    if (!hasChild) lines.splice(parent.start, 1);
  }
  return lines.join("\n").replace(/\n*$/, "\n");
}

function quoteToml(value: string) { return JSON.stringify(value); }

export function registerNetworkRoutes(app: any, dependencies: Dependencies) {
  const { db, getInstance, agent, activity, ok, safeResolve, updateProperties, startInstance, stopInstance } = dependencies;
  const operations = new Map<string, Promise<unknown>>();

  async function awaitState(instance: any, desired: "online" | "offline", timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await agent(`/instances/${instance.id}/status`);
      const status = state.status ?? (state.running ? "online" : "offline");
      await db.update(instances).set({ status, pid: state.pid ?? null, updatedAt: new Date().toISOString() }).where(eq(instances.id, instance.id));
      if (desired === "online" ? status === "online" : !state.running) return state;
      if (status === "offline" && desired === "online") throw new Error(`${instance.name} stopped while starting. Check its console/logs.`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`${instance.name} did not become ${desired === "online" ? "ready" : "stopped"} before the timeout.`);
  }

  async function startNetwork(id: string) {
    const [network] = await db.select().from(networks).where(eq(networks.id, id));
    if (!network) throw Object.assign(new Error("Network not found."), { statusCode: 404 });
    const proxy = await getInstance(network.proxyInstanceId);
    const members = await db.select().from(networkMembers).where(eq(networkMembers.networkId, id));
    if (!members.length) throw new Error("This network has no backend servers configured.");
    const ordered = [...members].sort((a: any, b: any) => {
      const rank = (role: string) => role === "gateway" ? 0 : role === "hub" ? 1 : 2;
      return rank(a.role) - rank(b.role) || a.priority - b.priority;
    });
    const started: string[] = [];
    for (const member of ordered) {
      const instance = await getInstance(member.instanceId);
      const result = await startInstance(instance.id);
      if (!result.alreadyRunning) started.push(instance.name);
      try { await awaitState(instance, "online", 180_000); }
      catch (error) { throw new Error(`Network start paused at ${instance.name}. Started: ${started.join(", ") || "none"}. ${(error as Error).message}`); }
    }
    const proxyResult = await startInstance(proxy.id);
    if (!proxyResult.alreadyRunning) started.push(proxy.name);
    try { await awaitState(proxy, "online", 90_000); }
    catch (error) { throw new Error(`Backends are ready, but the proxy ${proxy.name} did not become ready. ${(error as Error).message}`); }
    await activity(proxy.id, "network.started", `Started network ${network.name}`, { networkId: id, started });
    return { networkId: id, status: "online", started, alreadyRunning: started.length === 0 };
  }

  async function stopNetwork(id: string) {
    const [network] = await db.select().from(networks).where(eq(networks.id, id));
    if (!network) throw Object.assign(new Error("Network not found."), { statusCode: 404 });
    const proxy = await getInstance(network.proxyInstanceId);
    const members = await db.select().from(networkMembers).where(eq(networkMembers.networkId, id));
    const ordered = [...members].sort((a: any, b: any) => b.priority - a.priority);
    const stopped: string[] = [];
    for (const instance of [proxy, ...await Promise.all(ordered.map((member: any) => getInstance(member.instanceId)))]) {
      const result = await stopInstance(instance.id);
      if (!result.alreadyStopped) stopped.push(instance.name);
      if (!result.alreadyStopped) await awaitState(instance, "offline", 60_000);
    }
    await activity(proxy.id, "network.stopped", `Stopped network ${network.name}`, { networkId: id, stopped });
    return { networkId: id, status: "offline", stopped };
  }

  async function runExclusive(id: string, operation: () => Promise<unknown>) {
    const current = operations.get(id);
    if (current) throw Object.assign(new Error("A network operation is already in progress."), { statusCode: 409 });
    const pending = operation();
    operations.set(id, pending);
    try { return await pending; } finally { if (operations.get(id) === pending) operations.delete(id); }
  }

  app.post("/api/networks/:id/start", async (req: any) => ({ ok: true, data: await runExclusive(String(req.params.id), () => startNetwork(String(req.params.id))) }));
  app.post("/api/networks/:id/stop", async (req: any) => ({ ok: true, data: await runExclusive(String(req.params.id), () => stopNetwork(String(req.params.id))) }));

  app.post("/api/networks/:id/members", async (req: any) => {
    const networkId = String(req.params.id);
    const [network] = await db.select().from(networks).where(eq(networks.id, networkId));
    if (!network) throw Object.assign(new Error("Network not found."), { statusCode: 404 });
    const body = req.body as any;
    const instance = await getInstance(String(body.instanceId ?? ""));
    const role = String(body.role ?? "");
    const alias = String(body.alias ?? role).trim().toLowerCase();
    const priority = Number.isFinite(Number(body.priority)) ? Math.max(0, Math.min(1000, Number(body.priority))) : 50;
    if (!roles.has(role) || !/^[a-z][a-z0-9_-]{0,31}$/.test(alias)) throw new Error("Choose a supported role and a unique lowercase alias.");
    if (!["paper", "purpur"].includes(instance.software) || instance.minecraftVersion !== network.minecraftVersion) throw new Error(`Choose a Paper-compatible server running Minecraft ${network.minecraftVersion}.`);
    if (!existsSync(pluginJar)) throw new Error("Build the Salvadiux Network Core plugin before attaching a backend.");
    const [proxy] = await db.select().from(instances).where(eq(instances.id, network.proxyInstanceId));
    if (!proxy) throw new Error("The Velocity proxy for this network no longer exists.");
    for (const node of [proxy, ...await Promise.all((await db.select().from(networkMembers).where(eq(networkMembers.networkId, networkId))).map((member: any) => getInstance(member.instanceId)))]) {
      const state = await agent(`/instances/${node.id}/status`);
      if (state.running) throw Object.assign(new Error(`Stop the whole network before attaching servers; ${node.name} is still running.`), { statusCode: 409 });
    }
    const newState = await agent(`/instances/${instance.id}/status`);
    if (newState.running) throw Object.assign(new Error(`Stop ${instance.name} before attaching it to the network.`), { statusCode: 409 });
    const assigned = await db.select().from(networkMembers).where(eq(networkMembers.instanceId, instance.id));
    if (assigned.length) throw new Error(`${instance.name} already belongs to a network.`);
    const members = await db.select().from(networkMembers).where(eq(networkMembers.networkId, networkId));
    if (members.length >= 64 || members.some((member: any) => member.alias === alias)) throw new Error("Network capacity was reached or the alias is already in use.");
    const proxyConfigPath = safeResolve(proxy.path, "velocity.toml");
    const forwardingPath = safeResolve(proxy.path, "forwarding.secret");
    const propertiesPath = safeResolve(instance.path, "server.properties");
    if (!existsSync(proxyConfigPath) || !existsSync(forwardingPath) || !existsSync(propertiesPath)) throw new Error("The proxy or selected Paper server has not finished its first setup.");
    const configPath = safeResolve(instance.path, "plugins/SalvadiuxNetworkCore/config.yml");
    const sourceMember = members.find((member: any) => member.role === "hub") ?? members.find((member: any) => member.role === "gateway");
    if (!sourceMember) throw new Error("Attach a Hub or Gateway before adding more servers.");
    const sourceConfigPath = safeResolve((await getInstance(sourceMember.instanceId)).path, "plugins/SalvadiuxNetworkCore/config.yml");
    if (!existsSync(sourceConfigPath)) throw new Error("The existing Hub/Gateway is missing its Salvadiux Network Core settings.");
    const { readFile, writeFile, copyFile, mkdir, rm } = await import("node:fs/promises");
    const sourceConfig = await readFile(sourceConfigPath, "utf8");
    const accessToken = /^access-token:\s*"([^"]+)"\s*$/m.exec(sourceConfig)?.[1];
    if (!accessToken || hashNetworkServiceToken(accessToken) !== network.serviceTokenHash) throw new Error("The network service token could not be verified against its saved credentials.");
    const secret = (await readFile(forwardingPath, "utf8")).trim();
    const originalProxyConfig = await readFile(proxyConfigPath, "utf8");
    const assignedHost = "127.0.0.1";
    const proxyAddress = `${assignedHost}:${instance.port}`;
    const ordered = [...members, { alias, role, priority, instanceId: instance.id }].sort((a: any, b: any) => {
      const rank = (value: string) => value === "gateway" ? 0 : value === "hub" ? 1 : 2;
      return rank(a.role) - rank(b.role) || a.priority - b.priority;
    });
    const entries = ordered.map((member: any) => {
      return `${member.alias} = ${quoteToml(member.instanceId === instance.id ? proxyAddress : "")}`;
    });
    for (let index = 0; index < ordered.length; index++) {
      const member = ordered[index] as any;
      if (member.instanceId === instance.id) continue;
      const current = await getInstance(member.instanceId);
      entries[index] = `${member.alias} = ${quoteToml(`${current.host === "::1" ? "[::1]" : current.host}:${current.port}`)}`;
    }
    const firstChoices = ordered.filter((member: any) => member.role === "gateway" || member.role === "hub");
    const fallback = [...firstChoices, ...ordered.filter((member: any) => !firstChoices.includes(member))].map((member: any) => quoteToml(member.alias));
    const serverBlock = `[servers]\n${entries.join("\n")}\ntry = [${fallback.join(", ")}]`;
    const nextProxyConfig = originalProxyConfig.match(/\[servers\][\s\S]*?(?=\n\[|$)/)
      ? originalProxyConfig.replace(/\[servers\][\s\S]*?(?=\n\[|$)/, serverBlock)
      : `${originalProxyConfig.trimEnd()}\n\n${serverBlock}\n`;
    const backupPaths = ["server.properties", "config/paper-global.yml", "plugins/SalvadiuxNetworkCore.jar", "plugins/SalvadiuxNetworkCore/config.yml"];
    const networkBackup = safeResolve(instance.path, `.salvadiux/network-backups/${networkId}`);
    const { existsSync: fileExists } = await import("node:fs");
    const before = new Map<string, string | null>();
    for (const relativePath of backupPaths) {
      const filePath = safeResolve(instance.path, relativePath);
      before.set(relativePath, fileExists(filePath) ? await readFile(filePath).then((data) => data.toString("base64")) : null);
    }
    const props = await readFile(propertiesPath, "utf8");
    const oldGlobalPath = safeResolve(instance.path, "config/paper-global.yml");
    let global = await readFile(oldGlobalPath, "utf8").catch(() => "");
    global = setYamlPath(global, ["proxies", "velocity"], "enabled", "true");
    global = setYamlPath(global, ["proxies", "velocity"], "online-mode", "true");
    global = setYamlPath(global, ["proxies", "velocity"], "secret", JSON.stringify(secret));
    const pluginConfig = `network-id: ${quoteToml(networkId)}\naccess-token: ${quoteToml(accessToken)}\napi-url: ${quoteToml(process.env.SALVADIUX_NETWORK_API_URL ?? "http://127.0.0.1:3210")}\nmode: ${quoteToml(role === "gateway" ? "gateway" : role)}\nrealm-id: ${quoteToml(role)}\nserver-alias: ${quoteToml(alias)}\nhub-alias: ${quoteToml(String((members.find((member: any) => member.role === "hub") ?? sourceMember).alias))}\nmode-servers:\n${[...members, { role, alias }].filter((member: any) => member.role === "survival" || member.role === "creative").map((member: any) => `  ${member.role}: ${quoteToml(member.alias)}`).join("\n")}\ntracking:\n  interval-seconds: 30\n`;
    try {
      await mkdir(networkBackup, { recursive: true });
      for (const relativePath of backupPaths) {
        const originalPath = safeResolve(instance.path, relativePath);
        const backupPath = safeResolve(instance.path, `.salvadiux/network-backups/${networkId}/${relativePath.replaceAll("/", "__")}`);
        if (fileExists(originalPath) && !fileExists(backupPath)) { await mkdir(dirname(backupPath), { recursive: true }); await copyFile(originalPath, backupPath); }
      }
      await writeFile(propertiesPath, updateProperties(props, { "online-mode": "false", "server-ip": assignedHost }), "utf8");
      await mkdir(dirname(oldGlobalPath), { recursive: true });
      await writeFile(oldGlobalPath, global, "utf8");
      const pluginPath = safeResolve(instance.path, "plugins/SalvadiuxNetworkCore.jar");
      await mkdir(dirname(pluginPath), { recursive: true });
      await copyFile(pluginJar, pluginPath);
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, pluginConfig, "utf8");
      await writeFile(proxyConfigPath, nextProxyConfig, "utf8");
      const now = new Date().toISOString();
      await db.insert(networkMembers).values({ id: randomUUID(), networkId, instanceId: instance.id, role, alias, priority });
      await db.update(instances).set({ host: assignedHost, restartRequired: true, updatedAt: now }).where(eq(instances.id, instance.id));
      await db.update(instances).set({ restartRequired: true, updatedAt: now }).where(eq(instances.id, proxy.id));
    } catch (error) {
      await writeFile(proxyConfigPath, originalProxyConfig, "utf8").catch(() => undefined);
      for (const [relativePath, encoded] of before) {
        const target = safeResolve(instance.path, relativePath);
        if (encoded === null) await rm(target, { force: true }).catch(() => undefined);
        else { await mkdir(dirname(target), { recursive: true }).catch(() => undefined); await writeFile(target, Buffer.from(encoded, "base64")).catch(() => undefined); }
      }
      throw error;
    }
    await activity(proxy.id, "network.member.added", `Attached ${instance.name} as ${alias}`, { networkId, instanceId: instance.id, role, alias, proxyAddress });
    return ok({ instanceId: instance.id, name: instance.name, role, alias, address: proxyAddress, restartRequired: true });
  });

  async function backup(instance: any, networkId: string, relativePath: string) {
    const source = safeResolve(instance.path, relativePath);
    if (!existsSync(source)) return null;
    const backupPath = safeResolve(instance.path, `.salvadiux/network-backups/${networkId}/${relativePath.replaceAll("/", "__")}`);
    const { copyFile, mkdir } = await import("node:fs/promises");
    await mkdir(dirname(backupPath), { recursive: true });
    await copyFile(source, backupPath);
    return { source, backupPath };
  }

  app.get("/api/networks", async () => {
    const rows = await db.select().from(networks).orderBy(desc(networks.updatedAt));
    const result = await Promise.all(rows.map(async (network: any) => {
      const [proxy] = await db.select().from(instances).where(eq(instances.id, network.proxyInstanceId));
      const members = await db.select().from(networkMembers).where(eq(networkMembers.networkId, network.id));
      const liveInstance = async (instance: any) => {
        if (!instance) return null;
        try {
          const state = await agent(`/instances/${instance.id}/status`);
          const status = state.status ?? (state.running ? "online" : "offline");
          await db.update(instances).set({ status, pid: state.pid ?? null, updatedAt: new Date().toISOString() }).where(eq(instances.id, instance.id));
          return { ...instance, status };
        } catch { return instance; }
      };
      const liveProxy = await liveInstance(proxy);
      const attached = await Promise.all(members.map(async (member: any) => {
        const [instance] = await db.select().from(instances).where(eq(instances.id, member.instanceId));
        const live = await liveInstance(instance);
        return { ...member, instance: live ? { id: live.id, name: live.name, software: live.software, minecraftVersion: live.minecraftVersion, host: live.host, port: live.port, status: live.status } : null };
      }));
      const recentLocations = await db.select().from(playerModeLocations).where(eq(playerModeLocations.networkId, network.id)).orderBy(desc(playerModeLocations.updatedAt)).limit(8);
      const { serviceTokenHash: _serviceTokenHash, ...safeNetwork } = network;
      return { ...safeNetwork, proxy: liveProxy ? { id: liveProxy.id, name: liveProxy.name, softwareVersion: liveProxy.softwareVersion, host: liveProxy.host, port: liveProxy.port, status: liveProxy.status } : null, members: attached, recentLocations };
    }));
    return ok(result);
  });

  async function authorizeNetworkService(req: any) {
    const networkId = String(req.params.id ?? "");
    const [network] = await db.select().from(networks).where(eq(networks.id, networkId));
    const supplied = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!network || !matchesNetworkServiceToken(supplied, network.serviceTokenHash ?? "")) {
      throw Object.assign(new Error("Invalid network service credential."), { statusCode: 401 });
    }
    return network;
  }

  app.post("/api/internal/networks/:id/players/location", async (req: any) => {
    const network = await authorizeNetworkService(req);
    const body = req.body as any;
    const playerUuid = String(body.uuid ?? "").trim();
    const playerName = String(body.name ?? "").trim();
    const modeId = String(body.mode ?? "").toLowerCase();
    const realmId = String(body.realmId ?? "default").trim();
    const serverAlias = String(body.serverAlias ?? "").trim().toLowerCase();
    const worldKey = String(body.worldKey ?? "").trim();
    const coords = [body.x, body.y, body.z, body.yaw, body.pitch].map(Number);
    if (!playerUuid || playerUuid.length > 64 || !playerName || playerName.length > 32 || /\p{Cc}/u.test(playerName) || !realmId || realmId.length > 64 || !worldKey || worldKey.length > 128 || !["survival", "creative"].includes(modeId) || coords.some((value) => !Number.isFinite(value))) {
      throw new Error("Player location payload is invalid.");
    }
    const [member] = await db.select().from(networkMembers).where(and(eq(networkMembers.networkId, network.id), eq(networkMembers.alias, serverAlias)));
    if (!member || member.role !== modeId) throw Object.assign(new Error("This server is not registered for the requested player mode."), { statusCode: 403 });
    const [x, y, z, yaw, pitch] = coords;
    if (Math.abs(x!) > 30_000_000 || Math.abs(z!) > 30_000_000 || y! < -2048 || y! > 4096 || Math.abs(yaw!) > 360 || Math.abs(pitch!) > 90) throw new Error("Player coordinates are outside allowed bounds.");
    const updatedAt = new Date().toISOString();
    await db.insert(playerModeLocations).values({ id: randomUUID(), networkId: network.id, playerUuid, playerName, modeId, realmId, serverAlias, worldKey, x: x!, y: y!, z: z!, yaw: yaw!, pitch: pitch!, updatedAt }).onConflictDoUpdate({ target: [playerModeLocations.networkId, playerModeLocations.playerUuid, playerModeLocations.modeId], set: { playerName, realmId, serverAlias, worldKey, x: x!, y: y!, z: z!, yaw: yaw!, pitch: pitch!, updatedAt } });
    return ok({ saved: true, mode: modeId, updatedAt });
  });

  app.get("/api/internal/networks/:id/players/location", async (req: any) => {
    const network = await authorizeNetworkService(req);
    const playerUuid = String(req.query.uuid ?? "").trim();
    const modeId = String(req.query.mode ?? "").toLowerCase();
    if (!playerUuid || playerUuid.length > 64 || !["survival", "creative"].includes(modeId)) throw new Error("Player and mode are required.");
    const [location] = await db.select().from(playerModeLocations).where(and(eq(playerModeLocations.networkId, network.id), eq(playerModeLocations.playerUuid, playerUuid), eq(playerModeLocations.modeId, modeId)));
    return ok({ location: location ?? null });
  });

  app.post("/api/internal/networks/:id/players/profile", async (req: any) => {
    const network = await authorizeNetworkService(req);
    const body = req.body as any;
    const playerUuid = String(body.uuid ?? "").trim();
    const playerName = String(body.name ?? "").trim();
    const modeId = String(body.mode ?? "").toLowerCase();
    const serverAlias = String(body.serverAlias ?? "").trim().toLowerCase();
    if (!playerUuid || playerUuid.length > 64 || !playerName || playerName.length > 32 || /\p{Cc}/u.test(playerName) || !["hub", "survival", "creative"].includes(modeId) || !body.profile || typeof body.profile !== "object" || Array.isArray(body.profile)) throw new Error("Player profile payload is invalid.");
    const [member] = await db.select().from(networkMembers).where(and(eq(networkMembers.networkId, network.id), eq(networkMembers.alias, serverAlias)));
    if (!member || member.role !== modeId) throw Object.assign(new Error("This server is not registered for the requested player profile."), { statusCode: 403 });
    const profileJson = JSON.stringify(body.profile);
    if (Buffer.byteLength(profileJson, "utf8") > 512 * 1024) throw Object.assign(new Error("Player profile exceeds the 512 KiB limit."), { statusCode: 413 });
    const updatedAt = new Date().toISOString();
    await db.insert(playerModeProfiles).values({ id: randomUUID(), networkId: network.id, playerUuid, playerName, modeId, profileJson, updatedAt }).onConflictDoUpdate({ target: [playerModeProfiles.networkId, playerModeProfiles.playerUuid, playerModeProfiles.modeId], set: { playerName, profileJson, updatedAt } });
    return ok({ saved: true, mode: modeId, updatedAt });
  });

  app.get("/api/internal/networks/:id/players/profile", async (req: any) => {
    const network = await authorizeNetworkService(req);
    const playerUuid = String(req.query.uuid ?? "").trim();
    const modeId = String(req.query.mode ?? "").toLowerCase();
    if (!playerUuid || playerUuid.length > 64 || !["hub", "survival", "creative"].includes(modeId)) throw new Error("Player and profile mode are required.");
    const [row] = await db.select().from(playerModeProfiles).where(and(eq(playerModeProfiles.networkId, network.id), eq(playerModeProfiles.playerUuid, playerUuid), eq(playerModeProfiles.modeId, modeId)));
    return ok({ profile: row ? { ...JSON.parse(row.profileJson), savedAt: row.updatedAt } : null });
  });

  app.post("/api/internal/networks/:id/moderation/events", async (req: any) => {
    const network = await authorizeNetworkService(req);
    const body = req.body as any;
    const eventKey = String(body.eventKey ?? "").trim();
    const sourceAlias = String(body.sourceAlias ?? "").trim().toLowerCase();
    const event = body.event;
    if (!/^[0-9a-f-]{36}$/i.test(eventKey) || !sourceAlias || sourceAlias.length > 64 || !event || typeof event !== "object" || Array.isArray(event)) throw new Error("Moderation event payload is invalid.");
    const [member] = await db.select().from(networkMembers).where(and(eq(networkMembers.networkId, network.id), eq(networkMembers.alias, sourceAlias)));
    if (!member || !["gateway", "hub", "survival", "creative", "minigame", "events"].includes(member.role)) throw Object.assign(new Error("This server is not registered for network moderation."), { statusCode: 403 });
    const eventJson = JSON.stringify(event);
    if (Buffer.byteLength(eventJson, "utf8") > 16 * 1024) throw Object.assign(new Error("Moderation event exceeds the 16 KiB limit."), { statusCode: 413 });
    const [existing] = await db.select({ sequence: networkModerationEvents.sequence }).from(networkModerationEvents).where(and(eq(networkModerationEvents.networkId, network.id), eq(networkModerationEvents.eventKey, eventKey)));
    if (existing) return ok({ sequence: existing.sequence, duplicate: true });
    const [saved] = await db.insert(networkModerationEvents).values({ networkId: network.id, eventKey, sourceAlias, eventJson, createdAt: new Date().toISOString() }).returning({ sequence: networkModerationEvents.sequence });
    return ok({ sequence: saved?.sequence ?? 0, duplicate: false });
  });

  app.get("/api/internal/networks/:id/moderation/events", async (req: any) => {
    const network = await authorizeNetworkService(req);
    const after = Math.max(0, Number.parseInt(String(req.query.after ?? "0"), 10) || 0);
    const rows = await db.select({ sequence: networkModerationEvents.sequence, eventKey: networkModerationEvents.eventKey, sourceAlias: networkModerationEvents.sourceAlias, eventJson: networkModerationEvents.eventJson, createdAt: networkModerationEvents.createdAt }).from(networkModerationEvents).where(and(eq(networkModerationEvents.networkId, network.id), gt(networkModerationEvents.sequence, after))).orderBy(asc(networkModerationEvents.sequence)).limit(200);
    return ok({ events: rows.map((row: any) => ({ ...row, event: JSON.parse(row.eventJson) })) });
  });

  app.post("/api/networks", async (req: any, reply: any) => {
    const body = req.body as any;
    const name = String(body.name ?? "").trim();
    const proxyId = String(body.proxyInstanceId ?? "");
    const membersInput = Array.isArray(body.members) ? body.members : [];
    let version = String(body.minecraftVersion ?? "");
    if (!name || name.length > 80 || !proxyId || membersInput.length < 1 || membersInput.length > 64) throw new Error("Provide a name, a Velocity proxy, and at least one backend.");
    const proxy = await getInstance(proxyId);
    if (proxy.software !== "velocity") throw new Error("The selected proxy must use Velocity.");
    const existingProxyNetwork = await db.select().from(networks).where(eq(networks.proxyInstanceId, proxyId));
    if (existingProxyNetwork.length) throw new Error(`${proxy.name} already manages a network. Remove that topology before reusing this proxy.`);
    const proxyState = await agent(`/instances/${proxy.id}/status`);
    if (proxyState.running) throw Object.assign(new Error("Stop the proxy before configuring its network."), { statusCode: 409 });

    const memberIds = new Set<string>();
    const aliases = new Set<string>();
    const normalized: { id: string; role: string; alias: string; priority: number; instance: any }[] = [];
    for (const [index, input] of membersInput.entries()) {
      const id = String(input.instanceId ?? "");
      const role = String(input.role ?? "");
      const alias = String(input.alias ?? role).trim().toLowerCase();
      if (id === proxyId || memberIds.has(id) || !roles.has(role) || !/^[a-z][a-z0-9_-]{0,31}$/.test(alias) || aliases.has(alias)) throw new Error("Each backend needs a unique alias and a supported network role.");
      const instance = await getInstance(id);
      if (!["paper", "purpur"].includes(instance.software)) throw new Error(`${instance.name} is not a Paper-compatible backend.`);
      if (!version) version = instance.minecraftVersion;
      if (instance.minecraftVersion !== version) throw new Error(`${instance.name} runs ${instance.minecraftVersion}; all attached backends must use ${version}.`);
      if (!["127.0.0.1", "localhost", "::1"].includes(instance.host)) throw new Error(`${instance.name} must bind to loopback before modern forwarding is enabled.`);
      const state = await agent(`/instances/${id}/status`);
      if (state.running) throw Object.assign(new Error(`Stop ${instance.name} before applying proxy forwarding.`), { statusCode: 409 });
      const assigned = await db.select().from(networkMembers).where(eq(networkMembers.instanceId, id));
      if (assigned.length) throw new Error(`${instance.name} already belongs to a network.`);
      memberIds.add(id); aliases.add(alias);
      normalized.push({ id, role, alias, priority: Number.isFinite(Number(input.priority)) ? Math.max(0, Math.min(1000, Number(input.priority))) : index, instance });
    }
    if (!normalized.some((member) => member.role === "hub" || member.role === "gateway")) throw new Error("Attach a gateway or hub so Velocity has a safe initial destination.");

    const networkId = randomUUID();
    const serviceToken = randomBytes(32).toString("base64url");
    const serviceTokenHash = hashNetworkServiceToken(serviceToken);
    if (!existsSync(pluginJar)) throw new Error("Build the Salvadiux Network Core plugin before creating a network.");
    const secretPath = safeResolve(proxy.path, "forwarding.secret");
    const velocityPath = safeResolve(proxy.path, "velocity.toml");
    if (!existsSync(secretPath) || !existsSync(velocityPath)) throw new Error("The selected Velocity instance has not been initialized by Salvadiux Host.");
    const secret = (await (await import("node:fs/promises")).readFile(secretPath, "utf8")).trim();
    const backups: { source: string; backupPath: string }[] = [];
    const createdFiles: string[] = [];
    try {
      const proxyBackup = await backup(proxy, networkId, "velocity.toml");
      if (proxyBackup) backups.push(proxyBackup);
      const ordered = [...normalized].sort((a, b) => a.priority - b.priority);
      const entries = ordered.map((member) => `${member.alias} = ${quoteToml(`${member.instance.host === "::1" ? "[::1]" : member.instance.host}:${member.instance.port}`)}`);
      const firstChoice = ordered.filter((member) => member.role === "gateway" || member.role === "hub");
      const fallback = [...firstChoice, ...ordered.filter((member) => !firstChoice.includes(member))].map((member) => quoteToml(member.alias));
      const proxyHost = proxy.host === "0.0.0.0" ? "0.0.0.0" : proxy.host;
      const config = `config-version = "2.8"\nbind = ${quoteToml(`${proxyHost}:${proxy.port}`)}\nmotd = "<#8b5cf6>Salvadiux Network</#8b5cf6>"\nshow-max-players = 100\nonline-mode = true\nforce-key-authentication = true\nprevent-client-proxy-connections = false\nplayer-info-forwarding-mode = "modern"\nforwarding-secret-file = "forwarding.secret"\nannounce-forge = false\nkick-existing-players = false\nping-passthrough = "DISABLED"\nsample-players-in-ping = false\n[servers]\n${entries.join("\n")}\ntry = [${fallback.join(", ")}]\n\n[forced-hosts]\n`;
      const { copyFile, mkdir, readFile, writeFile } = await import("node:fs/promises");
      await writeFile(velocityPath, config, "utf8");
      for (const member of normalized) {
        const instance = member.instance;
        const propsPath = safeResolve(instance.path, "server.properties");
        const globalPath = safeResolve(instance.path, "config/paper-global.yml");
        const pluginPath = safeResolve(instance.path, "plugins/SalvadiuxNetworkCore.jar");
        const pluginConfigPath = safeResolve(instance.path, "plugins/SalvadiuxNetworkCore/config.yml");
        const [propsBackup, globalBackup, pluginBackup, pluginConfigBackup] = await Promise.all([backup(instance, networkId, "server.properties"), backup(instance, networkId, "config/paper-global.yml"), backup(instance, networkId, "plugins/SalvadiuxNetworkCore.jar"), backup(instance, networkId, "plugins/SalvadiuxNetworkCore/config.yml")]);
        if (propsBackup) backups.push(propsBackup);
        if (globalBackup) backups.push(globalBackup);
        if (pluginBackup) backups.push(pluginBackup);
        if (pluginConfigBackup) backups.push(pluginConfigBackup);
        if (!globalBackup) createdFiles.push(globalPath);
        if (!pluginBackup) createdFiles.push(pluginPath);
        if (!pluginConfigBackup) createdFiles.push(pluginConfigPath);
        const props = await readFile(propsPath, "utf8");
        await writeFile(propsPath, updateProperties(props, { "online-mode": "false", "server-ip": instance.host === "::1" ? "::1" : "127.0.0.1" }), "utf8");
        const oldGlobal = await readFile(globalPath, "utf8").catch(() => "");
        let nextGlobal = setYamlPath(oldGlobal, ["proxies", "velocity"], "enabled", "true");
        nextGlobal = setYamlPath(nextGlobal, ["proxies", "velocity"], "online-mode", "true");
        nextGlobal = setYamlPath(nextGlobal, ["proxies", "velocity"], "secret", JSON.stringify(secret));
        await mkdir(dirname(globalPath), { recursive: true });
        await writeFile(globalPath, nextGlobal, "utf8");
        await copyFile(pluginJar, pluginPath);
        const hubAlias = normalized.find((candidate) => candidate.role === "hub")?.alias ?? normalized.find((candidate) => candidate.role === "gateway")!.alias;
        const modeServers = normalized.filter((candidate) => candidate.role === "survival" || candidate.role === "creative").map((candidate) => `  ${candidate.role}: ${quoteToml(candidate.alias)}`).join("\n");
        const pluginConfig = `network-id: ${quoteToml(networkId)}\naccess-token: ${quoteToml(serviceToken)}\napi-url: ${quoteToml(process.env.SALVADIUX_NETWORK_API_URL ?? "http://127.0.0.1:3210")}\nmode: ${quoteToml(member.role === "gateway" ? "gateway" : member.role)}\nrealm-id: ${quoteToml(member.role)}\nserver-alias: ${quoteToml(member.alias)}\nhub-alias: ${quoteToml(hubAlias)}\nmode-servers:\n${modeServers}\ntracking:\n  interval-seconds: 30\n`;
        await mkdir(dirname(pluginConfigPath), { recursive: true });
        await writeFile(pluginConfigPath, pluginConfig, "utf8");
      }
      const now = new Date().toISOString();
      db.transaction((tx: any) => {
        tx.insert(networks).values({ id: networkId, name, minecraftVersion: version, proxyInstanceId: proxy.id, serviceTokenHash, createdAt: now, updatedAt: now }).run();
        tx.insert(networkMembers).values(normalized.map((member) => ({ id: randomUUID(), networkId, instanceId: member.id, role: member.role, alias: member.alias, priority: member.priority }))).run();
        for (const instance of [proxy, ...normalized.map((member) => member.instance)]) tx.update(instances).set({ restartRequired: true, updatedAt: now }).where(eq(instances.id, instance.id)).run();
      });
    } catch (error) {
      const { copyFile } = await import("node:fs/promises");
      for (const file of backups.reverse()) await copyFile(file.backupPath, file.source).catch(() => undefined);
      const { rm } = await import("node:fs/promises");
      for (const path of createdFiles) await rm(path, { force: true }).catch(() => undefined);
      throw error;
    }
    await activity(proxy.id, "network.created", `Created network ${name}`, { networkId, backends: normalized.length });
    return reply.code(201).send(ok({ id: networkId, name, proxyInstanceId: proxy.id, members: normalized.map(({ id: instanceId, role, alias }) => ({ instanceId, role, alias })), forwardingMode: "modern", forwardingConfigured: true, corePluginInstalled: true, modeLocationSync: true, configPath: "velocity.toml" }));
  });

  app.delete("/api/networks/:id", async (req: any) => {
    const id = String(req.params.id);
    const [network] = await db.select().from(networks).where(eq(networks.id, id));
    if (!network) throw Object.assign(new Error("Network not found."), { statusCode: 404 });
    const proxy = await getInstance(network.proxyInstanceId);
    const members = await db.select().from(networkMembers).where(eq(networkMembers.networkId, id));
    const attached = [proxy, ...await Promise.all(members.map((member: any) => getInstance(member.instanceId)))];
    for (const instance of attached) {
      const state = await agent(`/instances/${instance.id}/status`);
      if (state.running) throw Object.assign(new Error(`Stop ${instance.name} before restoring its original network configuration.`), { statusCode: 409 });
    }
    const { copyFile } = await import("node:fs/promises");
    for (const instance of attached) {
      for (const relativePath of instance.software === "velocity" ? ["velocity.toml"] : ["server.properties", "config/paper-global.yml", "plugins/SalvadiuxNetworkCore.jar", "plugins/SalvadiuxNetworkCore/config.yml"]) {
        const backupPath = safeResolve(instance.path, `.salvadiux/network-backups/${id}/${relativePath.replaceAll("/", "__")}`);
        const originalPath = safeResolve(instance.path, relativePath);
        if (existsSync(backupPath)) await copyFile(backupPath, originalPath);
        else if (relativePath.startsWith("plugins/SalvadiuxNetworkCore")) await (await import("node:fs/promises")).rm(originalPath, { force: true });
        else if (relativePath === "config/paper-global.yml" && existsSync(originalPath)) {
          const { readFile, writeFile } = await import("node:fs/promises");
          const raw = await readFile(originalPath, "utf8");
          const restored = removeYamlPath(raw, ["proxies", "velocity"]);
          if (restored.trim()) await writeFile(originalPath, restored, "utf8");
          else await (await import("node:fs/promises")).rm(originalPath, { force: true });
        }
      }
      await db.update(instances).set({ restartRequired: true }).where(eq(instances.id, instance.id));
    }
    await db.delete(networks).where(eq(networks.id, id));
    await activity(proxy.id, "network.restored", `Restored original files for network ${network.name}`, { networkId: id });
    return ok({ restored: true, networkId: id });
  });
}
