import { promises as fs } from "node:fs";
import { join, relative, sep } from "node:path";
import { homedir } from "node:os";
import { gunzip, inflate, inflateRaw } from "node:zlib";
import { promisify } from "node:util";

const inflateAsync = promisify(inflate);
const gunzipAsync = promisify(gunzip);
const inflateRawAsync = promisify(inflateRaw);
type Nbt = string | number | bigint | Buffer | Nbt[] | { [key: string]: Nbt } | null;
type Region = { id: string; label: string; path: string };
type Chunk = { sections: Array<{ y: number; palette: string[]; data: bigint[]; legacy?: Buffer; biomePalette: string[]; biomeData: bigint[] }>; structures: Array<{ id: string; x: number; y: number; z: number }> };
const regions = new Map<string, { mtime: number; data: Buffer }>();
const chunks = new Map<string, { mtime: number; value: Chunk | null }>();
let textureJarCache: Promise<{ data: Buffer; entries: Map<string, { method: number; compressedSize: number; size: number; offset: number }> } | null> | null = null;

async function findMinecraftJar() {
  const roots = [join(homedir(), "AppData", "Roaming", ".minecraft", "versions"), join(homedir(), "Library", "Application Support", "minecraft", "versions"), join(homedir(), ".minecraft", "versions")];
  const candidates: Array<{ path: string; mtime: number }> = [];
  for (const root of roots) {
    try {
      for (const version of await fs.readdir(root, { withFileTypes: true })) {
        if (!version.isDirectory()) continue;
        const path = join(root, version.name, version.name + ".jar");
        try { const stat = await fs.stat(path); if (stat.isFile()) candidates.push({ path, mtime: stat.mtimeMs }); } catch {}
      }
    } catch {}
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.path;
}
async function minecraftTextureJar() {
  if (!textureJarCache) textureJarCache = (async () => {
    const path = await findMinecraftJar();
    if (!path) return null;
    const data = await fs.readFile(path);
    let end = -1;
    for (let i = Math.max(0, data.length - 65_557); i <= data.length - 22; i++) if (data.readUInt32LE(i) === 0x06054b50) end = i;
    if (end < 0) return null;
    const count = data.readUInt16LE(end + 10), directorySize = data.readUInt32LE(end + 12), directoryStart = data.readUInt32LE(end + 16);
    if (count > 100_000 || directoryStart + directorySize > data.length) return null;
    const entries = new Map<string, { method: number; compressedSize: number; size: number; offset: number }>();
    let cursor = directoryStart;
    for (let i = 0; i < count && cursor + 46 <= data.length; i++) {
      if (data.readUInt32LE(cursor) !== 0x02014b50) break;
      const method = data.readUInt16LE(cursor + 10), compressedSize = data.readUInt32LE(cursor + 20), size = data.readUInt32LE(cursor + 24);
      const nameLength = data.readUInt16LE(cursor + 28), extraLength = data.readUInt16LE(cursor + 30), commentLength = data.readUInt16LE(cursor + 32), offset = data.readUInt32LE(cursor + 42);
      const name = data.toString("utf8", cursor + 46, cursor + 46 + nameLength);
      if (name.startsWith("assets/minecraft/textures/block/") && name.endsWith(".png") && size <= 2_000_000) entries.set(name, { method, compressedSize, size, offset });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return { data, entries };
  })();
  return textureJarCache;
}
function blockTexturePath(block: string) {
  const [namespace, name] = block.includes(":") ? block.split(":", 2) : ["minecraft", block];
  if (namespace !== "minecraft") return null;
  const texture = name === "grass_block" ? "grass_block_top" : name === "water" ? "water_still" : name === "lava" ? "lava_still" : name;
  return `assets/minecraft/textures/block/${texture}.png`;
}

export async function createBlockTextureAtlas(blocks: string[]) {
  const jar = await minecraftTextureJar();
  const items = await Promise.all(blocks.slice(0, 512).map(async (block, index) => {
    const path = blockTexturePath(block);
    const entry = path ? jar?.entries.get(path) : undefined;
    if (!entry || !jar) return `<g id="b${index}"/>`;
    const local = entry.offset;
    if (jar.data.readUInt32LE(local) !== 0x04034b50) return `<g id="b${index}"/>`;
    const nameLength = jar.data.readUInt16LE(local + 26), extraLength = jar.data.readUInt16LE(local + 28), start = local + 30 + nameLength + extraLength;
    const compressed = jar.data.subarray(start, start + entry.compressedSize);
    try {
      const png = entry.method === 0 ? compressed : entry.method === 8 ? await inflateRawAsync(compressed) : null;
      return png ? `<image x="${index * 16}" y="0" width="16" height="16" href="data:image/png;base64,${png.toString("base64")}"/>` : `<g id="b${index}"/>`;
    } catch { return `<g id="b${index}"/>`; }
  }));
  return { textured: items.some((item) => item.startsWith("<image")), svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1, blocks.length) * 16}" height="16" viewBox="0 0 ${Math.max(1, blocks.length) * 16} 16">${items.join("")}</svg>` };
}

class Reader {
  offset = 0;
  constructor(readonly buffer: Buffer) {}
  take(length: number) { if (length < 0 || this.offset + length > this.buffer.length) throw new Error("Invalid NBT length"); const start = this.offset; this.offset += length; return start; }
  u8() { return this.buffer.readUInt8(this.take(1)); }
  i16() { return this.buffer.readInt16BE(this.take(2)); }
  u16() { return this.buffer.readUInt16BE(this.take(2)); }
  i32() { return this.buffer.readInt32BE(this.take(4)); }
  i64() { return this.buffer.readBigInt64BE(this.take(8)); }
  str() { const length = this.u16(); const start = this.take(length); return this.buffer.toString("utf8", start, this.offset); }
}
function payload(reader: Reader, type: number, depth = 0): Nbt {
  if (depth > 48) throw new Error("NBT too deep");
  switch (type) {
    case 1: return reader.buffer.readInt8(reader.take(1));
    case 2: return reader.i16();
    case 3: return reader.i32();
    case 4: return reader.i64();
    case 5: return reader.buffer.readFloatBE(reader.take(4));
    case 6: return reader.buffer.readDoubleBE(reader.take(8));
    case 7: { const n = reader.i32(); if (n < 0 || n > 64_000_000) throw new Error("Invalid NBT byte array"); const start = reader.take(n); return reader.buffer.subarray(start, start + n); }
    case 8: return reader.str();
    case 9: { const child = reader.u8(), n = reader.i32(); if (n < 0 || n > 1_000_000) throw new Error("Invalid NBT list"); return Array.from({ length: n }, () => payload(reader, child, depth + 1)); }
    case 10: { const result: Record<string, Nbt> = {}; for (let n = 0; n < 100_000; n++) { const child = reader.u8(); if (!child) return result; result[reader.str()] = payload(reader, child, depth + 1); } throw new Error("Invalid NBT compound"); }
    case 11: { const n = reader.i32(); if (n < 0 || n > 16_000_000) throw new Error("Invalid NBT int array"); return Array.from({ length: n }, () => reader.i32()); }
    case 12: { const n = reader.i32(); if (n < 0 || n > 16_000_000) throw new Error("Invalid NBT long array"); return Array.from({ length: n }, () => reader.i64()); }
    default: throw new Error("Unsupported NBT tag");
  }
}
function parseNbt(buffer: Buffer): Nbt { const reader = new Reader(buffer); const type = reader.u8(); if (type !== 10) throw new Error("Invalid NBT root"); reader.str(); return payload(reader, type); }
function obj(value: Nbt | undefined): Record<string, Nbt> { return value && typeof value === "object" && !Array.isArray(value) && !Buffer.isBuffer(value) ? value as Record<string, Nbt> : {}; }
function arr(value: Nbt | undefined): Nbt[] { return Array.isArray(value) ? value : []; }
function num(value: Nbt | undefined, fallback = 0) { return typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : fallback; }
function str(value: Nbt | undefined) { return typeof value === "string" ? value : ""; }

export async function findWorldRegions(worldPath: string): Promise<Region[]> {
  const found: Region[] = [];
  const add = async (id: string, label: string, path: string) => { try { if ((await fs.readdir(path)).some((file) => /^r\.-?\d+\.-?\d+\.mca$/i.test(file))) found.push({ id, label, path }); } catch {} };
  await add("overworld", "Overworld", join(worldPath, "region"));
  await add("nether", "Nether", join(worldPath, "DIM-1", "region"));
  await add("end", "The End", join(worldPath, "DIM1", "region"));
  const dimensionRoot = join(worldPath, "dimensions");
  async function walk(path: string, depth: number) {
    if (depth > 5) return;
    let entries; try { entries = await fs.readdir(path, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const next = join(path, entry.name);
      if (entry.name === "region") {
        const parts = relative(dimensionRoot, path).split(sep).filter(Boolean);
        if (parts.length) await add("custom:" + parts.join(":"), parts.join(":"), next);
      } else await walk(next, depth + 1);
    }
  }
  await walk(dimensionRoot, 0);
  let rootEntries: import("node:fs").Dirent[] = [];
  try { rootEntries = await fs.readdir(worldPath, { withFileTypes: true }); } catch {}
  for (const entry of rootEntries) if (entry.isDirectory() && /^DIM-?\d+$/.test(entry.name) && !["DIM-1", "DIM1"].includes(entry.name)) await add("legacy:" + entry.name, entry.name, join(worldPath, entry.name, "region"));
  return found;
}
async function chunkAt(regionPath: string, x: number, z: number): Promise<Chunk | null> {
  const rx = Math.floor(x / 32), rz = Math.floor(z / 32);
  const lx = ((x % 32) + 32) % 32, lz = ((z % 32) + 32) % 32;
  const file = join(regionPath, "r." + rx + "." + rz + ".mca");
  let stat; try { stat = await fs.stat(file); } catch { return null; }
  const key = file + ":" + lx + ":" + lz;
  const cached = chunks.get(key); if (cached?.mtime === stat.mtimeMs) return cached.value;
  let region = regions.get(file);
  if (!region || region.mtime !== stat.mtimeMs) { try { region = { mtime: stat.mtimeMs, data: await fs.readFile(file) }; regions.set(file, region); } catch { return null; } }
  if (region.data.length < 8192) return null;
  const sector = region.data.readUInt32BE((lz * 32 + lx) * 4) >>> 8;
  if (!sector || sector * 4096 + 5 > region.data.length) return null;
  const length = region.data.readUInt32BE(sector * 4096);
  if (length < 2 || length > 64_000_000 || sector * 4096 + 4 + length > region.data.length) return null;
  let compression = region.data[sector * 4096 + 4]!;
  const external = (compression & 0x80) !== 0;
  compression &= 0x7f;
  let bytes = region.data.subarray(sector * 4096 + 5, sector * 4096 + 4 + length);
  if (external) { try { bytes = await fs.readFile(join(regionPath, "c." + x + "." + z + ".mcc")); } catch { return null; } }
  try {
    const raw = compression === 1 ? await gunzipAsync(bytes) : compression === 2 ? await inflateAsync(bytes) : compression === 3 ? bytes : null;
    if (!raw) return null;
    const value = summarize(parseNbt(raw));
    chunks.set(key, { mtime: stat.mtimeMs, value });
    if (chunks.size > 512) chunks.delete(chunks.keys().next().value!);
    if (regions.size > 64) regions.delete(regions.keys().next().value!);
    return value;
  } catch { chunks.set(key, { mtime: stat.mtimeMs, value: null }); return null; }
}
function findBox(value: Nbt, depth: number): number[] | null {
  if (depth > 8) return null;
  const current = obj(value);
  const box = current.BB ?? current.bb;
  if (Array.isArray(box) && box.length >= 6) return box as number[];
  for (const child of Object.values(current)) {
    if (Array.isArray(child)) for (const item of child) { const result = findBox(item, depth + 1); if (result) return result; }
    else if (child && typeof child === "object" && !Buffer.isBuffer(child)) { const result = findBox(child, depth + 1); if (result) return result; }
  }
  return null;
}
function summarize(nbt: Nbt): Chunk | null {
  let root = obj(nbt);
  const level = obj(root.Level); if (Object.keys(level).length) root = level;
  const sections = arr(root.sections ?? root.Sections).map((tag) => {
    const section = obj(tag);
    const blockStates = obj(section.block_states ?? section.BlockStates);
    const palette = arr(blockStates.palette ?? blockStates.Palette).map((item) => str(obj(item).Name ?? obj(item).name));
    const data = arr(blockStates.data ?? blockStates.Data).map((value) => typeof value === "bigint" ? value : BigInt(num(value)));
    const biomeState = obj(section.biomes ?? section.Biomes);
    const biomePalette = arr(biomeState.palette ?? biomeState.Palette).map((value) => str(value));
    const biomeData = arr(biomeState.data ?? biomeState.Data).map((value) => typeof value === "bigint" ? value : BigInt(num(value)));
    return { y: num(section.Y), palette, data, legacy: Buffer.isBuffer(section.Blocks) ? section.Blocks : undefined, biomePalette, biomeData };
  }).filter((section) => section.palette.length || section.legacy).sort((a, b) => b.y - a.y);
  const structureData = obj(root.structures ?? root.Structures);
  const starts = obj(structureData.starts ?? structureData.Starts);
  const structures: Chunk["structures"] = [];
  for (const [id, item] of Object.entries(starts)) {
    const start = obj(item);
    if (str(start.id).toLowerCase() === "invalid" || start.valid === 0) continue;
    let cx = num(start.ChunkX, num(root.xPos)), cy = 0, cz = num(start.ChunkZ, num(root.zPos));
    const box = findBox(start, 0);
    if (box) { cx = Math.floor((box[0]! + box[3]!) / 2 / 16); cy = Math.floor((box[1]! + box[4]!) / 2); cz = Math.floor((box[2]! + box[5]!) / 2 / 16); }
    structures.push({ id: id.replace(/^minecraft:/, "").replaceAll("_", " "), x: cx * 16 + 8, y: cy, z: cz * 16 + 8 });
  }
  return sections.length || structures.length ? { sections, structures } : null;
}

const colors: Record<string, [number, number, number]> = {
  grass_block: [111,157,68], dirt: [119,84,55], coarse_dirt: [122,89,61], podzol: [99,75,51], stone: [119,119,120], granite: [151,112,97], diorite: [184,182,177], andesite: [122,125,123], deepslate: [66,70,73], tuff: [111,116,105], bedrock: [45,45,46], sand: [211,196,132], sandstone: [199,179,116], red_sand: [184,104,54], gravel: [124,121,118], snow: [227,237,240], ice: [131,188,207], packed_ice: [113,164,205], blue_ice: [88,142,213], water: [48,91,134], lava: [220,83,34], netherrack: [119,54,54], crimson_nylium: [117,45,57], warped_nylium: [39,116,112], soul_sand: [81,61,50], basalt: [72,72,79], blackstone: [57,53,60], end_stone: [205,198,127], obsidian: [45,32,73], mycelium: [105,91,112], moss_block: [80,119,68], amethyst_block: [126,82,166], copper_block: [174,107,75], oak_planks: [151,119,74], spruce_planks: [105,79,48], birch_planks: [195,178,120], dark_oak_planks: [74,53,36], oak_leaves: [72,119,60], spruce_leaves: [57,93,70], oak_log: [111,87,57], hay_block: [190,163,53], farmland: [111,82,53], cobblestone: [102,103,103], iron_block: [193,197,196], coal_block: [51,53,54], snow_block: [232,237,238], glass: [160,190,198],
};
function colorOf(block: string): [number, number, number] {
  const name = block.replace(/^minecraft:/, "").split("[")[0] ?? "";
  if (colors[name]) return colors[name]!;
  if (/leaves|sapling|grass|flower|mushroom|moss/.test(name)) return [78,122,65];
  if (name.includes("water")) return [48,91,134];
  if (name.includes("lava")) return [220,83,34];
  if (/wood|log|planks/.test(name)) return [133,101,63];
  if (name.includes("ore")) return [103,105,108];
  let hash = 0; for (const char of block) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return [88 + (hash & 31), 79 + ((hash >>> 5) & 31), 111 + ((hash >>> 10) & 31)];
}
function topBlock(chunk: Chunk | null, x: number, z: number): { block: string; y: number; biome: string } | null {
  if (!chunk) return null;
  const lx = ((x % 16) + 16) % 16, lz = ((z % 16) + 16) % 16;
  for (const section of chunk.sections) {
    const bits = Math.max(4, Math.ceil(Math.log2(section.palette.length)));
    const perLong = Math.floor(64 / bits), mask = (1n << BigInt(bits)) - 1n;
    for (let y = 15; y >= 0; y--) {
      const index = y * 256 + lz * 16 + lx;
      const word = section.data[Math.floor(index / perLong)];
      const paletteIndex = word === undefined ? 0 : Number((word >> BigInt((index % perLong) * bits)) & mask);
      const block = section.palette[paletteIndex] ?? "minecraft:air";
      if (!block.endsWith(":air") && block !== "minecraft:cave_air" && block !== "minecraft:void_air") return { block, y: section.y * 16 + y, biome: biomeAt(section, y, lx, lz) };
    }
    if (section.legacy) for (let y = 15; y >= 0; y--) {
      const id = section.legacy[y * 256 + lz * 16 + lx] ?? 0;
      if (!id) continue;
      const block = id === 2 ? "minecraft:grass_block" : id === 12 ? "minecraft:sand" : id === 7 ? "minecraft:bedrock" : id === 87 ? "minecraft:netherrack" : id === 121 ? "minecraft:end_stone" : "minecraft:stone";
      return { block, y: section.y * 16 + y, biome: "" };
    }
  }
  return null;
}
function biomeAt(section: Chunk["sections"][number], y: number, x: number, z: number) {
  if (!section.biomePalette.length) return "";
  const bits = Math.max(1, Math.ceil(Math.log2(section.biomePalette.length)));
  const perLong = Math.floor(64 / bits);
  const index = Math.floor(y / 4) * 16 + Math.floor(z / 4) * 4 + Math.floor(x / 4);
  const word = section.biomeData[Math.floor(index / perLong)];
  const paletteIndex = word === undefined ? 0 : Number((word >> BigInt((index % perLong) * bits)) & ((1n << BigInt(bits)) - 1n));
  return section.biomePalette[paletteIndex] ?? "";
}
function tintForBiome(biome: string, block: string): [number, number, number] | null {
  const id = biome.replace(/^minecraft:/, "");
  if (!id) return null;
  const water = /water|ice/.test(block);
  if (/swamp|mangrove/.test(id)) return water ? [91, 117, 72] : [104, 125, 59];
  if (/badlands|mesa/.test(id)) return water ? [94, 126, 163] : [198, 133, 68];
  if (/desert/.test(id)) return water ? [76, 143, 193] : [205, 184, 117];
  if (/jungle|bamboo/.test(id)) return water ? [57, 113, 171] : [81, 161, 64];
  if (/taiga|grove/.test(id)) return water ? [61, 115, 157] : [126, 157, 91];
  if (/snow|frozen|ice_spikes|jagged_peaks|frozen_peaks/.test(id)) return water ? [100, 157, 205] : [173, 202, 229];
  if (/savanna/.test(id)) return water ? [76, 141, 180] : [180, 170, 83];
  if (/mushroom/.test(id)) return water ? [93, 117, 155] : [147, 112, 160];
  if (/nether|crimson|warped|soul_sand_valley|basalt_deltas/.test(id)) return null;
  if (/end/.test(id)) return null;
  return water ? [70, 130, 200] : [136, 181, 82];
}

export async function renderMapTile(regionPath: string, centerX: number, centerZ: number, blocksPerPixel: number, width = 512, height = 256) {
  const pixelCount = width * height;
  const pixels = Buffer.alloc(pixelCount * 4), heights = new Int16Array(pixelCount), biomePixels = Buffer.alloc(pixelCount), blockPixels = new Uint16Array(pixelCount);
  heights.fill(-32768);
  const startX = Math.floor(centerX - width * blocksPerPixel / 2), startZ = Math.floor(centerZ - height * blocksPerPixel / 2);
  const loaded = new Map<string, Chunk | null>();
  const markers = new Map<string, { id: string; x: number; y: number; z: number }>();
  const samples: Array<{ block: string; y: number; biome: string } | null> = Array(pixelCount).fill(null);
  const biomeIds = new Map<string, number>();
  const blockIds = new Map<string, number>();
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const x = startX + px * blocksPerPixel, z = startZ + py * blocksPerPixel;
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16), key = cx + "," + cz;
    if (!loaded.has(key)) loaded.set(key, await chunkAt(regionPath, cx, cz));
    const chunk = loaded.get(key) ?? null;
    const block = topBlock(chunk, x, z);
    const index = py * width + px;
    if (block) { samples[index] = block; heights[index] = block.y; if (!blockIds.has(block.block)) blockIds.set(block.block, blockIds.size + 1); blockPixels[index] = blockIds.get(block.block)!; if (block.biome) { if (!biomeIds.has(block.biome)) biomeIds.set(block.biome, biomeIds.size + 1); biomePixels[index] = biomeIds.get(block.biome)!; } }
    for (const marker of chunk?.structures ?? []) if (marker.x >= startX && marker.x < startX + width * blocksPerPixel && marker.z >= startZ && marker.z < startZ + height * blocksPerPixel) markers.set(marker.id + ":" + marker.x + ":" + marker.z, marker);
  }
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const index = py * width + px, sample = samples[index];
    if (!sample) continue;
    let color = colorOf(sample.block);
    const tint = tintForBiome(sample.biome, sample.block);
    const tintable = /grass|leaves|flower|fern|moss|water|seagrass|kelp|vine/.test(sample.block);
    if (tint && tintable) { const amount = sample.block.includes("water") ? 0.72 : 0.46; color = color.map((component, n) => Math.round(component * (1 - amount) + tint[n]! * amount)) as [number, number, number]; }
    const left = heights[index - (px ? 1 : 0)]!, right = heights[index + (px + 1 < width ? 1 : 0)]!;
    const up = heights[index - (py ? width : 0)]!, down = heights[index + (py + 1 < height ? width : 0)]!;
    const neighbors = [left, right, up, down].filter((height) => height !== -32768);
    const slope = neighbors.length ? ((left === -32768 ? 0 : left) - (right === -32768 ? 0 : right) + (up === -32768 ? 0 : up) - (down === -32768 ? 0 : down)) : 0;
    const shade = Math.max(0.68, Math.min(1.25, 1 + slope * 0.022));
    const offset = index * 4;
    pixels[offset] = Math.min(255, Math.round(color[0] * shade)); pixels[offset + 1] = Math.min(255, Math.round(color[1] * shade)); pixels[offset + 2] = Math.min(255, Math.round(color[2] * shade)); pixels[offset + 3] = 255;
  }
  return { pixels, heights: Buffer.from(heights.buffer), biomePixels, blockPixels: Buffer.from(blockPixels.buffer), blockPalette: [...blockIds.keys()], biomes: [...biomeIds.keys()], startX, startZ, structures: [...markers.values()].slice(0, 300), chunksLoaded: [...loaded.values()].filter(Boolean).length, width, height, blocksPerPixel };
}
export async function findWorldSpawn(worldPath: string) {
  try { const compressed = await fs.readFile(join(worldPath, "level.dat")); const root = obj(parseNbt(await gunzipAsync(compressed))); const data = obj(root.Data); return { x: num(data.SpawnX), z: num(data.SpawnZ) }; }
  catch { return { x: 0, z: 0 }; }
}
export async function countLoadedChunks(regionPath: string) {
  let total = 0;
  let files: string[];
  try { files = await fs.readdir(regionPath); } catch { return total; }
  for (const file of files.filter((name) => /^r\.-?\d+\.-?\d+\.mca$/i.test(name))) {
    try { const data = await fs.readFile(join(regionPath, file)); if (data.length < 4096) continue; for (let offset = 0; offset < 4096; offset += 4) if (data.readUInt32BE(offset) >>> 8) total++; }
    catch {}
  }
  return total;
}
