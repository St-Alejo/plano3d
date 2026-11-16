/**
 * Mensajes del WebSocket de edición en vivo (ADR-021). Espejo de
 * `backend/src/plano3d/api/collab.py`: si cambia allá, cambia acá.
 */
import type { BuildingModel } from '@/api/types'
import type { ModelOp } from '@/domain/ops'

export type ClientKind = 'web' | 'desktop'

/** Lo que cada participante cuenta de sí: qué mira y qué tiene seleccionado. */
export interface PresenceState {
  level?: string
  selection?: string | null
  tool?: string
}

export interface PeerInfo {
  id: string
  name: string
  client: ClientKind
  presence?: PresenceState | null
}

/** Una entidad a medio arrastrar (no se guarda; solo se dibuja como fantasma). */
export interface PreviewEntity {
  /** `opening`: v = { wall, offset, width, kind } (la abertura sobre otro muro o corrida) */
  k: 'wall' | 'furniture' | 'opening'
  level: string
  id: string
  v: Record<string, unknown>
}

export interface AppliedEntry {
  seq: number
  op_id: string
  ops: ModelOp[]
  author: string
}

export type ServerMessage =
  | {
      type: 'welcome'
      you: PeerInfo
      seq: number
      revision: number
      peers: PeerInfo[]
      model?: BuildingModel
      missed?: AppliedEntry[]
    }
  | ({ type: 'applied' } & AppliedEntry)
  | { type: 'reject'; op_id: string; reason: string }
  | { type: 'snapshot'; seq: number; revision: number; model: BuildingModel }
  | { type: 'saved'; revision: number; seq: number }
  | { type: 'presence'; peer_id: string; state: PresenceState }
  | { type: 'preview'; peer_id: string; entity: PreviewEntity | null }
  | { type: 'peer_joined'; peer: PeerInfo }
  | { type: 'peer_left'; peer_id: string }
  | { type: 'closed'; reason: string }
  | { type: 'pong' }
  | { type: 'error'; reason: string }

export type ClientMessage =
  | { type: 'hello'; client: ClientKind; last_seq: number | null }
  | { type: 'ops'; op_id: string; ops: ModelOp[] }
  | { type: 'presence'; state: PresenceState }
  | { type: 'preview'; entity: PreviewEntity | null }
  | { type: 'ping' }
