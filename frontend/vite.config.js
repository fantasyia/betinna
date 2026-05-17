import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
/**
 * Vite config — Betinna.ai frontend.
 *
 * Hardening:
 *  - `build.sourcemap = false` em produção (não vazar source código)
 *  - Code splitting por rota via React.lazy nas páginas
 *  - PORT dinâmico via process.env.PORT (Railway injeta)
 *  - Bundle alvo < 200KB gzipped (verificar com `vite build --report`)
 *
 * PWA (Progressive Web App):
 *  - manifest.webmanifest gerado automaticamente
 *  - service worker via workbox em modo `injectManifest` precache
 *  - App pode ser instalado no celular (home screen) e abre fullscreen
 *  - Funciona offline pra assets estáticos (HTML/CSS/JS)
 *  - APIs **não** são cacheadas (NetworkOnly por padrão pra /api/v1/*)
 *    → preserva multi-tenant + segurança (não cacheia dados sensíveis)
 *
 * Update flow: quando novo deploy sai, service worker detecta e mostra
 * "Nova versão disponível, recarregar?" via evento `pwa:needRefresh`
 * (capturado em main.tsx).
 */
export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: 'prompt',
            includeAssets: ['favicon.ico'],
            manifest: {
                name: 'Betinna.ai — Plataforma comercial B2B',
                short_name: 'Betinna.ai',
                description: 'CRM + pedidos OMIE + atendimento multicanal + automação comercial pra indústrias B2B',
                theme_color: '#3b82f6',
                background_color: '#ffffff',
                display: 'standalone',
                orientation: 'portrait-primary',
                scope: '/',
                start_url: '/dashboard',
                categories: ['business', 'productivity'],
                lang: 'pt-BR',
                icons: [
                    // Geramos os ícones a partir do favicon existente.
                    // Para produção, substituir por ícones dedicados (192/512/maskable).
                    {
                        src: '/favicon.ico',
                        sizes: '192x192 512x512',
                        type: 'image/x-icon',
                        purpose: 'any',
                    },
                ],
            },
            workbox: {
                // Precache: HTML/JS/CSS/imagens estáticas
                globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
                // APIs nunca cacheiam — multi-tenant + dados sensíveis
                runtimeCaching: [
                    {
                        urlPattern: /\/api\/v1\//,
                        handler: 'NetworkOnly',
                    },
                    {
                        urlPattern: /\.(?:googleapis|gstatic)\.com\//,
                        handler: 'StaleWhileRevalidate',
                        options: { cacheName: 'google-fonts', expiration: { maxEntries: 20 } },
                    },
                ],
                // Limite generoso porque incluímos chunks pesados (xlsx, docx, jspdf)
                maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
                // Skip waiting + clientsClaim pra atualização rápida
                skipWaiting: false,
                clientsClaim: false,
            },
            devOptions: {
                // Em dev, PWA fica desligado pra não interferir com HMR
                enabled: false,
            },
        }),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        port: Number(process.env.PORT) || 5173,
        host: '0.0.0.0',
    },
    preview: {
        port: Number(process.env.PORT) || 4173,
        host: '0.0.0.0',
    },
    build: {
        sourcemap: false,
        rollupOptions: {
            output: {
                manualChunks: {
                    'react-vendor': ['react', 'react-dom', 'react-router-dom'],
                },
            },
        },
        target: 'es2020',
        minify: 'esbuild',
    },
});
