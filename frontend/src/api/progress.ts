/**
 * Canal de progreso del pipeline (Observer). Usa WebSocket; si no conecta
 * (proxy corporativo, red móvil) cae a polling del historial por REST.
 */
import { api } from './client'
import { wsOrigin } from './origin'
import { tokens } from './tokens'
import type { ProgressEvent } from './types'

export interface ProgressHandlers {
  onEvent: (e: ProgressEvent) => void
  onDone?: (ok: boolean) => void
}

export interface SocketLike {
  onmessage: ((ev: { data: unknown }) => void) | null
  onerror: ((ev: unknown) => void) | null
  onclose: ((ev: unknown) => void) | null
  close(): void
}

export type SocketFactory = (url: string) => SocketLike

const defaultSocket: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike

/** Ticket de 60 s para el WebSocket (null si no se pudo pedir). */
const defaultTicket = (): Promise<string | null> =>
  api.auth.wsTicket().then(
    (t) => t.ticket,
    () => null,
  )

export function progressUrl(projectId: string, loc: Pick<Location, 'protocol' | 'host'> = window.location): string {
  return `${wsOrigin(loc)}/api/ws/projects/${encodeURIComponent(projectId)}`
}

export function subscribeProgress(
  projectId: string,
  handlers: ProgressHandlers,
  opts: { socket?: SocketFactory; pollMs?: number; ticket?: () => Promise<string | null> } = {},
): () => void {
  let stopped = false
  let finished = false
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let seen = 0

  const deliver = (e: ProgressEvent) => {
    if (stopped || finished) return
    handlers.onEvent(e)
    if (e.stage === 'done') {
      finished = true
      handlers.onDone?.(e.status === 'completed')
    }
  }

  const poll = async () => {
    if (stopped || finished) return
    try {
      const events = await api.progress(projectId)
      events.slice(seen).forEach(deliver)
      seen = events.length
    } catch {
      /* se reintenta en el próximo ciclo */
    }
    if (!stopped && !finished) pollTimer = setTimeout(poll, opts.pollMs ?? 1000)
  }

  let socket: SocketLike | null = null
  const open = (url: string) => {
    try {
      const s = (opts.socket ?? defaultSocket)(url)
      socket = s
      s.onmessage = (msg) => {
        seen += 1
        deliver(JSON.parse(String(msg.data)) as ProgressEvent)
      }
      s.onerror = () => {
        s.close()
      }
      s.onclose = () => {
        if (!stopped && !finished) void poll()
      }
    } catch {
      void poll()
    }
  }

  const url = progressUrl(projectId)
  if (!tokens.access() && !tokens.refresh() && !opts.ticket) {
    open(url) // servidor sin cuentas
  } else {
    // con sesión: el navegador no pone cabeceras al WebSocket, se manda un ticket corto
    void (opts.ticket ?? defaultTicket)().then((ticket) => {
      if (stopped) return
      if (ticket) open(`${url}?ticket=${encodeURIComponent(ticket)}`)
      else void poll()
    })
  }

  return () => {
    stopped = true
    if (pollTimer) clearTimeout(pollTimer)
    socket?.close()
  }
}
