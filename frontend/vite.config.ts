/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // mismo origen en desarrollo: /api y /api/ws van al backend (igual que nginx en prod)
    proxy: { '/api': { target: apiTarget, ws: true, changeOrigin: true } },
  },
  build: {
    // three.js (~1 MB) va en su propio chunk y se carga solo al abrir el visor 3D
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (/node_modules\/(three|@react-three)/.test(id)) return 'three'
          if (/node_modules\/(konva|react-konva)/.test(id)) return 'konva'
          return undefined
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
