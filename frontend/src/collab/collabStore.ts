/**
 * Estado visible de la edición en vivo: conexión, quién más está y qué toca cada uno.
 * Lo escribe la sesión (`CollabSession`); lo leen la barra de presencia y el editor 2D.
 */
import { create } from 'zustand'
import type { RenderInfo } from '@/api/types'
import type { ClientKind, PeerInfo, PresenceState, PreviewEntity } from './protocol'

export type LiveStatus = 'off' | 'connecting' | 'live' | 'offline' | 'closed'

export interface RemoteNotice {
  name: string
  client: ClientKind
  at: number
}

interface CollabState {
  status: LiveStatus
  /** motivo del cierre o del corte, para mostrarlo */
  detail: string | null
  me: PeerInfo | null
  peers: Record<string, PeerInfo>
  previews: Record<string, PreviewEntity>
  /** lotes enviados que el servidor aún no confirma */
  pending: number
  /** último cambio que llegó de otra persona (para el aviso) */
  notice: RemoteNotice | null
  /** renders de Blender que llegaron en vivo durante la sesión (la galería los suma) */
  arrivedRenders: RenderInfo[]
  /** lo conecta la sesión activa; sin sesión no hace nada */
  sendPreview: (entity: PreviewEntity | null) => void
}

const initial = {
  status: 'off' as LiveStatus,
  detail: null,
  me: null,
  peers: {},
  previews: {},
  pending: 0,
  notice: null,
  arrivedRenders: [],
  sendPreview: () => {},
}

export const useCollab = create<CollabState>()(() => ({ ...initial }))

export const collabActions = {
  reset: () => useCollab.setState({ ...initial }),
  status: (status: LiveStatus, detail: string | null = null) => useCollab.setState({ status, detail }),
  welcome: (me: PeerInfo, peers: PeerInfo[]) =>
    useCollab.setState({ me, peers: Object.fromEntries(peers.map((p) => [p.id, p])), previews: {} }),
  joined: (peer: PeerInfo) => useCollab.setState((s) => ({ peers: { ...s.peers, [peer.id]: peer } })),
  left: (id: string) =>
    useCollab.setState((s) => {
      const peers = { ...s.peers }
      const previews = { ...s.previews }
      delete peers[id]
      delete previews[id]
      return { peers, previews }
    }),
  presence: (id: string, presence: PresenceState) =>
    useCollab.setState((s) => (s.peers[id] ? { peers: { ...s.peers, [id]: { ...s.peers[id], presence } } } : {})),
  preview: (id: string, entity: PreviewEntity | null) =>
    useCollab.setState((s) => {
      if (!entity && !s.previews[id]) return {}
      const previews = { ...s.previews }
      if (entity) previews[id] = entity
      else delete previews[id]
      return { previews }
    }),
  pending: (pending: number) => useCollab.setState({ pending }),
  renderAdded: (render: RenderInfo) => useCollab.setState((s) => ({ arrivedRenders: [...s.arrivedRenders, render] })),
  remoteChange: (peerId: string) => {
    const peer = useCollab.getState().peers[peerId]
    if (peer) useCollab.setState({ notice: { name: peer.name, client: peer.client, at: Date.now() } })
    // el arrastre terminó: el fantasma ya no hace falta
    collabActions.preview(peerId, null)
  },
}

/** Color estable por participante (para su selección y su fantasma en el plano). */
const PALETTE = ['#d9480f', '#1971c2', '#2b8a3e', '#ae3ec9', '#e67700', '#0c8599']
export function peerColor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length] ?? '#d9480f'
}
