import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/server.ts', cli: 'src/db/cli.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Bundle the workspace package (it ships TypeScript source); keep real deps external.
  noExternal: ['@cinebook/shared'],
});
