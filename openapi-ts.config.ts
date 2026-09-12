import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: './docs/openapi.json',
  output: { path: './packages/api-client/src', format: 'prettier' },
  plugins: [
    '@hey-api/client-fetch',
    '@hey-api/typescript',
    { name: '@hey-api/sdk', asClass: false },
    { name: 'zod', requests: true, responses: true },
    { name: '@tanstack/react-query', infiniteQueryOptions: true, mutationOptions: true },
  ],
});
