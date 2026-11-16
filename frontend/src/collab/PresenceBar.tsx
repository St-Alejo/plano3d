/**
 * Quién más está editando este proyecto («Steven · Escritorio») y el estado de la
 * conexión en vivo. Cuando llega un cambio de otra persona avisa unos segundos.
 */
import { Monitor, Globe, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { peerColor, useCollab } from './collabStore'
import type { ClientKind, PeerInfo } from './protocol'

const CLIENT_LABEL: Record<ClientKind, string> = { web: 'Web', desktop: 'Escritorio' }

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

function PeerChip({ peer }: { peer: PeerInfo }) {
  const Icon = peer.client === 'desktop' ? Monitor : Globe
  const label = `${peer.name} · ${CLIENT_LABEL[peer.client]}`
  return (
    <li className="-ml-1.5 first:ml-0" title={label}>
      <span
        className="relative inline-flex size-7 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-canvas"
        style={{ backgroundColor: peerColor(peer.id) }}
      >
        {initials(peer.name)}
        <Icon className="absolute -right-1 -bottom-1 size-3.5 rounded-full bg-canvas p-0.5 text-fg" aria-hidden />
      </span>
      <span className="sr-only">{label}</span>
    </li>
  )
}

/** Aviso que se apaga solo a los 4 s. */
function useFreshNotice(): string | null {
  const notice = useCollab((s) => s.notice)
  const [visible, setVisible] = useState<number | null>(null)
  useEffect(() => {
    if (!notice) return
    const show = setTimeout(() => setVisible(notice.at), 0)
    const hide = setTimeout(() => setVisible(null), 4000)
    return () => {
      clearTimeout(show)
      clearTimeout(hide)
    }
  }, [notice])
  if (!notice || visible !== notice.at) return null
  return notice.client === 'desktop' ? `Cambios desde el escritorio (${notice.name})` : `Cambios de ${notice.name} en la web`
}

export function PresenceBar() {
  const status = useCollab((s) => s.status)
  const detail = useCollab((s) => s.detail)
  const peers = useCollab((s) => s.peers)
  const notice = useFreshNotice()
  if (status === 'off') return null
  const others = Object.values(peers)

  return (
    <div className="flex items-center gap-2" data-testid="presence-bar">
      {status === 'live' ? (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-subtle" title="Los cambios se guardan solos y se ven al instante en otras pestañas y en el escritorio">
          <span className="size-2 rounded-full bg-[#2b8a3e]" aria-hidden />
          en vivo
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-subtle" role="status" title={detail ?? undefined}>
          <WifiOff className="size-3.5" aria-hidden />
          {status === 'connecting' ? 'conectando…' : status === 'closed' ? (detail ?? 'sin conexión en vivo') : 'reconectando…'}
        </span>
      )}
      {others.length > 0 && (
        <ul className="flex items-center" aria-label={`${others.length} persona(s) más en este proyecto`}>
          {others.slice(0, 4).map((p) => (
            <PeerChip key={p.id} peer={p} />
          ))}
          {others.length > 4 && <li className="ml-1 font-mono text-xs text-subtle">+{others.length - 4}</li>}
        </ul>
      )}
      {notice && (
        <span role="status" className="hidden rounded-md bg-fg px-2 py-1 text-xs text-canvas shadow-sm lg:inline">
          {notice}
        </span>
      )}
    </div>
  )
}
