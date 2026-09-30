import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const instances = sqliteTable('instances', {
 id:text('id').primaryKey(), name:text('name').notNull(), description:text('description'), software:text('software').notNull(), softwareVersion:text('software_version'), minecraftVersion:text('minecraft_version').notNull(), build:text('build'), path:text('path').notNull().unique(), status:text('status').notNull(), minMemoryMb:integer('min_memory_mb').notNull(), maxMemoryMb:integer('max_memory_mb').notNull(), host:text('host').notNull(), port:integer('port').notNull(), javaMajor:integer('java_major').notNull(), runtimeId:text('runtime_id'), pid:integer('pid'), favorite:integer('favorite',{mode:'boolean'}).notNull(), restartRequired:integer('restart_required',{mode:'boolean'}).notNull(), createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull()
});
export const runtimes = sqliteTable('runtimes',{id:text('id').primaryKey(),javaMajor:integer('java_major').notNull(),os:text('os').notNull(),arch:text('arch').notNull(),path:text('path').notNull().unique(),version:text('version').notNull(),checksum:text('checksum'),createdAt:text('created_at').notNull()});
export const installedPlugins = sqliteTable('installed_plugins',{id:text('id').primaryKey(),instanceId:text('instance_id').notNull(),provider:text('provider'),projectId:text('project_id'),versionId:text('version_id'),name:text('name').notNull(),fileName:text('file_name').notNull(),managed:integer('managed',{mode:'boolean'}).notNull(),previousFile:text('previous_file'),installedAt:text('installed_at').notNull()});
export const backups = sqliteTable('backups',{id:text('id').primaryKey(),instanceId:text('instance_id').notNull(),path:text('path').notNull(),name:text('name').notNull(),size:integer('size').notNull(),description:text('description'),automatic:integer('automatic',{mode:'boolean'}).notNull(),createdAt:text('created_at').notNull()});
export const scheduledTasks = sqliteTable('scheduled_tasks',{id:text('id').primaryKey(),instanceId:text('instance_id').notNull(),name:text('name').notNull(),enabled:integer('enabled',{mode:'boolean'}).notNull(),cron:text('cron').notNull(),action:text('action').notNull(),payloadJson:text('payload_json'),lastRun:text('last_run'),nextRun:text('next_run'),lastResult:text('last_result')});
export const activityEvents = sqliteTable('activity_events',{id:text('id').primaryKey(),instanceId:text('instance_id'),type:text('type').notNull(),message:text('message').notNull(),detailsJson:text('details_json'),createdAt:text('created_at').notNull()});
export const appSettings = sqliteTable('app_settings',{key:text('key').primaryKey(),valueJson:text('value_json').notNull(),updatedAt:text('updated_at').notNull()});
export const statsHistory = sqliteTable('stats_history',{id:text('id').primaryKey(),instanceId:text('instance_id').notNull(),sampledAt:text('sampled_at').notNull(),serverCpu:real('server_cpu'),serverMemory:integer('server_memory'),players:integer('players'),hostCpu:real('host_cpu'),hostMemory:integer('host_memory'),hostMemoryTotal:integer('host_memory_total')});
export const networks = sqliteTable('networks',{id:text('id').primaryKey(),name:text('name').notNull(),minecraftVersion:text('minecraft_version').notNull(),proxyInstanceId:text('proxy_instance_id').notNull(),serviceTokenHash:text('service_token_hash').notNull().default(''),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()});
export const networkMembers = sqliteTable('network_members',{id:text('id').primaryKey(),networkId:text('network_id').notNull(),instanceId:text('instance_id').notNull(),role:text('role').notNull(),alias:text('alias').notNull(),priority:integer('priority').notNull().default(0)});
export const playerModeLocations = sqliteTable('player_mode_locations',{id:text('id').primaryKey(),networkId:text('network_id').notNull(),playerUuid:text('player_uuid').notNull(),playerName:text('player_name').notNull(),modeId:text('mode_id').notNull(),realmId:text('realm_id').notNull(),serverAlias:text('server_alias').notNull(),worldKey:text('world_key').notNull(),x:real('x').notNull(),y:real('y').notNull(),z:real('z').notNull(),yaw:real('yaw').notNull(),pitch:real('pitch').notNull(),updatedAt:text('updated_at').notNull()});
export const playerModeProfiles = sqliteTable('player_mode_profiles',{id:text('id').primaryKey(),networkId:text('network_id').notNull(),playerUuid:text('player_uuid').notNull(),playerName:text('player_name').notNull(),modeId:text('mode_id').notNull(),profileJson:text('profile_json').notNull(),updatedAt:text('updated_at').notNull()});
export const networkModerationEvents = sqliteTable('network_moderation_events',{sequence:integer('sequence').primaryKey({autoIncrement:true}),networkId:text('network_id').notNull(),eventKey:text('event_key').notNull(),sourceAlias:text('source_alias').notNull(),eventJson:text('event_json').notNull(),createdAt:text('created_at').notNull()});
export type SalvadiuxDb = ReturnType<typeof createDatabase>['db'];
export function createDatabase(filePath:string):{sqlite:Database.Database;db:BetterSQLite3Database}{
 mkdirSync(dirname(filePath),{recursive:true}); const sqlite=new Database(filePath); sqlite.pragma('journal_mode = WAL'); sqlite.pragma('foreign_keys = ON');
 const migration=resolve(dirname(fileURLToPath(import.meta.url)),'../drizzle/0000_initial.sql');
 sqlite.exec(readFileSync(migration,'utf8'));
 const instanceColumns=sqlite.pragma('table_info(instances)') as {name:string}[];
 if(!instanceColumns.some((column)=>column.name==='software_version'))sqlite.exec('ALTER TABLE instances ADD COLUMN software_version TEXT');
 const networkColumns=sqlite.pragma('table_info(networks)') as {name:string}[];
 if(networkColumns.length&&!networkColumns.some((column)=>column.name==='service_token_hash'))sqlite.exec("ALTER TABLE networks ADD COLUMN service_token_hash TEXT NOT NULL DEFAULT ''");
 sqlite.exec('CREATE TABLE IF NOT EXISTS network_moderation_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, network_id TEXT NOT NULL, event_key TEXT NOT NULL, source_alias TEXT NOT NULL, event_json TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(network_id) REFERENCES networks(id) ON DELETE CASCADE, UNIQUE(network_id, event_key))');
 sqlite.exec('CREATE INDEX IF NOT EXISTS idx_network_moderation_events_sequence ON network_moderation_events(network_id, sequence)');
 sqlite.pragma('optimize');
 return { sqlite, db:drizzle(sqlite) };
}
