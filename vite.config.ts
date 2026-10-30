import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative paths: the build works on itch.io / GitHub Pages without configuration.
  base: './',
  build: {
    target: 'es2023',
    // three/webgpu is one big module (~1 MB minified); it is the only heavy chunk, by design.
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
});
