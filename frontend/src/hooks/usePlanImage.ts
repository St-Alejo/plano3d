import { useEffect, useState } from 'react'
import { api } from '@/api/client'

/**
 * URL local (`blob:`) de la imagen del plano de un proyecto, descargada con la sesión: un
 * `<img src>` o un cargador de texturas no pueden mandar el token. Se libera al cambiar.
 * `undefined` mientras carga, si falla o si `enabled` es falso.
 */
export function usePlanImage(
  projectId: string | undefined,
  version?: string,
  { kind = 'rectified', enabled = true }: { kind?: 'original' | 'rectified'; enabled?: boolean } = {},
): string | undefined {
  const key = projectId && enabled ? `${projectId}|${kind}|${version ?? ''}` : null
  // la URL queda asociada a la imagen pedida: si cambia el pedido, la vieja no se muestra
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null)
  useEffect(() => {
    if (!key || !projectId) return
    let alive = true
    let made: string | undefined
    api
      .imageBlob(projectId, kind, version)
      .then((blob) => {
        if (!alive) return
        made = URL.createObjectURL(blob)
        setLoaded({ key, url: made })
      })
      .catch(() => undefined)
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [key, projectId, version, kind])
  return loaded && loaded.key === key ? loaded.url : undefined
}
