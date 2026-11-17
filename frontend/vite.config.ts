/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:8000'

/**
 * Precarga las fuentes latinas del título y del texto. Sin esto llegan tarde (las pide el CSS) y el
 * título de la portada cambia de alto al cambiar de fuente: salto de diseño (CLS) en Lighthouse.
 */
function preloadFonts(patterns: RegExp[]): Plugin {
  return {
    name: 'preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (_html, ctx) =>
        Object.keys(ctx.bundle ?? {})
          .filter((file) => patterns.some((re) => re.test(file)))
          .map((file) => ({
            tag: 'link',
            attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${file}`, crossorigin: '' },
            injectTo: 'head' as const,
          })),
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    preloadFonts([/fraunces-latin-opsz-(normal|italic)-.*\.woff2$/, /hanken-grotesk-latin-wght-normal-.*\.woff2$/]),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // mismo origen en desarrollo: /api y /api/ws van al backend (igual que nginx en prod)
    proxy: { '/api': { target: apiTarget, ws: true, changeOrigin: true } },
  },
  build: {
    // three.js (~1 MB) va en su propio chunk y se carga solo al abrir el visor 3D
    chunkSizeWarningLimit: 1100,
    rolldownOptions: {
      output: {
        // Grupos de chunks (Rolldown). React y lo que comparten three y konva van en «react»: si
        // quedaban dentro de esos chunks, la portada tenía que bajar three.js y konva para arrancar.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|zustand|use-sync-external-store|its-fine)[\\/]/, priority: 30 },
            // el reconciliador solo lo usan three (r3f) y konva: no hace falta en la portada
            { name: 'reconciler', test: /node_modules[\\/]react-reconciler[\\/]/, priority: 25 },
            { name: 'three', test: /node_modules[\\/](three|@react-three|suspend-react)/, priority: 20 },
            { name: 'konva', test: /node_modules[\\/](konva|react-konva)/, priority: 20 },
          ],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/store/**', 'src/api/**'],
      exclude: ['src/**/*.test.*', 'src/api/schema.d.ts'],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
})
