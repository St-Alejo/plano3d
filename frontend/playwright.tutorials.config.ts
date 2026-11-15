import { defineConfig, devices } from '@playwright/test'

/**
 * Graba los tutoriales en video (botón "Ver tutorial" del estudio y de "Empezar desde cero").
 * Con la app levantada:  E2E_BASE_URL=http://localhost:5173 npm run tutorials
 * Los videos quedan en public/tutoriales/ (crear.webm, editar.webm y recorrer.webm); guion en
 * e2e/tutorials/GUION.md. recorrer arma la casa de 3 pisos con los PDF de backend/tests/real.
 */
export default defineConfig({
  testDir: './e2e/tutorials',
  testMatch: /\.tutorial\.ts$/,
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    viewport: { width: 1280, height: 720 },
    video: { mode: 'on', size: { width: 960, height: 540 } },
    colorScheme: 'light',
  },
})
