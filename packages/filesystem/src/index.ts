import { isAbsolute, relative, resolve, sep } from 'node:path';

export function safeResolve(root: string, userPath = ''): string {
  if (isAbsolute(userPath)) throw new Error('Absolute paths are not allowed');
  const target = resolve(root, userPath);
  const rel = relative(resolve(root), target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Path escapes the instance directory');
  return target;
}

export function isTextFile(path: string): boolean {
  return /\.(?:ya?ml|json5?|toml|properties|conf|cfg|ini|txt|md|xml|log|csv|java|kt|kts|js|mjs|cjs|ts|tsx|jsx|html?|css|scss|sass|less|sh|bash|bat|cmd|ps1|sql|gradle|lock)$/i.test(path);
}
