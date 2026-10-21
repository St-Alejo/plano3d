/**
 * Cantidades de obra: totales para comprar y, por etapa de la secuencia, qué se necesita en
 * cada momento. Se calcula solo al abrir el panel (recorre el ladrillo pieza por pieza).
 */
import { Calculator, Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { BuildingModel } from '@/api/types'
import { Button } from '@/components/ui'
import type { Structure } from '@/domain/structure/derive'
import { masonryLayout } from '@/domain/structure/masonryLayout'
import { buyAmount, quantities, quantitiesCsv, quantityTotals, type QuantityLine } from '@/domain/structure/quantities'
import { constructionSchedule } from '@/domain/structure/schedule'
import { downloadText } from '@/lib/download'

const SELECT = 'h-8 w-full rounded-md border border-line-strong bg-canvas px-2 text-xs pointer-coarse:h-11'
const ALL = 'toda'

const fmt = (l: QuantityLine) => (l.unit === 'und' || l.unit === 'bultos' ? buyAmount(l).toLocaleString('es-CO') : l.amount.toFixed(2).replace('.', ','))

function Report({ model, structure, fileBase }: { model: BuildingModel; structure: Structure; fileBase: string }) {
  const [stage, setStage] = useState(ALL)
  const { lines, steps } = useMemo(() => {
    const bricks = masonryLayout(model, structure)
    return { lines: quantities(model, structure, bricks), steps: constructionSchedule(model, structure, bricks) }
  }, [model, structure])
  const title = (id: string) => steps.find((s) => s.id === id)?.title ?? id
  // solo las etapas que compran algo, en el orden de la obra
  const stages = steps.filter((s) => lines.some((l) => l.step === s.id))
  const rows = stage === ALL ? quantityTotals(lines) : lines.filter((l) => l.step === stage)

  return (
    <div className="flex flex-col gap-2 pt-2">
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted">Qué comprar para</span>
        <select value={stage} onChange={(e) => setStage(e.target.value)} className={SELECT}>
          <option value={ALL}>Toda la obra</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </label>
      <div className="max-h-56 overflow-auto rounded-sm border border-line">
        <table className="w-full text-xs" aria-label="Cantidades">
          <thead className="sticky top-0 bg-raised text-left text-muted">
            <tr>
              <th className="px-1.5 py-1 font-normal">Material</th>
              <th className="px-1.5 py-1 text-right font-normal">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={`${l.step}|${l.item}|${l.unit}`} className="border-t border-line">
                <td className="px-1.5 py-1">{l.item}</td>
                <td className="whitespace-nowrap px-1.5 py-1 text-right font-mono">
                  {fmt(l)} {l.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-snug text-subtle">Incluye desperdicio (ladrillo 5 %, concreto 5 %, mortero 10 %, acero 3 %). Dosificaciones típicas: confírmelas con el proveedor.</p>
      <Button size="sm" icon={<Download className="size-4" aria-hidden />} onClick={() => downloadText(`cantidades-obra-${fileBase}.csv`, quantitiesCsv(lines, title))}>
        Descargar cantidades (CSV)
      </Button>
    </div>
  )
}

export function QuantitiesPanel({ model, structure, fileBase }: { model: BuildingModel; structure: Structure; fileBase: string }) {
  const [open, setOpen] = useState(false)
  return (
    <details className="rounded-md border border-line px-2 py-1" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex min-h-9 cursor-pointer items-center gap-2 text-xs font-medium pointer-coarse:min-h-11">
        <Calculator className="size-4 text-accent" aria-hidden /> Cantidades de obra
      </summary>
      {open && <Report model={model} structure={structure} fileBase={fileBase} />}
    </details>
  )
}
