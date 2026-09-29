import { Trash2 } from 'lucide-react'
import type { Opening, Room } from '@/api/types'
import { useState } from 'react'
import { DeleteOpening, DeleteWall, RelabelRoom, UpdateOpening, UpdateWall } from '@/domain/commands'
import { roomArea, wallLength } from '@/domain/model'
import { Badge, Button, TextField } from '@/components/ui'
import { selectLevel, useEditor } from '@/store/editorStore'

/** Campo numérico que confirma al salir o con Enter (una edición = un comando). */
function NumberField({ label, value, suffix, min, step, onCommit }: {
  label: string
  value: number
  suffix: string
  min: number
  step: number
  onCommit: (v: number) => void
}) {
  const [text, setText] = useState(value.toFixed(2))
  const commit = () => {
    const v = Number(text.replace(',', '.'))
    if (Number.isFinite(v) && v >= min && Math.abs(v - value) > 1e-6) onCommit(v)
    else setText(value.toFixed(2))
  }
  return (
    <TextField
      label={label}
      suffix={suffix}
      inputMode="decimal"
      value={text}
      step={step}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  )
}

function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  return <Badge tone={value < 0.6 ? 'warn' : 'ok'}>confianza {pct}%</Badge>
}

export function PropertiesPanel() {
  const level = useEditor(selectLevel)
  const selection = useEditor((s) => s.selection)
  const dispatch = useEditor((s) => s.dispatch)
  const select = useEditor((s) => s.select)
  const model = useEditor((s) => s.model)

  const room = selection?.kind === 'room' ? level?.rooms.find((r) => r.id === selection.id) : undefined

  if (!level || !model) return null

  if (!selection) {
    const low = level.rooms.filter((r) => r.confidence < 0.6)
    return (
      <div className="flex flex-col gap-3 text-sm">
        <h2 className="font-display text-base font-semibold">Resumen</h2>
        <dl className="grid grid-cols-2 gap-2 font-mono text-xs">
          <dt className="text-subtle">Muros</dt>
          <dd>{level.walls.length}</dd>
          <dt className="text-subtle">Aberturas</dt>
          <dd>{level.walls.reduce((s, w) => s + w.openings.length, 0)}</dd>
          <dt className="text-subtle">Ambientes</dt>
          <dd>{level.rooms.length}</dd>
          <dt className="text-subtle">Superficie</dt>
          <dd>{level.rooms.reduce((s, r) => s + roomArea(r), 0).toFixed(1)} m²</dd>
          <dt className="text-subtle">Escala</dt>
          <dd>{model.scale.source === 'calibrated' ? 'calibrada' : 'estimada'}</dd>
        </dl>
        {model.scale.source !== 'calibrated' && (
          <p className="border-l-2 border-warn pl-3 text-xs text-muted">
            La escala es una estimación. Usa <b>Calibrar</b> y marca una cota conocida para que los metros sean exactos.
          </p>
        )}
        {low.length > 0 && (
          <p className="border-l-2 border-warn pl-3 text-xs text-muted">
            {low.length} ambiente(s) con baja confianza (resaltados en ámbar). Revísalos y ponles nombre.
          </p>
        )}
        <p className="text-xs text-subtle">Selecciona un muro, abertura o ambiente en el plano, o desde esta lista.</p>
        <ElementList />
      </div>
    )
  }

  if (selection.kind === 'wall') {
    const w = level.walls.find((x) => x.id === selection.id)
    if (!w) return null
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-semibold">Muro</h2>
          <Confidence value={w.confidence} />
        </div>
        <p className="font-mono text-xs text-muted">Largo {wallLength(w).toFixed(2)} m · {w.openings.length} abertura(s)</p>
        <p className="text-xs text-subtle">
          Flechas del teclado: mover 5 cm (con Shift, 25 cm). En el plano, arrastra los extremos.
        </p>
        {w.openings.length > 0 && (
          <ul aria-label="Aberturas de este muro" className="flex flex-col gap-1">
            {w.openings.map((o) => (
              <li key={o.id}>
                <Button size="sm" variant="ghost" className="w-full justify-between" onClick={() => select({ kind: 'opening', id: o.id, wallId: w.id })}>
                  <span>{o.kind === 'door' ? 'Puerta' : 'Ventana'}</span>
                  <span className="font-mono text-xs">{o.width.toFixed(2)} m</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
        <NumberField key={`${selection.id}-Grosor-${w.thickness}`} label="Grosor" suffix="m" min={0.02} step={0.01} value={w.thickness} onCommit={(v) => dispatch(new UpdateWall(level.id, w.id, { thickness: v }))} />
        <NumberField key={`${selection.id}-Altura-${w.height}`} label="Altura" suffix="m" min={0.5} step={0.1} value={w.height} onCommit={(v) => dispatch(new UpdateWall(level.id, w.id, { height: v }))} />
        <Button
          variant="danger"
          icon={<Trash2 className="size-4" aria-hidden />}
          onClick={() => dispatch(new DeleteWall(level.id, w.id)) && select(null)}
        >
          Eliminar muro
        </Button>
      </div>
    )
  }

  if (selection.kind === 'opening') {
    const w = level.walls.find((x) => x.id === selection.wallId)
    const o = w?.openings.find((x) => x.id === selection.id)
    if (!w || !o) return null
    const upd = (patch: Partial<Omit<Opening, 'id'>>) =>
      dispatch(new UpdateOpening(level.id, w.id, o.id, patch))
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-semibold">{o.kind === 'door' ? 'Puerta' : 'Ventana'}</h2>
          <Confidence value={o.confidence} />
        </div>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tipo de abertura">
          {(['door', 'window'] as const).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={o.kind === k ? 'primary' : 'secondary'}
              aria-pressed={o.kind === k}
              onClick={() =>
                upd(k === 'door' ? { kind: 'door', sill: 0, height: Math.min(2.1, w.height) } : { kind: 'window', sill: 0.9, height: Math.min(1.2, w.height - 0.9) })
              }
            >
              {k === 'door' ? 'Puerta' : 'Ventana'}
            </Button>
          ))}
        </div>
        <NumberField key={`${selection.id}-Ancho-${o.width}`} label="Ancho" suffix="m" min={0.3} step={0.05} value={o.width} onCommit={(v) => upd({ width: v })} />
        <NumberField key={`${selection.id}-Alto-${o.height}`} label="Alto" suffix="m" min={0.3} step={0.05} value={o.height} onCommit={(v) => upd({ height: v })} />
        {o.kind === 'window' && <NumberField key={`${selection.id}-Antepecho-${o.sill}`} label="Antepecho" suffix="m" min={0} step={0.05} value={o.sill} onCommit={(v) => upd({ sill: v })} />}
        <Button variant="danger" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => dispatch(new DeleteOpening(level.id, w.id, o.id)) && select(null)}>
          Eliminar abertura
        </Button>
      </div>
    )
  }

  if (!room) return null
  return <RoomForm key={`${room.id}:${room.label}`} levelId={level.id} room={room} />
}

function RoomForm({ levelId, room }: { levelId: string; room: Room }) {
  const dispatch = useEditor((s) => s.dispatch)
  const [label, setLabel] = useState(room.label)
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (label.trim() && label !== room.label) dispatch(new RelabelRoom(levelId, room.id, label))
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-semibold">Ambiente</h2>
        <Confidence value={room.confidence} />
      </div>
      <p className="font-mono text-xs text-muted">{roomArea(room).toFixed(2)} m²</p>
      <TextField label="Nombre" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} hint="Ej. Cocina, Dormitorio 1, Baño" />
      <Button type="submit" variant="primary" disabled={!label.trim() || label === room.label}>
        Renombrar
      </Button>
    </form>
  )
}

/** Lista de elementos: permite seleccionar sin mouse ni lienzo (teclado, lector de pantalla). */
function ElementList() {
  const level = useEditor(selectLevel)
  const select = useEditor((s) => s.select)
  if (!level) return null
  const item = 'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-raised pointer-coarse:min-h-11'
  return (
    <div className="flex flex-col gap-3">
      <section aria-labelledby="list-rooms">
        <h3 id="list-rooms" className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">Ambientes</h3>
        <ul>
          {level.rooms.map((r) => (
            <li key={r.id}>
              <button type="button" className={item} onClick={() => select({ kind: 'room', id: r.id })}>
                <span className="flex items-center gap-2">
                  {r.confidence < 0.6 && <span className="size-2 rounded-full bg-warn" aria-label="baja confianza" />}
                  {r.label}
                </span>
                <span className="font-mono text-xs text-subtle">{roomArea(r).toFixed(1)} m²</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="list-walls">
        <h3 id="list-walls" className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">Muros</h3>
        <ul>
          {level.walls.map((w, i) => (
            <li key={w.id}>
              <button type="button" className={item} onClick={() => select({ kind: 'wall', id: w.id })}>
                <span>
                  Muro {i + 1}
                  {w.openings.length > 0 && (
                    <span className="text-subtle">
                      {' '}
                      · {w.openings.filter((o) => o.kind === 'door').length}p {w.openings.filter((o) => o.kind === 'window').length}v
                    </span>
                  )}
                </span>
                <span className="font-mono text-xs text-subtle">{wallLength(w).toFixed(2)} m</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
