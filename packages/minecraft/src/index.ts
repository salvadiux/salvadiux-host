import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { arch, platform } from 'node:process';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import unzipper from 'unzipper';
import type { ServerBuild, ServerVersion, Software } from '@salvadiux/shared';

const USER_AGENT='SalvadiuxHost/0.1.0 (https://github.com/salvadiux/host)';
const request=async<T>(url:string):Promise<T>=>{
 const response=await fetch(url,{headers:{'User-Agent':USER_AGENT,'Accept':'application/json'},signal:AbortSignal.timeout(20_000)});
 if(!response.ok) throw new Error(`Provider returned ${response.status} for ${url}`); return response.json() as Promise<T>;
};
export async function downloadFile(url:string,destination:string,expectedHash?:{algorithm:'sha1'|'sha256';value:string},onProgress?:(done:number,total?:number)=>void){
 mkdirSync(dirname(destination),{recursive:true}); const part=`${destination}.part`; const response=await fetch(url,{headers:{'User-Agent':USER_AGENT},redirect:'follow',signal:AbortSignal.timeout(120_000)});
 if(!response.ok||!response.body) throw new Error(`Download failed (${response.status})`);
 const total=Number(response.headers.get('content-length'))||undefined; let done=0;
 const transform=new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){done+=chunk.byteLength;onProgress?.(done,total);controller.enqueue(chunk)}});
 await pipeline(response.body.pipeThrough(transform),createWriteStream(part));
 if(expectedHash){const hash=createHash(expectedHash.algorithm); await pipeline(createReadStream(part),hash as any); const actual=hash.digest('hex'); if(actual!==expectedHash.value){await fs.rm(part,{force:true});throw new Error(`Checksum mismatch: expected ${expectedHash.value}, received ${actual}`)}}
 await fs.rename(part,destination); return {path:destination,size:done};
}

type Manifest={latest:{release:string;snapshot:string};versions:{id:string;type:'release'|'snapshot'|'old_beta'|'old_alpha';url:string}[]};
let manifestCache:{at:number;value:Manifest}|undefined;
export async function getMinecraftManifest(){if(manifestCache&&Date.now()-manifestCache.at<300_000)return manifestCache.value;const value=await request<Manifest>('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');manifestCache={at:Date.now(),value};return value}
export async function javaRequirement(version:string){const manifest=await getMinecraftManifest();const entry=manifest.versions.find(v=>v.id===version);if(!entry)throw new Error(`Minecraft version ${version} was not found`);const detail=await request<{javaVersion?:{majorVersion:number}}>(entry.url);return detail.javaVersion?.majorVersion??17}

export interface ServerInstaller{id:Software;displayName:string;getVersions(showSnapshots?:boolean):Promise<ServerVersion[]>;getBuilds(version:string):Promise<ServerBuild[]>;resolveJavaRequirement(version:string):Promise<number>}
class PaperInstaller implements ServerInstaller{
 id='paper' as const;displayName='Paper';
 async getVersions(){const data=await request<{versions:Record<string,string[]>}>('https://fill.papermc.io/v3/projects/paper');return Object.values(data.versions).flat().map(id=>({id,stable:true}));}
 async getBuilds(version:string){const data=await request<any[]>(`https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(version)}/builds`);return data.map(b=>{const d=b.downloads?.['server:default'];return{id:String(b.id??b.number),stable:b.channel==='STABLE',downloadUrl:d?.url,sha256:d?.checksums?.sha256,size:d?.size}}).filter(b=>b.downloadUrl)}
 resolveJavaRequirement=javaRequirement;
}
class PurpurInstaller implements ServerInstaller{
 id='purpur' as const;displayName='Purpur';
 async getVersions(){const data=await request<{versions:string[]}>('https://api.purpurmc.org/v2/purpur');return data.versions.slice().reverse().map(id=>({id,stable:true}));}
 async getBuilds(version:string){const data=await request<{builds:{all:number[];latest:number}}>(`https://api.purpurmc.org/v2/purpur/${encodeURIComponent(version)}`);return data.builds.all.slice().reverse().map(id=>({id:String(id),stable:id===data.builds.latest,downloadUrl:`https://api.purpurmc.org/v2/purpur/${encodeURIComponent(version)}/${id}/download`}));}
 resolveJavaRequirement=javaRequirement;
}
class VanillaInstaller implements ServerInstaller{
 id='vanilla' as const;displayName='Vanilla';
 async getVersions(showSnapshots=false){const m=await getMinecraftManifest();return m.versions.filter(v=>v.type==='release'||(showSnapshots&&v.type==='snapshot')).map(v=>({id:v.id,stable:v.type==='release',experimental:v.type==='snapshot'}));}
 async getBuilds(version:string){const m=await getMinecraftManifest();const entry=m.versions.find(v=>v.id===version);if(!entry)throw new Error('Version not found');const d=await request<{downloads:{server?:{url:string;sha1:string;size:number}}}>(entry.url);if(!d.downloads.server)return[];return[{id:version,stable:entry.type==='release',downloadUrl:d.downloads.server.url,sha256:undefined,size:d.downloads.server.size,sha1:d.downloads.server.sha1} as ServerBuild & {sha1:string}]}
 resolveJavaRequirement=javaRequirement;
}
type VelocityBuildEntry={id:number;channel:string;downloads?:{'server:default'?:{url:string;checksums?:{sha256?:string};size?:number}}};
type VelocityVersionEntry={version:{id:string;support?:{status?:string};java?:{version?:{minimum?:number}}};builds:number[]};
type VelocityCatalog={versions:VelocityVersionEntry[]};
class VelocityInstaller implements ServerInstaller{
 id='velocity' as const;displayName='Velocity Proxy';
 private async catalog(){return request<VelocityCatalog>('https://fill.papermc.io/v3/projects/velocity/versions')}
 async getVersions(showSnapshots=false){const catalog=await this.catalog();return catalog.versions.filter(({version})=>showSnapshots||!version.id.toUpperCase().includes('SNAPSHOT')).map(({version})=>({id:version.id,stable:!version.id.toUpperCase().includes('SNAPSHOT')&&version.support?.status==='SUPPORTED',experimental:version.id.toUpperCase().includes('SNAPSHOT'),javaMajor:version.java?.version?.minimum??21}))}
 async getBuilds(version:string){const catalog=await this.catalog();if(!catalog.versions.some((entry)=>entry.version.id===version))throw new Error('Velocity version was not found');const builds=await request<VelocityBuildEntry[]>(`https://fill.papermc.io/v3/projects/velocity/versions/${encodeURIComponent(version)}/builds`);return builds.flatMap((build)=>{const download=build.downloads?.['server:default'];return download?.url?[{id:String(build.id),stable:build.channel==='RECOMMENDED'||build.channel==='STABLE',downloadUrl:download.url,sha256:download.checksums?.sha256,size:download.size}]:[]})}
 async resolveJavaRequirement(version:string){const catalog=await this.catalog();const entry=catalog.versions.find((candidate)=>candidate.version.id===version);if(!entry)throw new Error(`Velocity version ${version} was not found`);return entry.version.java?.version?.minimum??21}
}
export const installerRegistry=new Map<Software,ServerInstaller>([['paper',new PaperInstaller()],['purpur',new PurpurInstaller()],['vanilla',new VanillaInstaller()],['velocity',new VelocityInstaller()]]);

const osName=()=>platform==='win32'?'windows':platform==='darwin'?'mac':'linux';
const archName=()=>arch==='x64'?'x64':arch==='arm64'?'aarch64':arch;
async function findJava(root:string):Promise<string>{const target=platform==='win32'?'java.exe':'java';const entries=await fs.readdir(root,{withFileTypes:true});for(const entry of entries){const p=join(root,entry.name);if(entry.isFile()&&entry.name===target)return p;if(entry.isDirectory()){const found=await findJava(p).catch(()=>undefined);if(found)return found}}throw new Error('Downloaded runtime does not contain Java')}
export async function ensureRuntime(dataDir:string,major:number,onProgress?:(done:number,total?:number)=>void){
 const root=resolve(dataDir,'runtimes',`java${major}-${osName()}-${archName()}`);const marker=join(root,'runtime.json');
 if(existsSync(marker)){const meta=JSON.parse(await fs.readFile(marker,'utf8'));if(existsSync(meta.javaPath))return meta}
 await fs.rm(root,{recursive:true,force:true});mkdirSync(root,{recursive:true});const ext=platform==='win32'?'zip':'tar.gz';const archive=join(root,`runtime.${ext}`);
 const url=`https://api.adoptium.net/v3/binary/latest/${major}/ga/${osName()}/${archName()}/jdk/hotspot/normal/eclipse`;
 await downloadFile(url,archive,undefined,onProgress);if(ext==='zip')await pipeline(createReadStream(archive),unzipper.Extract({path:root}));else await tar.x({file:archive,cwd:root});await fs.rm(archive,{force:true});
 const javaPath=await findJava(root);const meta={id:randomUUID(),javaMajor:major,os:osName(),arch:archName(),javaPath,root,version:`temurin-${major}`,createdAt:new Date().toISOString()};await fs.writeFile(marker,JSON.stringify(meta,null,2));return meta;
}
export async function installServer(instance:{path:string;software:Software;softwareVersion?:string;minecraftVersion:string;build?:string;eulaAccepted?:boolean;host:string;port:number},onProgress?:(done:number,total?:number)=>void){
 const installer=installerRegistry.get(instance.software);if(!installer)throw new Error('Unsupported software');const builds=await installer.getBuilds(instance.software==='velocity'?instance.softwareVersion??'':instance.minecraftVersion);const build=instance.build?builds.find(b=>b.id===instance.build):builds.find(b=>b.stable)??builds[0];if(!build)throw new Error('No downloadable build is available');
 mkdirSync(instance.path,{recursive:true});for(const folder of ['plugins','logs','backups','.salvadiux',...(instance.software==='velocity'?[]:['worlds'])])mkdirSync(join(instance.path,folder),{recursive:true});
 const vanilla=build as ServerBuild&{sha1?:string};await downloadFile(build.downloadUrl,join(instance.path,'server.jar'),build.sha256?{algorithm:'sha256',value:build.sha256}:vanilla.sha1?{algorithm:'sha1',value:vanilla.sha1}:undefined,onProgress);
 if(instance.software==='velocity'){
  if(!existsSync(join(instance.path,'forwarding.secret')))await fs.writeFile(join(instance.path,'forwarding.secret'),randomUUID().replaceAll('-','')+randomUUID().replaceAll('-',''),'utf8');
  if(!existsSync(join(instance.path,'velocity.toml')))await fs.writeFile(join(instance.path,'velocity.toml'),`config-version = "2.7"\nbind = "${instance.host}:${instance.port}"\nmotd = "<#8b5cf6>Salvadiux Network</#8b5cf6>"\nshow-max-players = 100\nonline-mode = true\nforce-key-authentication = true\nprevent-client-proxy-connections = false\nplayer-info-forwarding-mode = "modern"\nforwarding-secret-file = "forwarding.secret"\nannounce-forge = false\nkick-existing-players = false\nping-passthrough = "DISABLED"\nsample-players-in-ping = false\n[servers]\ntry = []\n`,'utf8');
 } else {
  await fs.writeFile(join(instance.path,'eula.txt'),`# Accepted through Salvadiux Host at ${new Date().toISOString()}\neula=${instance.eulaAccepted===true}\n`);
  const props=`server-port=${instance.port}\nserver-ip=${instance.host==='0.0.0.0'?'':instance.host}\nmotd=A Minecraft Server\nonline-mode=true\nenable-query=false\n`;if(!existsSync(join(instance.path,'server.properties')))await fs.writeFile(join(instance.path,'server.properties'),props);
 }
 await fs.writeFile(join(instance.path,'.salvadiux','instance.json'),JSON.stringify({schemaVersion:1,...instance,build:build.id},null,2));return build;
}
