/** Dirección de Interiores 3D: `VITE_INTERIORES_URL` en el despliegue; en local, su Docker. */
export const INTERIORES_URL = ((import.meta.env.VITE_INTERIORES_URL as string | undefined) ?? 'http://localhost:8088').replace(/\/$/, '')

/** Enlace que abre la pantalla «Conectar con Plano 3D» de Interiores con el código puesto. */
export function interioresUrl(code: string, base = INTERIORES_URL): string {
  return `${base}/conectar?codigo=${encodeURIComponent(code)}`
}
