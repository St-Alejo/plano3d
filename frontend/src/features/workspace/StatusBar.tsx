/** Barra de estado del editor: pista de la herramienta, cursor en metros, zoom, imán, escala y selección. */
import { Keyboard } from 'lucide-react'
import { useEditor } from '@/store/editorStore'

const SCALE_LABEL: Record<string, string> = {
  default: 'escala por defecto',
  estimated: 'escala estimada',
  calibrated: 'escala calibrada',
  dimensions: 'escala por cotas',
  vector: 'escala exacta (vector)',
}

export function StatusBar({ hint, onHelp }: { hint?: string; onHelp: () => void }) {
  const cursor = useEditor((s) => s.cursor)
  const zoom = useEditor((s) => s.zoom)
  const grid = useEditor((s) => s.gridStep)
  const source = useEditor((s) => s.model?.scale.source)
  const count = useEditor((s) => s.group.length)

  const cell = 'border-l border-line px-3 whitespace-nowrap'
  return (
    <footer aria-label="Barra de estado" className="flex h-8 shrink-0 items-center border-t border-line bg-surface font-mono text-[11px] text-muted">
      <p className="min-w-0 flex-1 truncate px-3 font-sans text-xs">{hint}</p>
      <span className={cell} aria-label="Posición del cursor">
        {cursor ? `x ${cursor.x.toFixed(2)} · y ${cursor.y.toFixed(2)} m` : 'x — · y —'}
      </span>
      <span className={cell}>{Math.round(zoom * 100)} %</span>
      <span className={cell}>{grid > 0 ? `imán ${Math.round(grid * 100)} cm` : 'sin imán'}</span>
      <span className={cell}>{SCALE_LABEL[source ?? 'default'] ?? source}</span>
      <span className={cell} aria-live="polite">
        {count === 0 ? 'sin selección' : count === 1 ? '1 seleccionado' : `${count} seleccionados`}
      </span>
      <button type="button" onClick={onHelp} className="inline-flex h-full items-center gap-1.5 border-l border-line px-3 hover:bg-raised hover:text-fg">
        <Keyboard className="size-3.5" aria-hidden /> Atajos
      </button>
    </footer>
  )
}
