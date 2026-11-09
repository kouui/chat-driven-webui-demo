import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        butterflyLab: resolve(import.meta.dirname, 'butterfly-lab.html'),
      },
    },
  },
  test: {
    environment: 'node',
  },
});
