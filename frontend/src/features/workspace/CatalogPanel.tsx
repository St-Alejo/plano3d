/**
 * Catálogo de muebles y pincel de acabados. Una pieza se agrega con clic (al centro
 * del plano) o arrastrándola al lienzo 2D. Usa los mismos controles del resto del panel.
 */
import { PaintRoller, Plus, Search } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Button } from '@/components/ui'
import { FURNITURE_DRAG, searchCatalog } from '@/domain/catalog'
import { FLOOR_MATERIALS, WALL_MATERIALS } from '@/domain/materials'
import { MaterialSelect } from '@/features/editor2d/FurnitureInspector'
import { useEditor } from '@/store/editorStore'
import { addFurnitureAtCenter } from './editActions'

export function CatalogPanel() {
  const [query, setQuery] = useState('')
  const searchId = useId()
  const found = useMemo(() => searchCatalog(query), [query])
  const categories = [...new Set(found.map((c) => c.category))]
  const brush = useEditor((s) => s.brush)
  const setBrush = useEditor((s) => s.setBrush)
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Catálogo de muebles" className="flex flex-col gap-2">
        <h2 className="mb-1 font-mono text-[11px] tracking-[0.14em] text-subtle uppercase">Catálogo</h2>
        <label htmlFor={searchId} className="sr-only">
          Buscar muebles
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="cama, sofá, baño…"
            className="h-8 w-full rounded-md border border-line-strong bg-canvas pr-2 pl-8 text-xs placeholder:text-subtle pointer-coarse:h-11"
          />
        </div>
        {categories.map((cat) => (
          <div key={cat}>
            <h3 className="mt-1 text-[11px] text-subtle">{cat}</h3>
            <ul>
              {found
                .filter((c) => c.category === cat)
                .map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(FURNITURE_DRAG, c.id)
                        e.dataTransfer.effectAllowed = 'copy'
                      }}
                      onClick={() => addFurnitureAtCenter(c.id)}
                      aria-label={`Agregar ${c.name}`}
                      title="Clic para agregar al centro o arrástralo al plano"
                      className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-raised pointer-coarse:min-h-11"
                    >
                      <span className="truncate">{c.name}</span>
                      <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-subtle">
                        {c.width.toFixed(2)}×{c.depth.toFixed(2)}
                        <Plus className="size-3" aria-hidden />
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
        {found.length === 0 && <p className="text-xs text-subtle">Ninguna pieza coincide.</p>}
      </section>

      <section aria-label="Materiales" className="flex flex-col gap-2">
        <h2 className="mb-1 font-mono text-[11px] tracking-[0.14em] text-subtle uppercase">Materiales</h2>
        <MaterialSelect label="Muros" value={brush.wall} options={WALL_MATERIALS} onChange={(id) => id && setBrush({ wall: id })} />
        <MaterialSelect label="Pisos" value={brush.floor} options={FLOOR_MATERIALS} onChange={(id) => id && setBrush({ floor: id })} />
        <Button size="sm" variant={tool === 'paint' ? 'primary' : 'secondary'} aria-pressed={tool === 'paint'} icon={<PaintRoller className="size-4" aria-hidden />} onClick={() => setTool(tool === 'paint' ? 'select' : 'paint')}>
          Pintar (P)
        </Button>
        <p className="text-xs text-subtle">Con el pincel, clic en un muro aplica su acabado; en un ambiente, el piso.</p>
      </section>
    </div>
  )
}
