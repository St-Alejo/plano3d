/**
 * Galería de renders de Blender del proyecto, al día: se carga al abrirla y cada render
 * nuevo que suba la app de escritorio entra solo (mensaje `render_added` de la sala).
 *
 * En el editor la sala ya está abierta (`CollabSession`) y va dejando en el store los
 * renders que llegan; en la vista 3D no hay sala, así que mientras la galería está abierta se escucha
 * con un cliente propio que solo recibe.
 */
import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '@/api/client'
import type { RenderInfo } from '@/api/types'
import { CollabClient } from '@/collab/CollabClient'
import { useCollab } from '@/collab/collabStore'
import { useAuth } from '@/store/authStore'

export interface RenderFeed {
  renders: RenderInfo[] | null
  error: string | null
  /** id del último que llegó en vivo (para resaltarlo) */
  fresh: string | null
}

/** Pertenece al proyecto: el servidor arma el id como `<proyecto>-<azar>`. */
const ofProject = (projectId: string, r: RenderInfo) => r.id.startsWith(`${projectId}-`)

export function useRenders(projectId: string, open: boolean): RenderFeed {
  const [loaded, setLoaded] = useState<{ projectId: string; renders: RenderInfo[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // los que llegan por el cliente propio (vista 3D) y los que trajo la sala del editor
  const [heard, setHeard] = useState<RenderInfo[]>([])
  const arrived = useCollab((s) => s.arrivedRenders)
  const sessionLive = useCollab((s) => s.status === 'live')
  const signedIn = useAuth((s) => s.status === 'signedIn')

  useEffect(() => {
    if (!open) return
    let alive = true
    api
      .renders(projectId)
      .then((renders) => {
        if (!alive) return
        setLoaded({ projectId, renders })
        setError(null)
      })
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.message : 'No se pudo cargar la galería'))
    return () => {
      alive = false
    }
  }, [projectId, open])

  useEffect(() => {
    if (!open || sessionLive || !signedIn) return
    const client = new CollabClient(projectId, {
      client: 'web',
      lastSeq: () => null,
      onMessage: (msg) => {
        if (msg.type === 'render_added') setHeard((list) => [...list, msg.render])
      },
      onStatus: () => {},
    })
    client.start()
    return () => client.stop()
  }, [projectId, open, sessionLive, signedIn])

  return useMemo(() => {
    if (!loaded || loaded.projectId !== projectId) return { renders: null, error, fresh: null }
    const live = [...arrived, ...heard].filter((r) => ofProject(projectId, r))
    const renders = [...loaded.renders]
    for (const r of live) if (!renders.some((x) => x.id === r.id)) renders.push(r)
    return { renders, error, fresh: live.at(-1)?.id ?? null }
  }, [loaded, arrived, heard, projectId, error])
}

/** Imagen de un render como URL local (la API pide el token; un `<img src>` no lo manda). */
export function useRenderUrl(projectId: string, renderId: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!renderId) return
    let alive = true
    let made: string | null = null
    api
      .renderBlob(projectId, renderId)
      .then((blob) => {
        if (!alive) return
        made = URL.createObjectURL(blob)
        setUrl(made)
      })
      .catch(() => alive && setUrl(null))
    return () => {
      alive = false
      setUrl(null)
      if (made) URL.revokeObjectURL(made)
    }
  }, [projectId, renderId])
  return url
}
