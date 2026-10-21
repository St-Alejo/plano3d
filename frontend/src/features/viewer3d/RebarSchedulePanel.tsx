/**
 * Cartilla de despiece: una fila por marca de barra (forma, cantidad, largo de corte, peso) y
 * el total de kilos por diámetro. Tocar una fila resalta ese elemento en el 3D, y tocar el
 * elemento en el 3D marca sus filas.
 */
import { Download } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui'
import { barWeight, rebarCsv, steelByDiameter, type Bar } from '@/domain/structure/rebar'
import { BARS, type BarNo } from '@/domain/structure/nsr10'
import { downloadText } from '@/lib/download'
import { BAR_TINT } from './scene/MaterialFactory'

const m = (v: number, digits = 2) => v.toFixed(digits).replace('.', ',')

/** Dibujo de la forma de la barra con sus tramos, como en la cartilla del ferretero. */
function ShapeIcon({ bar }: { bar: Bar }) {
  const stroke = BAR_TINT[bar.no]
  if (bar.shape === 'estribo')
    return (
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
        <rect x="5" y="4" width="14" height="16" rx="1.5" fill="none" stroke={stroke} strokeWidth="2" />
        <path d="M5 8 L10 4 M9 4 L13 8" fill="none" stroke={stroke} strokeWidth="2" />
      </svg>
    )
  if (bar.shape === 'L')
    return (
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
        <path d="M3 6 V16 H21 V6" fill="none" stroke={stroke} strokeWidth="2" />
      </svg>
    )
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path d="M3 12 H21" fill="none" stroke={stroke} strokeWidth="2" />
    </svg>
  )
}

export function RebarSchedulePanel({
  bars,
  selectedId,
  onSelect,
  fileBase,
}: {
  bars: Bar[]
  selectedId: string | null
  onSelect: (elementId: string) => void
  fileBase: string
}) {
  const totals = [...steelByDiameter(bars)].sort(([a], [b]) => a - b)
  const total = totals.reduce((a, [, kg]) => a + kg, 0)
  const body = useRef<HTMLTableSectionElement>(null)
  // al tocar un elemento en el 3D, su fila se trae a la vista
  useEffect(() => {
    body.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  return (
    <section aria-label="Despiece de acero" className="flex flex-col gap-2">
      <ul aria-label="Acero por diámetro" className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
        {totals.map(([no, kg]) => (
          <li key={no} className="flex items-center gap-1.5">
            <span className="inline-block size-3 rounded-sm" style={{ background: BAR_TINT[no as BarNo] }} aria-hidden />
            <span className="text-muted">{BARS[no].name}</span>
            <span className="ml-auto font-mono">{m(kg, 1)} kg</span>
          </li>
        ))}
        <li className="col-span-2 flex justify-between border-t border-line pt-1 font-medium">
          <span>Total acero</span>
          <span className="font-mono">{m(total, 1)} kg</span>
        </li>
      </ul>
      <div className="max-h-56 overflow-auto rounded-sm border border-line">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-raised text-left text-muted">
            <tr>
              <th className="px-1.5 py-1 font-normal">Marca</th>
              <th className="px-1 py-1 font-normal">Forma</th>
              <th className="px-1 py-1 text-right font-normal">Cant.</th>
              <th className="px-1 py-1 text-right font-normal" title="Largo de corte de una barra">Corte (m)</th>
              <th className="px-1.5 py-1 text-right font-normal">kg</th>
            </tr>
          </thead>
          <tbody ref={body}>
            {bars.map((b) => {
              const on = b.elementId === selectedId
              return (
                <tr
                  key={b.mark}
                  aria-selected={on}
                  tabIndex={0}
                  onClick={() => onSelect(b.elementId)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    e.preventDefault()
                    onSelect(b.elementId)
                  }}
                  title={`${BARS[b.no].name} · tramos ${b.legs.map((l) => m(l)).join(' + ')} m`}
                  className={`cursor-pointer border-t border-line ${on ? 'bg-accent/15' : 'hover:bg-raised'}`}
                >
                  <td className="px-1.5 py-1 font-mono">{b.mark}</td>
                  <td className="px-1 py-1">
                    <span className="flex items-center gap-1">
                      <ShapeIcon bar={b} />
                      {BARS[b.no].name.split(' ')[0]}
                    </span>
                  </td>
                  <td className="px-1 py-1 text-right font-mono">{b.count}</td>
                  <td className="px-1 py-1 text-right font-mono">{m(b.cutLength)}</td>
                  <td className="px-1.5 py-1 text-right font-mono">{m(barWeight(b), 1)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Button size="sm" icon={<Download className="size-4" aria-hidden />} onClick={() => downloadText(`despiece-acero-${fileBase}.csv`, rebarCsv(bars))}>
        Descargar despiece (CSV)
      </Button>
    </section>
  )
}
