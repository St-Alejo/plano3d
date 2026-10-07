/** Pestaña "Áreas" del inspector: cuadro de áreas, exportación a CSV e impresión en A4. */
import { Download, Printer } from 'lucide-react'
import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui'
import { areaCsv, areaSchedule, type AreaSchedule } from '@/domain/areas'
import { downloadText } from '@/lib/download'
import { selectLevel, useEditor } from '@/store/editorStore'
import './print.css'

const fmt = (v: number) => v.toFixed(2)

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'plano'

function PrintSheet({ name, schedule }: { name: string; schedule: AreaSchedule }) {
  return createPortal(
    <div className="print-sheet" aria-hidden>
      <header style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1.5pt solid #16140f', paddingBottom: '6pt', marginBottom: '12pt' }}>
        <div>
          <div style={{ fontSize: '8pt', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Cuadro de áreas</div>
          <div style={{ fontSize: '18pt' }}>{name}</div>
        </div>
        <div style={{ fontSize: '8pt', textAlign: 'right' }}>
          Plano 3D
          <br />
          {new Date().toLocaleDateString('es-CO', { dateStyle: 'long' })}
        </div>
      </header>
      <table>
        <thead>
          <tr>
            <th>Ambiente</th>
            <th>Tipo</th>
            <th className="num">Área (m²)</th>
            <th className="num">Perímetro (m)</th>
            <th className="num">%</th>
          </tr>
        </thead>
        <tbody>
          {schedule.rows.map((r) => (
            <tr key={r.id}>
              <td>{r.label}</td>
              <td>{r.type}</td>
              <td className="num">{fmt(r.area)}</td>
              <td className="num">{fmt(r.perimeter)}</td>
              <td className="num">{schedule.total ? ((r.area / schedule.total) * 100).toFixed(0) : '0'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={2}>Área útil total</th>
            <th className="num">{fmt(schedule.total)}</th>
            <th />
            <th className="num">100</th>
          </tr>
        </tfoot>
      </table>
      <p style={{ marginTop: '12pt', fontSize: '8pt', color: '#555' }}>
        Áreas medidas sobre el modelo editado (ejes interiores de los ambientes). Verifique la escala antes de usar con fines legales.
      </p>
    </div>,
    document.body,
  )
}

export function AreaSchedulePanel({ projectName }: { projectName: string }) {
  const level = useEditor(selectLevel)
  const select = useEditor((s) => s.select)
  const selection = useEditor((s) => s.selection)
  const schedule = useMemo(() => (level ? areaSchedule(level) : { rows: [], total: 0 }), [level])

  if (schedule.rows.length === 0) {
    return <p className="text-sm text-muted">Todavía no hay ambientes cerrados: dibuja o corrige los muros para que aparezcan.</p>
  }

  return (
    <section aria-label="Cuadro de áreas" className="flex flex-col gap-4">
      <table className="w-full border-collapse font-mono text-xs">
        <caption className="sr-only">Cuadro de áreas</caption>
        <thead>
          <tr className="border-b border-line-strong text-left text-subtle">
            <th scope="col" className="py-1.5 font-normal">
              Ambiente
            </th>
            <th scope="col" className="py-1.5 text-right font-normal">
              m²
            </th>
            <th scope="col" className="py-1.5 text-right font-normal">
              %
            </th>
          </tr>
        </thead>
        <tbody>
          {schedule.rows.map((r) => {
            const sel = selection?.kind === 'room' && selection.id === r.id
            return (
              <tr key={r.id} className={`border-b border-line ${sel ? 'bg-raised' : ''}`}>
                <td className="py-1.5">
                  <button type="button" className="text-left font-sans text-sm hover:text-accent" onClick={() => select({ kind: 'room', id: r.id })}>
                    {r.label}
                  </button>
                  <span className="block text-[10px] text-subtle">
                    {r.type} · perímetro {fmt(r.perimeter)} m
                  </span>
                </td>
                <td className="py-1.5 text-right tabular-nums">{fmt(r.area)}</td>
                <td className="py-1.5 text-right text-subtle tabular-nums">{((r.area / schedule.total) * 100).toFixed(0)}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line-strong">
            <th scope="row" className="py-2 text-left font-sans text-sm font-medium">
              Área útil
            </th>
            <td className="py-2 text-right font-medium tabular-nums">{fmt(schedule.total)}</td>
            <td className="py-2 text-right tabular-nums">100</td>
          </tr>
        </tfoot>
      </table>
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" icon={<Download className="size-4" aria-hidden />} onClick={() => downloadText(`cuadro-de-areas-${slug(projectName)}.csv`, areaCsv(schedule))}>
          CSV
        </Button>
        <Button size="sm" icon={<Printer className="size-4" aria-hidden />} onClick={() => window.print()}>
          Imprimir
        </Button>
      </div>
      <p className="text-xs text-subtle">El CSV abre directo en Excel (separado por punto y coma, con coma decimal).</p>
      <PrintSheet name={projectName} schedule={schedule} />
    </section>
  )
}
