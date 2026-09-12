import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { app } from '../src/index.js';

const root = resolve(import.meta.dirname, '../../..');
const docs = resolve(root, 'docs');
await mkdir(docs, { recursive: true });

const env = {
  DATABASE_URL: 'postgresql://documentation-only',
  SUPABASE_URL: 'https://documentation-only.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'documentation-only',
  SUPABASE_STORAGE_BUCKET: 'photos-originals',
  DOCS_ENABLED: 'true',
  PUBLIC_ORIGIN: 'http://localhost:5173',
  CURSOR_SECRET: 'documentation-only',
  PIN_PEPPER: 'documentation-only',
  IP_HASH_PEPPER: 'documentation-only',
};
const response = await app.request('/openapi.json', {}, env);
if (!response.ok) throw new Error(`OpenAPI generation failed: ${response.status}`);
const document = await response.json();
await writeFile(resolve(docs, 'openapi.json'), `${JSON.stringify(document, null, 2)}\n`);
console.log('Wrote docs/openapi.json');
