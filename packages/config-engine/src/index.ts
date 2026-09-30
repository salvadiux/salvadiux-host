export function parseProperties(source: string): Record<string,string> {
  const result: Record<string,string> = {};
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const index = line.search(/(?<!\\)[=:]/);
    if (index < 0) result[line] = '';
    else result[line.slice(0,index).trim()] = line.slice(index+1).trim();
  }
  return result;
}
export function updateProperties(source:string, updates:Record<string,string>):string {
  const remaining = new Map(Object.entries(updates));
  const lines = source.split(/\r?\n/).map((raw) => {
    const line=raw.trim(); const index=line.search(/(?<!\\)[=:]/);
    if (!line || line.startsWith('#') || line.startsWith('!') || index<0) return raw;
    const key=line.slice(0,index).trim(); const value=remaining.get(key);
    if (value===undefined) return raw; remaining.delete(key); return `${key}=${value}`;
  });
  for (const [key,value] of remaining) lines.push(`${key}=${value}`);
  return lines.join('\n').replace(/\n*$/, '\n');
}
