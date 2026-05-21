import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['node-pty', 'electron-store', 'systeminformation'],
    },
  },
  resolve: {
    conditions: ['node'],
  },
});
