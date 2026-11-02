/**
 * Cantidades de obra en vivo: el mismo cálculo del modo obra (dominio `structure/`) sobre el
 * apartamento de muestra. Cambiar la pieza de mampostería recalcula todo, como en la app.
 * La raíz lleva `data-ui`: es un fragmento real de la interfaz, con sus propias líneas.
 */
import clsx from 'clsx'
import { animate, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { BrickId } from '@/domain/structure/bricks'
import { buyAmount, type QuantityLine } from '@/domain/structure/quantities'
import { EASE } from './ease'
import { headline, sampleTotals } from './sampleQuantities'

const BRICK_OPTIONS: { id: BrickId; label: string }[] = [
  { id: 'tolete', label: 'Ladrillo tolete' },
  { id: 'bloque5', label: 'Bloque Nº5' },
]

const format = (v: number, decimals: number) => v.toLocaleString('es-CO', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

/** Cifra que cuenta hasta su nuevo valor (con movimiento reducido, salta directo). */
function Figure({ value, decimals }: { value: number; decimals: number }) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const ctl = animate(from.current, value, { duration: reduce ? 0 : 0.6, ease: EASE, onUpdate: setShown })
    from.current = value
    return () => ctl.stop()
  }, [value, reduce])
  return <>{format(shown, decimals)}</>
}

const row = (l: QuantityLine) => (l.unit === 'und' || l.unit === 'bultos' ? format(buyAmount(l), 0) : format(l.amount, 2))

export default function QuantitiesDemo() {
  const [brick, setBrick] = useState<BrickId>('tolete')
  const rows = useMemo(() => sampleTotals(brick), [brick])
  const figures = headline(rows, brick)

  return (
    <div data-ui className="grid gap-6 rounded-lg bg-(--l-sheet) p-5 text-(--l-on-signal) sm:p-8">
      <div role="group" aria-label="Pieza de mampostería" className="inline-flex w-fit rounded-full bg-black/8 p-1">
        {BRICK_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={brick === o.id}
            onClick={() => setBrick(o.id)}
            className={clsx(
              'min-h-11 rounded-full px-5 font-medium transition-colors duration-300',
              brick === o.id ? 'bg-(--l-on-signal) text-(--l-sheet)' : 'hover:bg-black/8',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4" aria-live="polite">
        {figures.map((f) => (
          <div key={f.key} className="grid">
            <dt className="order-2 t-small">{f.label}</dt>
            <dd className="display order-1 text-5xl leading-none tabular-nums" data-figure={f.key}>
              <Figure value={f.value} decimals={f.decimals} />
            </dd>
          </div>
        ))}
      </dl>

      {/* con scroll propio: enfocable para recorrerla con el teclado */}
      <div role="region" aria-label="Lista de materiales" tabIndex={0} className="max-h-64 overflow-auto rounded-md border border-black/12 bg-white/60">
        <table className="w-full t-small" aria-label="Todos los materiales">
          <thead className="sticky top-0 bg-(--l-sheet) text-left">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Material</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={`${l.item}|${l.unit}`} className="border-t border-black/8">
                <td className="px-3 py-1.5">{l.item}</td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums">
                  {row(l)} {l.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="t-small">Incluye desperdicio (ladrillo 5 %, concreto 5 %, mortero 10 %, acero 3 %). Dosificaciones típicas: confírmelas con el proveedor.</p>
    </div>
  )
}
