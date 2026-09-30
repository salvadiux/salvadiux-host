import { describe, expect, it } from 'vitest';
import { compatible } from '../packages/providers/src/index.js';
import { parseProperties, updateProperties } from '../packages/config-engine/src/index.js';
import { safeResolve } from '../packages/filesystem/src/index.js';
import { instanceCreateSchema } from '../packages/shared/src/index.js';
import { createDatabase, instances, networkMembers, networks } from '../packages/database/src/index.js';
import { hashNetworkServiceToken, matchesNetworkServiceToken, registerNetworkRoutes, removeYamlPath, setYamlPath } from '../apps/api/src/network.js';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('safeResolve', () => {
  it('keeps paths inside root', () => {
    expect(safeResolve('/srv/a', 'plugins/x.jar')).toContain('plugins');
  });

  it('rejects traversal and absolute paths', () => {
    expect(() => safeResolve('/srv/a', '../../etc/passwd')).toThrow();
    expect(() => safeResolve('/srv/a', '/etc/passwd')).toThrow();
  });
});

describe('properties', () => {
  it('parses and updates the same source', () => {
    const source = '# x\nmotd=Hello\npvp=true\n';
    expect(parseProperties(source).motd).toBe('Hello');
    expect(updateProperties(source, { motd: 'World' })).toContain('motd=World');
  });
});

describe('compatibility', () => {
  const version = {
    id: '1',
    projectId: 'p',
    provider: 'x',
    name: 'x',
    gameVersions: ['1.21.4'],
    platforms: ['paper'],
    releaseType: 'release' as const,
    fileName: 'x.jar',
    fileUrl: 'https://x',
    dependencies: [],
  };

  it('accepts Paper metadata on Purpur and rejects a wrong game version', () => {
    expect(compatible(version, { software: 'purpur', minecraftVersion: '1.21.4', capabilities: [] })).toBe(true);
    expect(compatible(version, { software: 'paper', minecraftVersion: '1.20.1', capabilities: [] })).toBe(false);
  });

  it('accepts Velocity plugin metadata', () => {
    expect(compatible({ ...version, platforms: ['velocity'] }, { software: 'velocity', minecraftVersion: '1.21.4', capabilities: [] })).toBe(true);
  });
});

describe('instance creation schema', () => {
  const base = {
    name: 'Salvadiux',
    software: 'velocity' as const,
    minecraftVersion: '1.21.4',
    softwareVersion: '3.4.0',
    minMemoryMb: 512,
    maxMemoryMb: 1024,
  };

  it('allows a Velocity proxy without a Minecraft EULA checkbox', () => {
    expect(instanceCreateSchema.safeParse(base).success).toBe(true);
  });

  it('requires a Velocity release and an accepted EULA for game servers', () => {
    expect(instanceCreateSchema.safeParse({ ...base, softwareVersion: undefined }).success).toBe(false);
    expect(instanceCreateSchema.safeParse({ ...base, software: 'paper', softwareVersion: undefined }).success).toBe(false);
  });
});

describe('Velocity forwarding YAML helpers', () => {
  it('updates only the requested Paper proxy values', () => {
    const original = 'proxies:\n  bungee-cord:\n    online-mode: true\n';
    const configured = setYamlPath(original, ['proxies', 'velocity'], 'enabled', 'true');
    expect(configured).toContain('bungee-cord:\n    online-mode: true');
    expect(configured).toContain('velocity:\n    enabled: true');
  });

  it('removes the generated forwarding section while preserving other proxy settings', () => {
    const original = 'proxies:\n  bungee-cord:\n    online-mode: true\n  velocity:\n    enabled: true\n    online-mode: true\n    secret: "secret-value"\nother-setting: false\n';
    const restored = removeYamlPath(original, ['proxies', 'velocity']);
    expect(restored).toContain('bungee-cord:\n    online-mode: true');
    expect(restored).toContain('other-setting: false');
    expect(restored).not.toContain('velocity:');
    expect(restored).not.toContain('secret-value');
  });

  it('removes an empty generated proxy file cleanly', () => {
    expect(removeYamlPath('proxies:\n  velocity:\n    enabled: true\n', ['proxies', 'velocity']).trim()).toBe('');
  });
});

describe('network service storage and credentials', () => {
  it('creates the network location tables and secret hash column for a fresh host database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'salvadiux-host-test-'));
    const { sqlite } = createDatabase(join(directory, 'host.sqlite'));
    try {
      const networkColumns = sqlite.pragma('table_info(networks)') as { name: string }[];
      const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
      expect(networkColumns.map((column) => column.name)).toContain('service_token_hash');
      expect(tables.map((table) => table.name)).toContain('player_mode_locations');
      expect(tables.map((table) => table.name)).toContain('player_mode_profiles');
    } finally {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('hashes network credentials and compares them safely', () => {
    const token = 'network-service-secret';
    expect(matchesNetworkServiceToken(token, hashNetworkServiceToken(token))).toBe(true);
    expect(matchesNetworkServiceToken('wrong-secret', hashNetworkServiceToken(token))).toBe(false);
    expect(matchesNetworkServiceToken(token, 'not-a-sha256-hash')).toBe(false);
  });

  it('accepts location updates only from the network token and a registered mode backend', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'salvadiux-location-test-'));
    const { db, sqlite } = createDatabase(join(directory, 'host.sqlite'));
    const token = 'network-location-test-token';
    const routeHandlers = new Map<string, (...args: any[]) => Promise<any>>();
    const fakeApp = Object.fromEntries(['get', 'post', 'delete'].map((method) => [method, (path: string, ...args: any[]) => routeHandlers.set(`${method.toUpperCase()} ${path}`, args.at(-1))])) as any;
    try {
      await db.insert(instances).values({ id: 'proxy', name: 'Proxy', software: 'velocity', softwareVersion: '3.4.0', minecraftVersion: '1.21.1', build: null, path: join(directory, 'proxy'), status: 'offline', minMemoryMb: 512, maxMemoryMb: 1024, host: '127.0.0.1', port: 25570, javaMajor: 21, runtimeId: null, pid: null, favorite: false, restartRequired: false, createdAt: 'now', updatedAt: 'now' });
      await db.insert(instances).values({ id: 'survival', name: 'Survival', software: 'paper', softwareVersion: null, minecraftVersion: '1.21.1', build: null, path: join(directory, 'survival'), status: 'offline', minMemoryMb: 1024, maxMemoryMb: 2048, host: '127.0.0.1', port: 25571, javaMajor: 21, runtimeId: null, pid: null, favorite: false, restartRequired: false, createdAt: 'now', updatedAt: 'now' });
      await db.insert(networks).values({ id: 'network', name: 'Network', minecraftVersion: '1.21.1', proxyInstanceId: 'proxy', serviceTokenHash: hashNetworkServiceToken(token), createdAt: 'now', updatedAt: 'now' });
      await db.insert(networkMembers).values({ id: 'member', networkId: 'network', instanceId: 'survival', role: 'survival', alias: 'survival-1', priority: 0 });
      registerNetworkRoutes(fakeApp, { db, getInstance: async () => ({}), agent: async () => ({ running: false }), startInstance: async () => ({ alreadyRunning: true }), stopInstance: async () => ({ alreadyStopped: true }), activity: async () => undefined, ok: (data) => ({ ok: true, data }), safeResolve, updateProperties });
      const update = routeHandlers.get('POST /api/internal/networks/:id/players/location')!;
      const request = { params: { id: 'network' }, headers: { authorization: `Bearer ${token}` }, body: { uuid: 'player-uuid', name: 'PlayerOne', mode: 'survival', realmId: 'survival', serverAlias: 'survival-1', worldKey: 'world', x: 20.5, y: 71, z: -4, yaw: 90, pitch: 0 } };
      expect((await update(request)).data.saved).toBe(true);
      const read = routeHandlers.get('GET /api/internal/networks/:id/players/location')!;
      const location = await read({ params: { id: 'network' }, headers: { authorization: `Bearer ${token}` }, query: { uuid: 'player-uuid', mode: 'survival' } });
      expect(location.data.location).toMatchObject({ worldKey: 'world', x: 20.5, y: 71, z: -4, serverAlias: 'survival-1' });
      const saveProfile = routeHandlers.get('POST /api/internal/networks/:id/players/profile')!;
      expect((await saveProfile({ ...request, body: { ...request.body, profile: { inventory: 'serialized-items', health: 20 } } })).data.saved).toBe(true);
      const getProfile = routeHandlers.get('GET /api/internal/networks/:id/players/profile')!;
      const profile = await getProfile({ params: { id: 'network' }, headers: { authorization: `Bearer ${token}` }, query: { uuid: 'player-uuid', mode: 'survival' } });
      expect(profile.data.profile).toMatchObject({ inventory: 'serialized-items', health: 20 });
      await expect(update({ ...request, headers: { authorization: 'Bearer wrong-token' } })).rejects.toMatchObject({ statusCode: 401 });
      await expect(update({ ...request, body: { ...request.body, serverAlias: 'creative-1' } })).rejects.toMatchObject({ statusCode: 403 });
    } finally {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('installs the network core and restores every changed file when a topology is removed', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'salvadiux-network-test-'));
    const { db, sqlite } = createDatabase(join(directory, 'host.sqlite'));
    const proxyPath = join(directory, 'proxy');
    const hubPath = join(directory, 'hub');
    const survivalPath = join(directory, 'survival');
    const routeHandlers = new Map<string, (...args: any[]) => Promise<any>>();
    const fakeApp = Object.fromEntries(['get', 'post', 'delete'].map((method) => [method, (path: string, ...args: any[]) => routeHandlers.set(`${method.toUpperCase()} ${path}`, args.at(-1))])) as any;
    try {
      const pluginJar = join(process.cwd(), 'server-plugin', 'build', 'libs', 'SalvadiuxNetworkCore-0.1.0.jar');
      expect(existsSync(pluginJar)).toBe(true);
      for (const path of [proxyPath, hubPath, survivalPath]) mkdirSync(path, { recursive: true });
      mkdirSync(join(hubPath, 'plugins'), { recursive: true });
      mkdirSync(join(survivalPath, 'plugins'), { recursive: true });
      writeFileSync(join(proxyPath, 'forwarding.secret'), 'test-forwarding-secret');
      writeFileSync(join(proxyPath, 'velocity.toml'), '# original velocity config\n');
      const originalProperties = 'online-mode=true\nserver-ip=127.0.0.1\nmotd=Original\n';
      writeFileSync(join(hubPath, 'server.properties'), originalProperties);
      writeFileSync(join(survivalPath, 'server.properties'), originalProperties);
      const instance = (id: string, name: string, software: string, path: string, port: number) => ({ id, name, software, softwareVersion: software === 'velocity' ? '3.4.0' : null, minecraftVersion: '1.21.1', build: null, path, status: 'offline', minMemoryMb: 512, maxMemoryMb: 1024, host: '127.0.0.1', port, javaMajor: 21, runtimeId: null, pid: null, favorite: false, restartRequired: false, createdAt: 'now', updatedAt: 'now' });
      const testInstances = [instance('proxy', 'Proxy', 'velocity', proxyPath, 25570), instance('hub', 'Hub', 'paper', hubPath, 25571), instance('survival', 'Survival', 'paper', survivalPath, 25572)];
      for (const row of testInstances) await db.insert(instances).values(row);
      const running = new Set<string>();
      const startOrder: string[] = [];
      const stopOrder: string[] = [];
      registerNetworkRoutes(fakeApp, { db, getInstance: async (id: string) => { const row = testInstances.find((candidate) => candidate.id === id); if (!row) throw new Error('Missing instance'); return row; }, agent: async (path: string) => { const id = /\/instances\/([^/]+)\/status/.exec(path)?.[1]; return { running: id ? running.has(id) : false, status: id && running.has(id) ? 'online' : 'offline' }; }, startInstance: async (id: string) => { startOrder.push(id); running.add(id); return { alreadyRunning: false }; }, stopInstance: async (id: string) => { stopOrder.push(id); const alreadyStopped = !running.has(id); running.delete(id); return { alreadyStopped }; }, activity: async () => undefined, ok: (data) => ({ ok: true, data }), safeResolve, updateProperties });
      const create = routeHandlers.get('POST /api/networks')!;
      const reply = { statusCode: 200, body: undefined as any, code(statusCode: number) { this.statusCode = statusCode; return this; }, send(body: any) { this.body = body; return body; } };
      await create({ body: { name: 'Test network', proxyInstanceId: 'proxy', members: [{ instanceId: 'hub', role: 'hub', alias: 'hub', priority: 0 }, { instanceId: 'survival', role: 'survival', alias: 'survival-1', priority: 1 }] } }, reply);
      expect(reply.statusCode).toBe(201);
      expect(reply.body.data).toMatchObject({ forwardingMode: 'modern', corePluginInstalled: true, modeLocationSync: true });
      expect(readFileSync(join(proxyPath, 'velocity.toml'), 'utf8')).toContain('player-info-forwarding-mode = "modern"');
      expect(readFileSync(join(proxyPath, 'velocity.toml'), 'utf8')).toContain('[forced-hosts]');
      expect(readFileSync(join(hubPath, 'server.properties'), 'utf8')).toContain('online-mode=false');
      expect(readFileSync(join(hubPath, 'config', 'paper-global.yml'), 'utf8')).toContain('secret: "test-forwarding-secret"');
      expect(existsSync(join(hubPath, 'plugins', 'SalvadiuxNetworkCore.jar'))).toBe(true);
      const generatedConfig = readFileSync(join(hubPath, 'plugins', 'SalvadiuxNetworkCore', 'config.yml'), 'utf8');
      const accessToken = /^access-token: "([^"]+)"$/m.exec(generatedConfig)?.[1];
      expect(accessToken).toBeTruthy();
      expect(JSON.stringify(reply.body)).not.toContain(accessToken!);
      const startNetwork = routeHandlers.get('POST /api/networks/:id/start')!;
      const started = await startNetwork({ params: { id: reply.body.data.id } });
      expect(started.data.status).toBe('online');
      expect(startOrder).toEqual(['hub', 'survival', 'proxy']);
      const stopNetwork = routeHandlers.get('POST /api/networks/:id/stop')!;
      const stopped = await stopNetwork({ params: { id: reply.body.data.id } });
      expect(stopped.data.status).toBe('offline');
      expect(stopOrder).toEqual(['proxy', 'survival', 'hub']);
      const remove = routeHandlers.get('DELETE /api/networks/:id')!;
      await remove({ params: { id: reply.body.data.id } });
      expect(readFileSync(join(proxyPath, 'velocity.toml'), 'utf8')).toBe('# original velocity config\n');
      expect(parseProperties(readFileSync(join(hubPath, 'server.properties'), 'utf8'))['online-mode']).toBe('true');
      expect(existsSync(join(hubPath, 'config', 'paper-global.yml'))).toBe(false);
      expect(existsSync(join(hubPath, 'plugins', 'SalvadiuxNetworkCore.jar'))).toBe(false);
      expect(existsSync(join(hubPath, 'plugins', 'SalvadiuxNetworkCore', 'config.yml'))).toBe(false);
    } finally {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
