/**
 * Une el editor (store de Zustand) con la sala del servidor (ADR-021).
 *
 * Modelo mental: el servidor ordena todo. La sesión guarda
 *   - `confirmed`: el modelo tal como lo tiene el servidor en `seq`;
 *   - `pending`: los lotes propios enviados y aún sin confirmar.
 * Lo que se ve es `confirmed` + `pending`. Cuando llega un cambio de otra persona se
 * aplica sobre `confirmed` y se vuelven a poner encima los propios pendientes (rebase):
 * así nada de lo que uno acaba de hacer parpadea ni se pierde.
 *
 * Lo local se detecta comparando el modelo antes y después de cada comando (diff por
 * entidad), sin tocar los comandos ni el historial de deshacer.
 */
import type { StoreApi } from 'zustand'
import { setLiveProject } from '@/api/client'
import type { BuildingModel } from '@/api/types'
import { applyOps, diffModels, type ModelOp } from '@/domain/ops'
import { selectIsDirty, type useEditor } from '@/store/editorStore'
import { CollabClient, type CollabClientOptions, type CollabStatus } from './CollabClient'
import { collabActions, useCollab } from './collabStore'
import type { ClientMessage, PresenceState, PreviewEntity, ServerMessage } from './protocol'

type EditorState = ReturnType<typeof useEditor.getState>
export type EditorStore = Pick<StoreApi<EditorState>, 'getState' | 'setState' | 'subscribe'>

export interface Transport {
  start(): void
  stop(): void
  send(msg: ClientMessage): boolean
}

export type TransportHandlers = Pick<CollabClientOptions, 'onMessage' | 'onStatus' | 'lastSeq'>

interface Batch {
  op_id: string
  ops: ModelOp[]
}

export interface SessionOptions {
  editor: EditorStore
  /** para pruebas: un transporte falso; por defecto el WebSocket real */
  transport?: (handlers: TransportHandlers) => Transport
  presenceMs?: number
  previewMs?: number
}

const randomId = (): string => Math.random().toString(36).slice(2, 10)

export class CollabSession {
  private confirmed: BuildingModel | null = null
  private seq: number | null = null
  private pending: Batch[] = []
  /** el modelo del editor la última vez que se miró: el diff local parte de aquí */
  private lastLocal: BuildingModel | null = null
  private welcomed = false
  private counter = 0
  private readonly prefix = randomId()
  private readonly transport: Transport
  private unsubscribe: (() => void) | null = null
  private presenceTimer: ReturnType<typeof setTimeout> | undefined
  private lastPresence = ''
  private previewTimer: ReturnType<typeof setTimeout> | undefined
  private queuedPreview: PreviewEntity | null | undefined
  private lastPreviewAt = 0

  constructor(
    private readonly projectId: string,
    private readonly opts: SessionOptions,
  ) {
    const handlers: TransportHandlers = {
      onMessage: (m) => this.receive(m),
      onStatus: (s, detail) => this.status(s, detail),
      lastSeq: () => (this.confirmed ? this.seq : null),
    }
    this.transport = opts.transport ? opts.transport(handlers) : new CollabClient(projectId, { ...handlers, client: 'web' })
  }

  start(): void {
    collabActions.reset()
    useCollab.setState({ sendPreview: (e) => this.preview(e) })
    this.unsubscribe = this.opts.editor.subscribe((state, prev) => this.onEditor(state, prev))
    this.transport.start()
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    clearTimeout(this.presenceTimer)
    clearTimeout(this.previewTimer)
    this.transport.stop()
    setLiveProject(null)
    collabActions.reset()
  }

  // ------------------------------------------------------------ lo local hacia el servidor
  private onEditor(state: EditorState, prev: EditorState): void {
    if (state.projectId !== this.projectId) return
    if (state.model !== prev.model && state.model) {
      if (!this.welcomed || !this.lastLocal) {
        this.lastLocal = state.model
      } else if (state.origin === 'local') {
        const ops = diffModels(this.lastLocal, state.model)
        this.lastLocal = state.model
        if (ops.length) this.push(ops)
      } else if (state.origin === 'load') {
        // se recargó por REST mientras se edita en vivo: manda lo que tiene la sala
        this.lastLocal = state.model
        this.render(true)
      } else {
        this.lastLocal = state.model
      }
    }
    if (state.selection !== prev.selection || state.levelId !== prev.levelId || state.tool !== prev.tool) this.schedulePresence()
  }

  private push(ops: ModelOp[]): void {
    const batch = { op_id: `${this.prefix}-${++this.counter}`, ops }
    this.pending.push(batch)
    collabActions.pending(this.pending.length)
    this.transport.send({ type: 'ops', ...batch })
  }

  private presenceState(): PresenceState {
    const s = this.opts.editor.getState()
    return { level: s.levelId, selection: s.selection?.id ?? null, tool: s.tool }
  }

  private schedulePresence(): void {
    clearTimeout(this.presenceTimer)
    this.presenceTimer = setTimeout(() => this.sendPresence(), this.opts.presenceMs ?? 100)
  }

  private sendPresence(force = false): void {
    const state = this.presenceState()
    const key = JSON.stringify(state)
    if (!force && key === this.lastPresence) return
    if (this.transport.send({ type: 'presence', state })) this.lastPresence = key
  }

  /** Arrastre en curso: como mucho 20 por segundo y siempre el último. */
  preview(entity: PreviewEntity | null): void {
    if (!this.welcomed) return
    const wait = (this.opts.previewMs ?? 50) - (Date.now() - this.lastPreviewAt)
    this.queuedPreview = entity
    if (wait <= 0 || entity === null) {
      clearTimeout(this.previewTimer)
      this.previewTimer = undefined
      this.flushPreview()
    } else if (!this.previewTimer) {
      this.previewTimer = setTimeout(() => {
        this.previewTimer = undefined
        this.flushPreview()
      }, wait)
    }
  }

  private flushPreview(): void {
    if (this.queuedPreview === undefined) return
    this.transport.send({ type: 'preview', entity: this.queuedPreview })
    this.queuedPreview = undefined
    this.lastPreviewAt = Date.now()
  }

  // ------------------------------------------------------------ lo del servidor hacia el editor
  private status(status: CollabStatus, detail?: string): void {
    setLiveProject(status === 'live' ? this.projectId : null)
    collabActions.status(status, detail ?? null)
  }

  receive(msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome':
        return this.welcome(msg)
      case 'applied': {
        if (!this.confirmed) return
        try {
          this.confirmed = applyOps(this.confirmed, msg.ops)
        } catch {
          return this.resync()
        }
        this.seq = msg.seq
        const mine = this.pending.findIndex((b) => b.op_id === msg.op_id)
        if (mine >= 0) {
          this.pending.splice(mine, 1)
          collabActions.pending(this.pending.length)
          if (!this.pending.length) this.markHeld()
        } else {
          this.render()
          collabActions.remoteChange(msg.author)
        }
        return
      }
      case 'reject': {
        this.pending = this.pending.filter((b) => b.op_id !== msg.op_id)
        collabActions.pending(this.pending.length)
        this.render()
        this.opts.editor.getState().setError(`El servidor no aceptó un cambio: ${msg.reason}`)
        return
      }
      case 'snapshot':
        this.confirmed = msg.model
        this.seq = msg.seq
        this.render()
        this.setRevision(msg.revision)
        return
      case 'saved':
        this.setRevision(msg.revision)
        return
      case 'presence':
        return collabActions.presence(msg.peer_id, msg.state)
      case 'preview':
        return collabActions.preview(msg.peer_id, msg.entity)
      case 'peer_joined':
        collabActions.joined(msg.peer)
        this.sendPresence(true) // que el recién llegado vea qué tengo seleccionado
        return
      case 'peer_left':
        return collabActions.left(msg.peer_id)
      case 'closed':
        return collabActions.status('closed', msg.reason)
      default:
        return
    }
  }

  private welcome(msg: Extract<ServerMessage, { type: 'welcome' }>): void {
    collabActions.welcome(msg.you, msg.peers)
    if (msg.model) {
      this.confirmed = msg.model
    } else if (this.confirmed) {
      for (const entry of msg.missed ?? []) {
        try {
          this.confirmed = applyOps(this.confirmed, entry.ops)
        } catch {
          return this.resync()
        }
        this.pending = this.pending.filter((b) => b.op_id !== entry.op_id)
      }
    }
    this.seq = msg.seq
    const first = !this.welcomed
    this.welcomed = true
    const editor = this.opts.editor.getState()
    if (first && editor.projectId === this.projectId && editor.model && this.confirmed && selectIsDirty(editor)) {
      // había cambios sin guardar antes de conectar: se mandan como un lote
      const ops = diffModels(this.confirmed, editor.model)
      this.lastLocal = editor.model
      if (ops.length) this.push(ops)
    } else {
      // al reconectar se reenvía lo que no alcanzó a confirmarse (el servidor ignora repetidos)
      for (const b of this.pending) this.transport.send({ type: 'ops', ...b })
      this.render(true)
    }
    collabActions.pending(this.pending.length)
    if (!this.pending.length) this.markHeld(msg.revision)
    else this.opts.editor.setState({ revision: msg.revision })
    this.sendPresence(true)
  }

  /** Pone en el editor `confirmed` + pendientes, si difiere de lo que ya muestra. */
  private render(force = false): void {
    const editor = this.opts.editor.getState()
    if (!this.confirmed || editor.projectId !== this.projectId || !editor.model) return
    let view = this.confirmed
    const kept: Batch[] = []
    for (const b of this.pending) {
      try {
        view = applyOps(view, b.ops)
        kept.push(b)
      } catch {
        /* lo pisó un cambio de otra persona (p. ej. borró el piso): se descarta */
      }
    }
    if (kept.length !== this.pending.length) {
      this.pending = kept
      collabActions.pending(kept.length)
    }
    if (view === editor.model) return
    if (force && diffModels(editor.model, view).length === 0) {
      this.lastLocal = editor.model
      return
    }
    this.lastLocal = view
    editor.applyRemote(view)
  }

  /** El servidor ya tiene todo lo editado: no hay nada que guardar a mano. */
  private markHeld(revision?: number): void {
    const editor = this.opts.editor.getState()
    if (editor.projectId === this.projectId) editor.markSaved(revision)
  }

  private setRevision(revision: number): void {
    if (this.pending.length) this.opts.editor.setState({ revision })
    else this.markHeld(revision)
  }

  /** Algo no cuadra con el servidor: se reconecta pidiendo el modelo entero. */
  private resync(): void {
    this.confirmed = null
    this.seq = null
    this.transport.stop()
    this.transport.start()
  }
}
