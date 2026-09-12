import { access, readFile } from 'node:fs/promises';

const queryFile = 'packages/api-client/src/@tanstack/react-query.gen.ts';
await access('packages/api-client/src/index.ts');
const generated = await readFile(queryFile, 'utf8').catch(() => '');
if (!generated.includes('InfiniteOptions')) {
  console.error('Generated client contains no cursor-aware InfiniteOptions.');
  process.exit(1);
}
console.log('Generated API client includes infinite-query options.');
