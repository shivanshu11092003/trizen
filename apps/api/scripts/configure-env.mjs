import { chmodSync, writeFileSync } from 'node:fs';
import { environment, requireRuntime, runtimeKeys } from './environment.mjs';
const env = environment();
requireRuntime(env);
const values = [...runtimeKeys, 'PUBLIC_ORIGIN', 'DOCS_ENABLED'].filter((key) => env[key] !== undefined);
const target = new URL('../.dev.vars', import.meta.url);
writeFileSync(
  target,
  '# Generated from the root .env for Wrangler. Do not commit.\n' +
    values.map((key) => `${key}=${JSON.stringify(env[key])}`).join('\n') +
    '\n',
  { mode: 0o600 },
);
chmodSync(target, 0o600);
console.log('Worker configuration loaded from the environment.');
