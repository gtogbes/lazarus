import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { PROGRAM_META } from '../src/ports/programs.meta.ts';
import { programSourcesPlugin } from './build/programSources.ts';
import { proveApiProxy } from './build/proveApiProxy.ts';

// Same defaults and env var as src/api/dev-server.ts (DEFAULT_HOST, DEFAULT_PORT).
// Not imported from there: that module pulls the harness and fast-check into config loading.
const apiHost = process.env.LAZARUS_API_HOST || '127.0.0.1';
const apiPort = process.env.LAZARUS_API_PORT || '8787';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    programSourcesPlugin({
      repoRoot: fileURLToPath(new URL('..', import.meta.url)),
      programIds: PROGRAM_META.map((p) => p.id),
    }),
  ],
  server: {
    proxy: {
      '/api': proveApiProxy(`http://${apiHost}:${apiPort}`),
    },
  },
  build: {
    target: 'es2023',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'build/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
