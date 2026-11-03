/** Panel de capas: ver/ocultar y bloquear cada capa del plano, con su número de elementos. */
import clsx from 'clsx'
import { useRef, useState } from 'react'
import { api } from '@/api/client'
import { Button, PanelSection } from '@/components/ui'
import { Copy, Eye, EyeOff, FilePlus2, Lock, LockOpen } from 'lucide-react'
import { selectIsDirty, selectLevel, useEditor, type LayerKey } from '@/store/editorStore'

const LAYERS: { key: LayerKey; label: string; lockable: boolean }[] = [
  { key: 'image', label: 'Plano original', lockable: false },
  { key: 'rooms', label: 'Ambientes', lockable: true },
  { key: 'walls', label: 'Muros', lockable: true },
  { key: 'openings', label: 'Puertas y ventanas', lockable: true },
  { key: 'dimensions', label: 'Cotas y elementos', lockable: true },
  { key: 'furniture', label: 'Mobiliario', lockable: true },
]

/** Pisos: otro plano del mismo edificio (foto, PDF o DXF) o una copia del piso actual. */
function LevelActions({ onReload }: { onReload: () => void }) {
  const projectId = useEditor((s) => s.projectId)
  const revision = useEditor((s) => s.revision)
  const dirty = useEditor(selectIsDirty)
  const level = useEditor(selectLevel)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'add' | 'dup' | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!projectId) return null

  const run = async (kind: 'add' | 'dup', call: () => Promise<unknown>) => {
    if (dirty) {
      setError('Guarda los cambios antes de agregar un piso')
      return
    }
    setBusy(kind)
    setError(null)
    try {
      await call()
      onReload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo agregar el piso')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mb-2 flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        <Button size="sm" icon={<FilePlus2 className="size-3.5" aria-hidden />} loading={busy === 'add'} onClick={() => input.current?.click()} title="Detecta otro plano del mismo edificio y lo pone encima, alineado por las columnas">
          Agregar piso
        </Button>
        <Button
          size="sm"
          icon={<Copy className="size-3.5" aria-hidden />}
          loading={busy === 'dup'}
          disabled={!level}
          onClick={() => level && void run('dup', () => api.duplicateLevel(projectId, level.id, undefined, revision))}
          title="Copia este piso encima del último (pisos iguales)"
        >
          Duplicar piso
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf,.dxf"
        className="hidden"
        aria-label="Plano del piso nuevo"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void run('add', () => api.addLevel(projectId, file, undefined, revision))
        }}
      />
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

export function LayersPanel({ onReload }: { onReload?: () => void }) {
  const level = useEditor(selectLevel)
  const hidden = useEditor((s) => s.hiddenLayers)
  const locked = useEditor((s) => s.lockedLayers)
  const toggle = useEditor((s) => s.toggleLayer)
  const levels = useEditor((s) => s.model?.levels ?? [])
  const setLevel = useEditor((s) => s.setLevel)
  const showStructure = useEditor((s) => s.showStructure)
  const toggleStructure = useEditor((s) => s.toggleStructure)
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
    <PanelSection title="Capas" storageKey="capas">
      {onReload && <LevelActions onReload={onReload} />}
      {levels.length > 1 && (
        <label className="mb-2 flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted">Nivel</span>
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
        {/* derivada del plano (no se edita): solo se ve u oculta */}
        <li className={clsx('flex items-center gap-1 rounded-sm py-0.5 pr-1 pl-2 text-sm hover:bg-raised', !showStructure && 'text-subtle')}>
          <span className="flex-1 truncate" title="Columnetas, vigas y cimentación según NSR-10 Título E (guía didáctica)">
            Estructura (obra)
          </span>
          <button
            type="button"
            aria-pressed={showStructure}
            aria-label={showStructure ? 'Ocultar estructura (obra)' : 'Mostrar estructura (obra)'}
            title={showStructure ? 'Ocultar' : 'Mostrar'}
            onClick={toggleStructure}
            className="inline-flex size-7 items-center justify-center rounded-sm text-muted hover:text-fg pointer-coarse:size-11"
          >
            {showStructure ? <Eye className="size-3.5" aria-hidden /> : <EyeOff className="size-3.5" aria-hidden />}
          </button>
          <span className="size-7 pointer-coarse:size-11" aria-hidden />
        </li>
      </ul>
    </PanelSection>
  )
}
