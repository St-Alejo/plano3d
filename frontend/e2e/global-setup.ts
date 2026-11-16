/**
 * Sesión para las pruebas E2E (ADR-020): registra una cuenta nueva por corrida y deja
 * - el token de refresco en el localStorage del navegador (la app entra sola), y
 * - el de acceso en E2E_TOKEN, que el config pone como cabecera de `request`.
 * Si el servidor corre sin cuentas no hace nada.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { request, type FullConfig } from '@playwright/test'

export const STATE = 'e2e/.auth/state.json'

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:8080'
  const api = await request.newContext({ baseURL })
  const empty = { cookies: [], origins: [] }
  mkdirSync(dirname(STATE), { recursive: true })
  const cfg = (await (await api.get('/api/auth/config')).json()) as { auth_required: boolean }
  if (!cfg.auth_required) {
    writeFileSync(STATE, JSON.stringify(empty))
    return
  }
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@plano3d.test`
  const res = await api.post('/api/auth/register', { data: { email, name: 'Pruebas E2E', password: `e2e-${Math.random().toString(36)}` } })
  if (!res.ok()) throw new Error(`No se pudo crear la cuenta de pruebas: ${res.status()} ${await res.text()}`)
  const session = (await res.json()) as { access_token: string; refresh_token: string }
  process.env.E2E_TOKEN = session.access_token
  writeFileSync(
    STATE,
    JSON.stringify({ ...empty, origins: [{ origin: new URL(baseURL).origin, localStorage: [{ name: 'plano3d.refresh', value: session.refresh_token }] }] }),
  )
  await api.dispose()
}
