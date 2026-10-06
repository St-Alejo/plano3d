/** Inspector cuando hay varios elementos seleccionados: resumen y acciones de grupo. */
import { Copy, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui'
import { wallLength } from '@/domain/model'
import { selectLevel, useEditor } from '@/store/editorStore'
import { canDelete, deleteSelection, duplicateSelection } from './editActions'

export function GroupInspector() {
  const group = useEditor((s) => s.group)
  const level = useEditor(selectLevel)
  const select = useEditor((s) => s.select)
  const walls = level?.walls.filter((w) => group.some((g) => g.kind === 'wall' && g.id === w.id)) ?? []
  const openings = group.filter((g) => g.kind === 'opening').length
  const rooms = group.filter((g) => g.kind === 'room').length
  const total = walls.reduce((s, w) => s + wallLength(w), 0)

  return (
    <section aria-label="Selección múltiple" className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-2xl font-normal">{group.length} elementos</h2>
        <p className="text-xs text-muted">Shift+clic agrega o quita; Shift+arrastrar selecciona por caja.</p>
      </div>
      <dl className="grid grid-cols-2 gap-y-1 font-mono text-xs">
        <dt className="text-subtle">Muros</dt>
        <dd>{walls.length}</dd>
        <dt className="text-subtle">Largo total</dt>
        <dd>{total.toFixed(2)} m</dd>
        <dt className="text-subtle">Aberturas</dt>
        <dd>{openings}</dd>
        <dt className="text-subtle">Ambientes</dt>
        <dd>{rooms}</dd>
      </dl>
      <div className="flex flex-col gap-2">
        <Button size="sm" icon={<Copy className="size-4" aria-hidden />} disabled={walls.length === 0} onClick={() => void duplicateSelection()}>
          Duplicar muros
        </Button>
        <Button size="sm" variant="danger" icon={<Trash2 className="size-4" aria-hidden />} disabled={!canDelete()} onClick={() => void deleteSelection()}>
          Eliminar selección
        </Button>
        <Button size="sm" variant="ghost" icon={<X className="size-4" aria-hidden />} onClick={() => select(null)}>
          Quitar selección
        </Button>
      </div>
      <p className="text-xs text-subtle">Flechas: mover el grupo 5 cm (25 cm con Shift).</p>
    </section>
  )
}
