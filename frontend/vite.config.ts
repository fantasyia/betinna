import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Vite config — Betinna.ai frontend (Sprint 4 FIX 5).
 *
 * Sprint 4 hardening:
 *  - `build.sourcemap = false` em produção (não vazar source código)
 *  - Code splitting por rota via React.lazy nas páginas
 *  - PORT dinâmico via process.env.PORT (Railway injeta)
 *  - Bundle alvo < 200KB gzipped (verificar com `vite build --report`)
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // PORT dinâmico — Railway preview / dev local
    port: Number(process.env.PORT) || 5173,
    host: '0.0.0.0',
  },
  preview: {
    port: Number(process.env.PORT) || 4173,
    host: '0.0.0.0',
  },
  build: {
    // Sprint 4 FIX 5: sourcemaps desligados em prod (segurança + tamanho)
    sourcemap: false,
    // Code splitting agressivo por chunk
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
    // Target ES2020 — moderno mas suporta Safari 14+
    target: 'es2020',
    // Minify default (esbuild)
    minify: 'esbuild',
  },
});
