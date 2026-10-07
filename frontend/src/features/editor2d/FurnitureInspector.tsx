/** Inspector de un mueble y selectores de acabado (mismos campos y estilos que el resto del panel). */
import { RotateCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Furniture } from '@/api/types'
import { Button, TextField } from '@/components/ui'
import { catalogItem } from '@/domain/catalog'
import { DeleteFurniture, UpdateFurniture } from '@/domain/commands'
import { wallsHitBy } from '@/domain/furniture'
import type { MaterialSpec } from '@/domain/materials'
import { selectLevel, useEditor } from '@/store/editorStore'

const SELECT = 'h-8 rounded-md border border-line-strong bg-canvas px-2 text-xs pointer-coarse:h-11'

export function MaterialSelect({
  label,
  value,
  options,
  onChange,
  emptyLabel,
}: {
  label: string
  value: string | null | undefined
  options: MaterialSpec[]
  onChange: (id: string | null) => void
  emptyLabel?: string
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span>{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={SELECT}>
        {emptyLabel && <option value="">{emptyLabel}</option>}
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function Measure({ label, value, min, onCommit, suffix = 'm', digits = 2 }: { label: string; value: number; min: number; onCommit: (v: number) => void; suffix?: string; digits?: number }) {
  const [text, setText] = useState(value.toFixed(digits))
  const commit = () => {
    const v = Number(text.replace(',', '.'))
    if (Number.isFinite(v) && v >= min && Math.abs(v - value) > 1e-6) onCommit(v)
    else setText(value.toFixed(digits))
  }
  return (
    <TextField
      label={label}
      suffix={suffix}
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  )
}

const deg = (rad: number) => ((((rad * 180) / Math.PI) % 360) + 360) % 360

export function FurnitureInspector({ furniture: f }: { furniture: Furniture }) {
  const level = useEditor(selectLevel)
  const dispatch = useEditor((s) => s.dispatch)
  const select = useEditor((s) => s.select)
  if (!level) return null
  const item = catalogItem(f.catalog_id)
  const hits = wallsHitBy(f, level.walls)
  const upd = (patch: Partial<Furniture>, label = 'Editar mueble') => dispatch(new UpdateFurniture(level.id, f.id, patch, label))
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-semibold">Mueble</h2>
      </div>
      <p className="text-sm">{item?.name ?? f.catalog_id}</p>
      {hits.length > 0 && (
        <p role="status" className="border-l-2 border-warn pl-2 text-xs text-warn">
          Atraviesa {hits.length === 1 ? 'un muro' : `${hits.length} muros`}: muévelo o gíralo.
        </p>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Measure key={`${f.id}-w-${f.width}`} label="Ancho" value={f.width} min={0.05} onCommit={(v) => upd({ width: v })} />
        <Measure key={`${f.id}-d-${f.depth}`} label="Fondo" value={f.depth} min={0.05} onCommit={(v) => upd({ depth: v })} />
        <Measure key={`${f.id}-h-${f.height}`} label="Alto" value={f.height} min={0.01} onCommit={(v) => upd({ height: v })} />
      </div>
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <Measure
          key={`${f.id}-r-${f.rotation}`}
          label="Giro"
          suffix="°"
          digits={0}
          value={deg(f.rotation ?? 0)}
          min={-360}
          onCommit={(v) => upd({ rotation: (v * Math.PI) / 180 }, 'Girar mueble')}
        />
        <Button size="sm" icon={<RotateCw className="size-4" aria-hidden />} onClick={() => upd({ rotation: (f.rotation ?? 0) + Math.PI / 2 }, 'Girar mueble')}>
          90°
        </Button>
      </div>
      <p className="text-xs text-subtle">Arrástralo en el plano; R lo gira 90° y las flechas lo mueven 5 cm.</p>
      <Button
        variant="danger"
        icon={<Trash2 className="size-4" aria-hidden />}
        onClick={() => {
          if (dispatch(new DeleteFurniture(level.id, f.id))) select(null)
        }}
      >
        Eliminar mueble
      </Button>
    </div>
  )
}
