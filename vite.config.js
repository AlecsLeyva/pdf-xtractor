import { defineConfig } from 'vite';

export default defineConfig({
  // Rutas relativas para que el build funcione también en una subcarpeta.
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    open: true,
    // Las pruebas E2E escriben ZIP y capturas aquí; vigilarlos puede bloquear
    // el servidor de desarrollo en Windows (EBUSY).
    watch: {
      ignored: ['**/tests/output/**'],
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    open: false,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  worker: {
    format: 'es',
  },
});
