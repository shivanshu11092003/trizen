import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

export const runtimeKeys = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_STORAGE_BUCKET',
  'CURSOR_SECRET',
  'PIN_PEPPER',
  'IP_HASH_PEPPER',
];

export function environment() {
  const local = new URL('../.dev.vars', import.meta.url);
  const root = new URL('../../../.env', import.meta.url);
  return {
    ...(existsSync(local) ? parseEnv(readFileSync(local, 'utf8')) : {}),
    ...(existsSync(root) ? parseEnv(readFileSync(root, 'utf8')) : {}),
    ...process.env,
  };
}

export function requireRuntime(env) {
  for (const key of runtimeKeys)
    if (!env[key]) throw new Error(`${key} is missing. Configure the repository root .env.`);
}
