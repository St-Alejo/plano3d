/** Panel de capas: ver/ocultar y bloquear cada capa del plano, con su número de elementos. */
import clsx from 'clsx'
import { Eye, EyeOff, Lock, LockOpen } from 'lucide-react'
import { selectLevel, useEditor, type LayerKey } from '@/store/editorStore'

const LAYERS: { key: LayerKey; label: string; lockable: boolean }[] = [
  { key: 'image', label: 'Plano original', lockable: false },
  { key: 'rooms', label: 'Ambientes', lockable: true },
  { key: 'walls', label: 'Muros', lockable: true },
  { key: 'openings', label: 'Puertas y ventanas', lockable: true },
  { key: 'dimensions', label: 'Cotas y elementos', lockable: true },
  { key: 'furniture', label: 'Mobiliario', lockable: true },
]

export function LayersPanel() {
  const level = useEditor(selectLevel)
  const hidden = useEditor((s) => s.hiddenLayers)
  const locked = useEditor((s) => s.lockedLayers)
  const toggle = useEditor((s) => s.toggleLayer)
  const levels = useEditor((s) => s.model?.levels ?? [])
  const setLevel = useEditor((s) => s.setLevel)
  const count: Partial<Record<LayerKey, number>> = level
    ? {
        rooms: level.rooms.length,
        walls: level.walls.length,
        openings: level.walls.reduce((n, w) => n + w.openings.length, 0),
        dimensions: (level.dimensions?.length ?? 0) + (level.columns?.length ?? 0) + (level.stairs?.length ?? 0),
        furniture: level.furniture?.length ?? 0,
      }
    : {}

  return (
    <section aria-label="Capas" className="flex flex-col gap-1">
      {levels.length > 1 && (
        <label className="mb-2 flex flex-col gap-1 text-sm">
          <span className="font-mono text-[11px] tracking-[0.14em] text-subtle uppercase">Nivel</span>
          <select
            value={level?.id ?? ''}
            onChange={(e) => setLevel(e.target.value)}
            className="rounded-sm border border-line bg-surface px-2 py-1"
          >
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <h2 className="mb-1 font-mono text-[11px] tracking-[0.14em] text-subtle uppercase">Capas</h2>
      <ul className="flex flex-col">
        {LAYERS.map((l) => {
          const off = hidden.has(l.key)
          const lk = locked.has(l.key)
          const name = l.label.toLowerCase()
          return (
            <li key={l.key} className={clsx('flex items-center gap-1 rounded-sm py-0.5 pr-1 pl-2 text-sm hover:bg-raised', off && 'text-subtle')}>
              <span className="flex-1 truncate">{l.label}</span>
              {count[l.key] !== undefined && <span className="font-mono text-[11px] text-subtle">{count[l.key]}</span>}
              <button
                type="button"
                aria-pressed={!off}
                aria-label={off ? `Mostrar ${name}` : `Ocultar ${name}`}
                title={off ? 'Mostrar' : 'Ocultar'}
                onClick={() => toggle(l.key, 'hidden')}
                className="inline-flex size-7 items-center justify-center rounded-sm text-muted hover:text-fg pointer-coarse:size-11"
              >
                {off ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
              </button>
              {l.lockable ? (
                <button
                  type="button"
                  aria-pressed={lk}
                  aria-label={lk ? `Desbloquear ${name}` : `Bloquear ${name}`}
                  title={lk ? 'Desbloquear' : 'Bloquear (visible pero no seleccionable)'}
                  onClick={() => toggle(l.key, 'locked')}
                  className={clsx('inline-flex size-7 items-center justify-center rounded-sm hover:text-fg pointer-coarse:size-11', lk ? 'text-brand' : 'text-muted')}
                >
                  {lk ? <Lock className="size-3.5" aria-hidden /> : <LockOpen className="size-3.5" aria-hidden />}
                </button>
              ) : (
                <span className="size-7 pointer-coarse:size-11" aria-hidden />
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
