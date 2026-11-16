/**
 * Transporte de la edición en vivo: un WebSocket por proyecto que se reconecta solo.
 *
 * - Con sesión pide un ticket corto (el navegador no manda cabeceras al WebSocket).
 * - Al (re)conectar saluda con el último `seq` visto: el servidor reenvía lo perdido.
 * - Ping cada 25 s (el servidor corta a los 75 s de silencio).
 * - Si se cae, reintenta con espera creciente (0,5 s → 15 s, con algo de azar).
 * - Cierres definitivos (4401 sin permiso, 4404 sin proyecto, `closed`) no reintentan.
 */
import { api } from '@/api/client'
import { wsOrigin } from '@/api/origin'
import { tokens } from '@/api/tokens'
import type { ClientKind, ClientMessage, ServerMessage } from './protocol'

export type CollabStatus = 'connecting' | 'live' | 'offline' | 'closed'

export interface CollabSocket {
  readyState: number
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onerror: ((ev: unknown) => void) | null
  onclose: ((ev: { code?: number; reason?: string }) => void) | null
  send(data: string): void
  close(code?: number): void
}

export interface CollabClientOptions {
  client?: ClientKind
  socket?: (url: string) => CollabSocket
  /** ticket del WebSocket; null = conectar sin ticket (servidor sin cuentas) */
  ticket?: () => Promise<string | null>
  /** último seq aplicado (para el saludo al reconectar) */
  lastSeq: () => number | null
  onMessage: (msg: ServerMessage) => void
  onStatus: (status: CollabStatus, detail?: string) => void
  pingMs?: number
  backoff?: { min: number; max: number }
}

const OPEN = 1
/** el servidor no deja entrar o el proyecto no existe: reintentar no sirve */
const FINAL_CODES = new Set([4401, 4403, 4404])

const defaultSocket = (url: string): CollabSocket => new WebSocket(url) as unknown as CollabSocket

const defaultTicket = async (): Promise<string | null> => {
  if (!tokens.access() && !tokens.refresh()) return null
  return (await api.auth.wsTicket()).ticket
}

export function collabUrl(projectId: string, loc: Pick<Location, 'protocol' | 'host'> = window.location): string {
  return `${wsOrigin(loc)}/api/ws/collab/${encodeURIComponent(projectId)}`
}

export class CollabClient {
  private socket: CollabSocket | null = null
  private stopped = false
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private pingTimer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly projectId: string,
    private readonly opts: CollabClientOptions,
  ) {}

  get connected(): boolean {
    return this.socket?.readyState === OPEN
  }

  start(): void {
    this.stopped = false
    void this.connect()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.retryTimer)
    clearInterval(this.pingTimer)
    const s = this.socket
    this.socket = null
    if (s) {
      s.onclose = null
      s.close(1000)
    }
  }

  /** Manda si hay conexión; si no, devuelve false (la sesión reenvía lo pendiente al volver). */
  send(msg: ClientMessage): boolean {
    if (!this.connected) return false
    this.socket!.send(JSON.stringify(msg))
    return true
  }

  private async connect(): Promise<void> {
    if (this.stopped) return
    this.opts.onStatus('connecting')
    let url = collabUrl(this.projectId)
    try {
      const ticket = await (this.opts.ticket ?? defaultTicket)()
      if (ticket) url += `?ticket=${encodeURIComponent(ticket)}`
    } catch {
      return this.retry() // sin red o sesión vencida: se intenta de nuevo
    }
    if (this.stopped) return
    let s: CollabSocket
    try {
      s = (this.opts.socket ?? defaultSocket)(url)
    } catch {
      return this.retry()
    }
    this.socket = s
    s.onopen = () => {
      s.send(JSON.stringify({ type: 'hello', client: this.opts.client ?? 'web', last_seq: this.opts.lastSeq() } satisfies ClientMessage))
      clearInterval(this.pingTimer)
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), this.opts.pingMs ?? 25_000)
    }
    s.onmessage = (ev) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage
      } catch {
        return
      }
      if (msg.type === 'welcome') {
        this.attempt = 0
        this.opts.onStatus('live')
      }
      this.opts.onMessage(msg)
      if (msg.type === 'closed') this.finish(msg.reason)
    }
    s.onerror = () => s.close()
    s.onclose = (ev) => {
      clearInterval(this.pingTimer)
      if (this.socket !== s || this.stopped) return
      this.socket = null
      if (ev.code !== undefined && FINAL_CODES.has(ev.code)) this.finish(ev.code === 4404 ? 'El proyecto no está disponible' : 'Sin permiso para editar en vivo')
      else this.retry()
    }
  }

  private finish(reason: string): void {
    this.stop()
    this.opts.onStatus('closed', reason)
  }

  private retry(): void {
    if (this.stopped) return
    this.opts.onStatus('offline')
    const { min, max } = this.opts.backoff ?? { min: 500, max: 15_000 }
    const delay = Math.min(max, min * 2 ** this.attempt) * (0.75 + Math.random() * 0.5)
    this.attempt += 1
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => void this.connect(), delay)
  }
}
