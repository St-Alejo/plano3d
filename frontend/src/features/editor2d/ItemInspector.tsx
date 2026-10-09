/** Inspector de columnas y escaleras: posición, medidas y eliminar. */
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Column, Stair } from '@/api/types'
import { Button, TextField } from '@/components/ui'
import { DeleteLevelItem, translateItem, UpdateLevelItem } from '@/domain/commands'
import { useEditor } from '@/store/editorStore'

function Num({ label, value, onCommit, min = 0.01, digits = 2 }: { label: string; value: number; onCommit: (v: number) => void; min?: number; digits?: number }) {
  const [text, setText] = useState(value.toFixed(digits))
  const commit = () => {
    const v = Number(text.replace(',', '.'))
    if (Number.isFinite(v) && v >= min && Math.abs(v - value) > 1e-6) onCommit(v)
    else setText(value.toFixed(digits))
  }
  return (
    <TextField
      label={label}
      suffix={digits === 0 ? '' : 'm'}
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  )
}

export function ColumnInspector({ levelId, column: c }: { levelId: string; column: Column }) {
  const dispatch = useEditor((s) => s.dispatch)
  const select = useEditor((s) => s.select)
  const upd = (patch: Partial<Omit<Column, 'id'>>) => dispatch(new UpdateLevelItem(levelId, 'columns', c.id, patch))
  const move = (dx: number, dy: number) => dispatch(translateItem(levelId, { kind: 'column', value: c }, dx, dy))
  const k = `${c.id}-${c.center.x}-${c.center.y}-${c.width}-${c.depth}`
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-base font-semibold">Columna</h2>
      <div className="grid grid-cols-2 gap-2">
        <Num key={`x${k}`} label="Posición x" min={-1e6} value={c.center.x} onCommit={(v) => move(v - c.center.x, 0)} />
        <Num key={`y${k}`} label="Posición y" min={-1e6} value={c.center.y} onCommit={(v) => move(0, v - c.center.y)} />
        <Num key={`w${k}`} label={c.round ? 'Diámetro' : 'Ancho'} value={c.width} onCommit={(v) => upd({ width: v })} />
        {!c.round && <Num key={`d${k}`} label="Fondo" value={c.depth} onCommit={(v) => upd({ depth: v })} />}
      </div>
      <Button size="sm" variant="secondary" onClick={() => upd({ round: !c.round })}>
        {c.round ? 'Hacerla cuadrada' : 'Hacerla redonda'}
      </Button>
      <p className="text-xs text-subtle">Arrástrala en el plano o muévela con las flechas.</p>
      <Button variant="danger" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => dispatch(new DeleteLevelItem(levelId, 'columns', c.id)) && select(null)}>
        Eliminar columna
      </Button>
    </div>
  )
}

export function StairInspector({ levelId, stair: s }: { levelId: string; stair: Stair }) {
  const dispatch = useEditor((st) => st.dispatch)
  const select = useEditor((st) => st.select)
  const upd = (patch: Partial<Omit<Stair, 'id'>>) => dispatch(new UpdateLevelItem(levelId, 'stairs', s.id, patch))
  const run = Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y)
  const k = `${s.id}-${s.width}-${s.steps}-${s.riser}`
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-base font-semibold">Escalera</h2>
      <p className="text-sm text-muted">
        Tramo de {run.toFixed(2)} m · sube {(s.steps * s.riser).toFixed(2)} m
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Num key={`w${k}`} label="Ancho" value={s.width} onCommit={(v) => upd({ width: v })} />
        <Num key={`n${k}`} label="Escalones" digits={0} min={1} value={s.steps} onCommit={(v) => upd({ steps: Math.round(v) })} />
        <Num key={`r${k}`} label="Contrahuella" value={s.riser} onCommit={(v) => upd({ riser: v })} />
      </div>
      <Button size="sm" variant="secondary" onClick={() => upd({ start: s.end, end: s.start })}>
        Invertir sentido
      </Button>
      <p className="text-xs text-subtle">Arrástrala en el plano o muévela con las flechas.</p>
      <Button variant="danger" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => dispatch(new DeleteLevelItem(levelId, 'stairs', s.id)) && select(null)}>
        Eliminar escalera
      </Button>
    </div>
  )
}
