import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static build — the app talks to api.sleeper.app and api.fantasycalc.com
// straight from the browser, so there is nothing to serve but the bundle.
export default defineConfig({
  plugins: [react()],
  base: './',
  // Stamped into Settings so a screenshot says which build is running — an
  // installed copy can lag the deploy by an unbounded amount.
  define: {
    __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
  },
  build: { outDir: 'dist', sourcemap: true },
});
