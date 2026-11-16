import { defineConfig, devices } from '@playwright/test'

/**
 * E2E contra la app levantada. Por defecto apunta al stack de Docker (nginx en :8080).
 * Para el servidor de desarrollo: E2E_BASE_URL=http://localhost:5173 npx playwright test
 */
export default defineConfig({
  testDir: './e2e',
  // una cuenta nueva por corrida: el navegador entra con su refresco y `request` con su token
  globalSetup: './e2e/global-setup.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // el 3D sin GPU es pesado: con un worker por núcleo las pruebas se estorban y fallan por tiempo
  workers: process.env.CI ? undefined : 4,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    storageState: 'e2e/.auth/state.json',
    extraHTTPHeaders: process.env.E2E_TOKEN ? { Authorization: `Bearer ${process.env.E2E_TOKEN}` } : undefined,
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /(mobile|modes)\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /(mobile|usability|walk)\.spec\.ts/ },
    // los modos de obra dibujan miles de ladrillos y barras: sin GPU eso le quita la CPU a la API de
    // un worker y otras pruebas no alcanzan a guardar. Corren solos, al final.
    { name: 'obra', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testMatch: /modes\.spec\.ts/, dependencies: ['desktop', 'mobile'] },
  ],
})
