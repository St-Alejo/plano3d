/**
 * Dónde vive la API.
 *
 * - Sin `VITE_API_URL` (desarrollo, Docker, Railway): mismo origen, `/api` lo atiende el
 *   proxy de Vite o de nginx.
 * - Con `VITE_API_URL` (frontend y backend en servicios separados, p. ej. Azure Static Web
 *   Apps + Container Apps): las peticiones van directo a ese origen; el backend lo permite
 *   con CORS (`PLANO3D_CORS_ORIGINS`).
 */
export function apiOrigin(raw: string | undefined = import.meta.env.VITE_API_URL as string | undefined): string {
  return (raw ?? '').trim().replace(/\/+$/, '')
}

/** URL del WebSocket de la API: el mismo host de la página o el de `VITE_API_URL`. */
export function wsOrigin(loc: Pick<Location, 'protocol' | 'host'>, origin = apiOrigin()): string {
  if (origin) return origin.replace(/^http/, 'ws')
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${loc.host}`
}
