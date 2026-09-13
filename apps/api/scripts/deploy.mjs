import { spawnSync } from 'node:child_process';
import { environment, requireRuntime, runtimeKeys } from './environment.mjs';
const env = environment();
requireRuntime(env);
// Only backend runtime keys become Worker secrets; no frontend key exposure.
const secrets = Object.fromEntries(runtimeKeys.map((key) => [key, env[key]]));
const upload = spawnSync('wrangler', ['secret', 'bulk', '--env', 'production'], {
  env,
  input: JSON.stringify(secrets),
  encoding: 'utf8',
});
for (const output of [upload.stdout, upload.stderr]) if (output) process.stdout.write(output);
if (upload.status !== 0) process.exit(upload.status ?? 1);
const deploy = spawnSync('wrangler', ['deploy', '--env', 'production'], { env, stdio: 'inherit' });
process.exit(deploy.status ?? 1);
