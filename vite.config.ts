import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One build for web and desktop (Tauri loads the same dist/).
export default defineConfig({
  base: './', // relative paths: works on any web host, in GitHub Pages subfolders and inside the desktop app
  plugins: [react(), viteSingleFile()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 20_000 },
  worker: { format: 'es' },
});
