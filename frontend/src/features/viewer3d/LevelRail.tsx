/**
 * Selector de pisos del visor: una columna de pisos apilados (el de arriba arriba, como el
 * edificio). Al pasar el cursor o enfocar un piso aparece su ficha y se resalta en 3D; al
 * elegirlo se aísla (los de encima se ocultan y se corta como maqueta).
 */
import clsx from 'clsx'
import { Building2, Eye } from 'lucide-react'
import { useState } from 'react'
import type { LevelSummary } from '@/domain/levels'

const m2 = (v: number) => `${v.toFixed(1).replace('.', ',')} m²`

export function LevelRail({
  levels,
  focused,
  onFocus,
  onHover,
}: {
  /** de abajo hacia arriba (como los entrega `levelSummaries`) */
  levels: LevelSummary[]
  /** piso aislado, o null si se ve el edificio completo */
  focused: string | null
  onFocus: (id: string | null) => void
  /** piso bajo el cursor o con foco (para resaltarlo en la escena) */
  onHover: (id: string | null) => void
}) {
  const [peek, setPeek] = useState<string | null>(null)
  const show = (id: string | null) => {
    setPeek(id)
    onHover(id)
  }
  if (levels.length < 2) return null
  const top = [...levels].reverse()

  return (
    <nav
      aria-label="Pisos"
      className="pointer-events-auto flex flex-col items-start gap-1"
      onMouseLeave={() => show(null)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) show(null)
      }}
    >
      <p className="mb-0.5 flex items-center gap-1.5 rounded-sm bg-canvas/85 px-1.5 py-0.5 font-mono text-[11px] tracking-[0.14em] text-subtle uppercase backdrop-blur">
        <Building2 className="size-3.5" aria-hidden /> Pisos
      </p>
      <ul className="flex flex-col gap-1">
        {top.map((l) => {
          const active = focused === l.id
          const open = peek === l.id
          return (
            <li key={l.id} className="relative flex items-center" onMouseEnter={() => show(l.id)}>
              <button
                type="button"
                aria-pressed={active}
                aria-describedby={open ? `level-card-${l.id}` : undefined}
                title={l.name}
                onFocus={() => show(l.id)}
                onClick={() => onFocus(active ? null : l.id)}
                className={clsx(
                  'flex h-11 w-36 items-center gap-2 rounded-md border px-2.5 text-left text-sm shadow-sm backdrop-blur transition-[background-color,border-color,width] duration-150',
                  active ? 'border-transparent bg-fg text-canvas' : open ? 'border-accent bg-canvas/95' : 'border-line bg-canvas/85 hover:border-accent',
                )}
              >
                <span className={clsx('font-mono text-xs', active ? 'text-canvas/70' : 'text-subtle')}>P{l.number}</span>
                <span className="truncate">{l.name}</span>
              </button>
              {open && (
                <div
                  id={`level-card-${l.id}`}
                  role="group"
                  aria-label={`Ficha del piso ${l.number}`}
                  className="absolute top-1/2 left-full z-10 ml-2 w-56 -translate-y-1/2 rounded-lg border border-line-strong bg-surface/97 p-3 shadow-xl backdrop-blur"
                >
                  <p className="font-mono text-[11px] tracking-[0.14em] text-subtle uppercase">Piso {l.number}</p>
                  <p className="text-base font-medium">{l.name}</p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt className="text-subtle">Área útil</dt>
                    <dd className="text-right font-mono">{m2(l.area)}</dd>
                    <dt className="text-subtle">Ambientes</dt>
                    <dd className="text-right font-mono">{l.rooms}</dd>
                    <dt className="text-subtle">Nivel</dt>
                    <dd className="text-right font-mono">+{l.elevation.toFixed(2).replace('.', ',')} m</dd>
                  </dl>
                  <button
                    type="button"
                    onClick={() => onFocus(active ? null : l.id)}
                    className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-fg text-sm font-medium text-canvas hover:brightness-125 pointer-coarse:h-11"
                  >
                    <Eye className="size-4" aria-hidden /> {active ? 'Ver todo el edificio' : 'Ver este piso'}
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {focused && (
        <button
          type="button"
          onClick={() => onFocus(null)}
          className="mt-1 inline-flex h-9 items-center rounded-md border border-line bg-canvas/85 px-2.5 text-xs backdrop-blur hover:border-accent pointer-coarse:h-11"
        >
          Ver todo
        </button>
      )}
    </nav>
  )
}
