import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static build — the app talks to api.sleeper.app and api.fantasycalc.com
// straight from the browser, so there is nothing to serve but the bundle.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', sourcemap: true },
});
