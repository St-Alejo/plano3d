import { AlertTriangle, Info, OctagonAlert, Trash2 } from 'lucide-react'
import type { Dimension, MeasureStatus, Opening, Room } from '@/api/types'
import { useState } from 'react'
import {
  DeleteOpening,
  DeleteWall,
  RelabelRoom,
  DeleteDimension,
  SetDimensionValue,
  SetFloorMaterial,
  SetWallMaterial,
  SetWallAngle,
  SetWallLength,
  UpdateOpening,
  UpdateWall,
} from '@/domain/commands'
import { roomArea, wallDirection, wallLength } from '@/domain/model'
import { modelQA, type QAIssue } from '@/domain/qa'
import { GRID_STEPS, type Selection } from '@/store/editorStore'
import { FurnitureInspector, MaterialSelect } from './FurnitureInspector'
import { FLOOR_MATERIALS, WALL_MATERIALS } from '@/domain/materials'
import { Badge, Button, TextField } from '@/components/ui'
import { selectLevel, useEditor } from '@/store/editorStore'

/** Campo numérico que confirma al salir o con Enter (una edición = un comando). */
function NumberField({ label, value, suffix, min, step, onCommit, digits = 2 }: {
  label: string
  value: number
  suffix: string
  min: number
  step: number
  onCommit: (v: number) => void
  digits?: number
}) {
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

export interface SolveProps {
  /** Ajusta los muros a las cotas (guarda y llama al solver del servidor). */
  onSolve?: () => void
  solving?: boolean
}

export function PropertiesPanel({ onSolve, solving = false }: SolveProps = {}) {
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
          <dd>{SCALE_SOURCE[model.scale.source ?? 'estimated'] ?? 'estimada'}</dd>
        </dl>
        <DimensionsSummary dims={level.dimensions ?? []} onSolve={onSolve} solving={solving} onSelect={select} />
        <QAList issues={modelQA(model)} onSelect={select} />
        {low.length > 0 && (
          <p className="border-l-2 border-warn pl-3 text-xs text-muted">
            Los ambientes dudosos se resaltan en ámbar en el plano.
          </p>
        )}
        <ViewSettings />
        <p className="text-xs text-subtle">Selecciona un muro, abertura o ambiente en el plano, o desde esta lista.</p>
        <ElementList />
      </div>
    )
  }

  if (selection.kind === 'furniture') {
    const f = (level.furniture ?? []).find((x) => x.id === selection.id)
    return f ? <FurnitureInspector key={f.id} furniture={f} /> : null
  }

  if (selection.kind === 'dimension') {
    const d = (level.dimensions ?? []).find((x) => x.id === selection.id)
    if (!d) return null
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-semibold">Cota</h2>
          <StatusBadge status={d.status ?? 'inferred'} />
        </div>
        <p className="text-xs text-muted">
          En el plano dice <span className="font-mono text-ink">{d.text || '—'}</span>
          {d.source === 'vector' ? ' (archivo CAD)' : d.source === 'manual' ? ' (corregida a mano)' : ' (leída de la imagen)'}.
        </p>
        <NumberField
          key={`${d.id}-${d.value}`}
          label="Valor según el plano"
          value={d.value}
          suffix="m"
          min={0.01}
          step={0.01}
          onCommit={(v) => dispatch(new SetDimensionValue(level.id, d.id, v))}
        />
        <dl className="grid grid-cols-2 gap-2 font-mono text-xs">
          <dt className="text-subtle">Medida actual</dt>
          <dd>{(d.measured ?? d.value).toFixed(3)} m</dd>
          <dt className="text-subtle">Diferencia</dt>
          <dd className={Math.abs(d.residual ?? 0) >= 0.01 ? 'text-danger' : ''}>
            {d.residual != null ? `${(d.residual * 100).toFixed(1)} cm` : '—'}
          </dd>
        </dl>
        {onSolve && (
          <Button onClick={onSolve} loading={solving}>
            Ajustar el plano a las cotas
          </Button>
        )}
        <Button
          variant="danger"
          onClick={() => {
            if (dispatch(new DeleteDimension(level.id, d.id))) select(null)
          }}
        >
          Eliminar cota
        </Button>
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
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            key={`${w.id}-largo-${wallLength(w)}`}
            label="Largo"
            suffix="m"
            min={0.05}
            step={0.01}
            value={wallLength(w)}
            onCommit={(v) => dispatch(new SetWallLength(level.id, w.id, v))}
          />
          <NumberField
            key={`${w.id}-angulo-${wallAngle(w)}`}
            label="Ángulo"
            suffix="°"
            min={-360}
            step={1}
            digits={1}
            value={wallAngle(w)}
            onCommit={(v) => dispatch(new SetWallAngle(level.id, w.id, v))}
          />
        </div>
        <p className="text-xs text-subtle">
          El largo mueve la esquina final y los muros unidos la siguen. Flechas: mover 5 cm (Shift: 25 cm).
          Arrastra una esquina en el plano (Alt para despegar solo este muro).
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
        <MaterialSelect label="Acabado" value={w.material} options={WALL_MATERIALS} onChange={(id) => id && dispatch(new SetWallMaterial(level.id, [w.id], id))} />
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

const SCALE_SOURCE: Record<string, string> = {
  calibrated: 'calibrada',
  estimated: 'estimada',
  default: 'estimada',
  dimensions: 'de las cotas',
  vector: 'exacta (CAD)',
}

const STATUS_LABEL: Record<MeasureStatus, string> = {
  exact: 'exacta',
  inferred: 'inferida',
  conflict: 'en conflicto',
}

function StatusBadge({ status }: { status: MeasureStatus }) {
  return <Badge tone={status === 'exact' ? 'ok' : 'warn'}>{STATUS_LABEL[status]}</Badge>
}

/** Estado de las cotas del plano y acceso al ajuste. */
function DimensionsSummary({ dims, onSolve, solving, onSelect }: {
  dims: Dimension[]
  onSolve?: () => void
  solving: boolean
  onSelect: (sel: Selection) => void
}) {
  if (dims.length === 0) return null
  const count = (st: MeasureStatus) => dims.filter((d) => (d.status ?? 'inferred') === st).length
  const conflicts = dims.filter((d) => d.status === 'conflict')
  return (
    <section aria-label="Cotas del plano" className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Cotas del plano</h3>
      <p className="font-mono text-xs">
        <span className="text-ok">{count('exact')} exactas</span>
        {' · '}
        <span className="text-muted">{count('inferred')} por verificar</span>
        {' · '}
        <span className="text-danger">{count('conflict')} en conflicto</span>
      </p>
      {conflicts.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {conflicts.map((d) => (
            <li key={d.id}>
              <button type="button" className="text-left underline" onClick={() => onSelect({ kind: 'dimension', id: d.id })}>
                {d.text || d.value.toFixed(2)} no cierra ({((d.residual ?? 0) * 100).toFixed(1)} cm)
              </button>
            </li>
          ))}
        </ul>
      )}
      {onSolve && (
        <Button size="sm" variant="secondary" onClick={onSolve} loading={solving}>
          Ajustar el plano a las cotas
        </Button>
      )}
    </section>
  )
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
      <MaterialSelect
        label="Piso"
        value={room.floor_material}
        options={FLOOR_MATERIALS}
        emptyLabel="Según el ambiente"
        onChange={(id) => dispatch(new SetFloorMaterial(levelId, room.id, id))}
      />
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

/** Ángulo del muro en grados, en (-180, 180]; 0° = hacia la derecha, 90° = hacia abajo en planta. */
function wallAngle(w: Parameters<typeof wallDirection>[0]): number {
  const d = wallDirection(w)
  return Math.round(((Math.atan2(d.y, d.x) * 180) / Math.PI) * 10) / 10
}

const SEVERITY_UI = {
  error: { icon: OctagonAlert, cls: 'text-danger', label: 'Error' },
  warning: { icon: AlertTriangle, cls: 'text-warn', label: 'Aviso' },
  info: { icon: Info, cls: 'text-subtle', label: 'Nota' },
} as const

/** Lista de revisión del modelo: cada aviso lleva al elemento con un clic. */
function QAList({ issues, onSelect }: { issues: QAIssue[]; onSelect: (t: NonNullable<QAIssue['target']>) => void }) {
  if (issues.length === 0) {
    return <p className="border-l-2 border-ok pl-3 text-xs text-muted">Sin problemas detectados en el modelo.</p>
  }
  return (
    <section aria-labelledby="qa-title">
      <h3 id="qa-title" className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">
        Revisión del modelo ({issues.length})
      </h3>
      <ul className="flex flex-col gap-0.5">
        {issues.map((i, n) => {
          const ui = SEVERITY_UI[i.severity]
          const Icon = ui.icon
          const content = (
            <>
              <Icon className={`mt-0.5 size-3.5 shrink-0 ${ui.cls}`} aria-label={ui.label} />
              <span>{i.message}</span>
            </>
          )
          return (
            <li key={`${i.code}-${n}`}>
              {i.target ? (
                <button type="button" onClick={() => onSelect(i.target!)} className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-raised pointer-coarse:min-h-11">
                  {content}
                </button>
              ) : (
                <p className="flex items-start gap-2 px-2 py-1.5 text-xs">{content}</p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Ajustes de dibujo: rejilla de imán y cotas visibles. */
function ViewSettings() {
  const gridStep = useEditor((s) => s.gridStep)
  const setGridStep = useEditor((s) => s.setGridStep)
  const showDimensions = useEditor((s) => s.showDimensions)
  const toggleDimensions = useEditor((s) => s.toggleDimensions)
  return (
    <section aria-labelledby="view-title" className="flex flex-col gap-2">
      <h3 id="view-title" className="text-xs font-medium tracking-wide text-muted uppercase">Dibujo</h3>
      <label className="flex items-center justify-between gap-2 text-xs">
        <span>Rejilla de imán</span>
        <select
          value={gridStep}
          onChange={(e) => setGridStep(Number(e.target.value))}
          className="h-8 rounded-md border border-line-strong bg-canvas px-2 text-xs pointer-coarse:h-11"
        >
          {GRID_STEPS.map((g) => (
            <option key={g} value={g}>
              {g === 0 ? 'Sin rejilla' : `${Math.round(g * 100)} cm`}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs pointer-coarse:min-h-11">
        <span>Mostrar cotas de muros</span>
        <input type="checkbox" checked={showDimensions} onChange={toggleDimensions} className="size-4 accent-accent" />
      </label>
    </section>
  )
}
