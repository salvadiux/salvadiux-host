import { z } from 'zod';

export const softwareSchema = z.enum(['paper', 'purpur', 'vanilla', 'velocity']);
export const statusSchema = z.enum(['offline', 'installing', 'starting', 'online', 'stopping', 'restarting', 'crashed']);
export const instanceCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  software: softwareSchema,
  minecraftVersion: z.string().min(1),
  softwareVersion: z.string().min(1).optional(),
  build: z.string().optional(),
  minMemoryMb: z.number().int().min(512).max(131072),
  maxMemoryMb: z.number().int().min(512).max(131072),
  host: z.string().default('0.0.0.0'),
  port: z.number().int().min(1).max(65535).default(25565),
  eulaAccepted: z.boolean().optional()
}).refine((value) => value.maxMemoryMb >= value.minMemoryMb, { message: 'Maximum memory must be at least minimum memory' })
  .refine((value) => value.software === 'velocity' || value.eulaAccepted === true, { message: 'Minecraft EULA must be accepted for game servers' })
  .refine((value) => value.software !== 'velocity' || Boolean(value.softwareVersion), { message: 'A Velocity release must be selected' });

export type Software = z.infer<typeof softwareSchema>;
export type InstanceStatus = z.infer<typeof statusSchema>;
export type InstanceCreate = z.infer<typeof instanceCreateSchema>;
export type ServerInstance = InstanceCreate & {
  id: string; path: string; status: InstanceStatus; javaMajor: number;
  runtimeId?: string | null; pid?: number | null; favorite: boolean;
  restartRequired: boolean; createdAt: string; updatedAt: string;
};
export type ServerVersion = { id: string; stable: boolean; experimental?: boolean; javaMajor?: number };
export type ServerBuild = { id: string; stable: boolean; downloadUrl: string; sha256?: string; size?: number };
export type AppError = { code: string; message: string; userMessage?: string; details?: unknown; recoverable: boolean; suggestedAction?: string };
export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: AppError };
export type PluginProject = { id: string; provider: string; name: string; slug?: string; description?: string; iconUrl?: string; authors?: string[]; downloads?: number; updatedAt?: string; sourceUrl?: string };
export type PluginVersion = { id: string; projectId: string; provider: string; name: string; versionNumber?: string; gameVersions: string[]; platforms: string[]; releaseType: 'release'|'beta'|'alpha'|'unknown'; fileName: string; fileUrl: string; dependencies: { projectId: string; required: boolean }[]; hashes?: Record<string,string> };
export type ServerTarget = { minecraftVersion: string; software: Software; capabilities: string[] };
export const capabilities: Record<Software, {plugins:boolean;mods:boolean;paperConfig:boolean;purpurConfig:boolean;bridgeSupported:boolean}> = {
  paper:{plugins:true,mods:false,paperConfig:true,purpurConfig:false,bridgeSupported:true},
  purpur:{plugins:true,mods:false,paperConfig:true,purpurConfig:true,bridgeSupported:true},
  vanilla:{plugins:false,mods:false,paperConfig:false,purpurConfig:false,bridgeSupported:false},
  velocity:{plugins:true,mods:false,paperConfig:false,purpurConfig:false,bridgeSupported:true}
};
