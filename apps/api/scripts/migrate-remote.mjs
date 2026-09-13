import { spawnSync } from 'node:child_process';
import { environment } from './environment.mjs';
const env = environment();
if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required in the root .env or process environment.');
const result = spawnSync(
  'supabase',
  ['db', 'push', '--workdir', '../..', '--db-url', env.DATABASE_URL, '--yes'],
  { env, encoding: 'utf8' },
);
let output = (result.stdout ?? '') + (result.stderr ?? '');
for (const value of [env.DATABASE_URL, decodeURIComponent(new URL(env.DATABASE_URL).password)]) {
  if (value) output = output.split(value).join('[redacted]');
}
process.stdout.write(output);
process.exit(result.status ?? 1);
