/**
 * Interfaz del recorrido sobre el lienzo: botón de acción según lo que se mira (abrir una
 * puerta, asomarse a una ventana, subir la escalera), piso actual y cambio de piso, puertas
 * automáticas, minimapa con la posición y una ayuda la primera vez.
 *
 * Expone posición, altura, piso y foco en atributos `data-` (pruebas sin leer píxeles).
 */
import { ArrowDown, ArrowUp, DoorOpen, Eye, Footprints, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { BuildingModel } from '@/api/types'
import clsx from 'clsx'
import { useWalk, type Focus } from './walkStore'

const HELP_KEY = 'plano3d-ayuda-recorrido'

function actionLabel(f: Focus): string | null {
  if (!f) return null
  if (f.kind === 'door') return f.open ? 'Cerrar puerta' : 'Abrir puerta'
  if (f.kind === 'window') return 'Asomarse a la ventana'
  return f.up ? 'Subir la escalera' : 'Bajar la escalera'
}

function helpSeen(): boolean {
  try {
    return localStorage.getItem(HELP_KEY) === '1'
  } catch {
    return false
  }
}

function MiniMap({ model, levelId, x, z, heading, onGo }: { model: BuildingModel; levelId: string; x: number; z: number; heading: number; onGo: (x: number, z: number) => void }) {
  const lv = model.levels.find((l) => l.id === levelId) ?? model.levels[0]
  const box = useMemo(() => {
    const pts = (lv?.walls ?? []).flatMap((w) => [w.start, w.end])
    if (pts.length === 0) return null
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const pad = 0.6
    return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) + 2 * pad }
  }, [lv])
  if (!lv || !box) return null
  const size = 132
  const k = size / Math.max(box.w, box.h)
  const px = (v: number, o: number) => (v - o) * k
  return (
    <svg
      role="img"
      aria-label="Minimapa: toca un punto para ir ahí"
      width={box.w * k}
      height={box.h * k}
      className="block cursor-pointer"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        onGo(box.x0 + (e.clientX - r.left) / k, box.y0 + (e.clientY - r.top) / k)
      }}
    >
      {lv.rooms.map((r) => (
        <polygon key={r.id} points={r.polygon.map((p) => `${px(p.x, box.x0)},${px(p.y, box.y0)}`).join(' ')} className="fill-brand/10" />
      ))}
      {lv.walls.map((w) => (
        <line key={w.id} x1={px(w.start.x, box.x0)} y1={px(w.start.y, box.y0)} x2={px(w.end.x, box.x0)} y2={px(w.end.y, box.y0)} className="stroke-fg" strokeWidth={Math.max(1.5, w.thickness * k)} />
      ))}
      <g transform={`translate(${px(x, box.x0)} ${px(z, box.y0)}) rotate(${(heading * 180) / Math.PI})`}>
        <path d="M9 0 L-5 -6 L-2 0 L-5 6 Z" className="fill-accent stroke-canvas" strokeWidth={1.2} />
      </g>
    </svg>
  )
}

export function WalkHud({ model, touch }: { model: BuildingModel; touch: boolean }) {
  const focus = useWalk((s) => s.focus)
  const hud = useWalk((s) => s.hud)
  const auto = useWalk((s) => s.autoDoors)
  const setAuto = useWalk((s) => s.setAutoDoors)
  const send = useWalk((s) => s.send)
  const [help, setHelp] = useState(() => !helpSeen())
  const [mapOpen, setMapOpen] = useState(!touch)
  const label = actionLabel(focus)

  const closeHelp = () => {
    setHelp(false)
    try {
      localStorage.setItem(HELP_KEY, '1')
    } catch {
      /* almacenamiento no disponible */
    }
  }

  return (
    <div
      data-testid="walk-hud"
      data-level={hud?.levelId ?? ''}
      data-level-index={hud?.levelIndex ?? 0}
      data-x={hud ? hud.x.toFixed(2) : ''}
      data-z={hud ? hud.z.toFixed(2) : ''}
      data-y={hud ? hud.y.toFixed(2) : ''}
      data-focus={focus ? `${focus.kind}:${focus.id}` : ''}
      className="pointer-events-none absolute inset-0"
    >
      {/* mira central: indica qué se está apuntando */}
      <div aria-hidden className={clsx('absolute top-1/2 left-1/2 size-2 -translate-1/2 rounded-full', label ? 'bg-accent ring-4 ring-accent/30' : 'bg-white/70')} />

      {/* botón de acción contextual */}
      {label && (
        <button
          type="button"
          onClick={() => send({ type: 'act' })}
          className="pointer-events-auto absolute bottom-40 left-1/2 inline-flex min-h-12 -translate-x-1/2 items-center gap-2 rounded-full bg-accent px-5 text-base font-medium text-accent-ink shadow-lg sm:bottom-28"
        >
          {focus?.kind === 'door' ? <DoorOpen className="size-5" aria-hidden /> : focus?.kind === 'window' ? <Eye className="size-5" aria-hidden /> : <Footprints className="size-5" aria-hidden />}
          {label}
          {!touch && <kbd className="rounded bg-black/15 px-1.5 font-mono text-xs">E</kbd>}
        </button>
      )}

      {/* piso, cambio de piso, puertas automáticas y minimapa */}
      <div className="pointer-events-auto absolute top-16 right-3 flex flex-col items-end gap-2">
        {hud && hud.levelCount > 1 && (
          <div className="flex items-center gap-1 rounded-md border border-line bg-canvas/85 p-1 backdrop-blur">
            <button type="button" aria-label="Bajar un piso" title="Bajar un piso (Z)" disabled={hud.levelIndex <= 0} onClick={() => send({ type: 'level', dir: -1 })} className="inline-flex size-11 items-center justify-center rounded-sm hover:bg-raised disabled:opacity-40">
              <ArrowDown className="size-5" aria-hidden />
            </button>
            <span aria-live="polite" className="px-1 text-sm whitespace-nowrap">
              Piso {hud.levelIndex + 1} de {hud.levelCount}
            </span>
            <button type="button" aria-label="Subir un piso" title="Subir un piso (Q)" disabled={hud.levelIndex >= hud.levelCount - 1} onClick={() => send({ type: 'level', dir: 1 })} className="inline-flex size-11 items-center justify-center rounded-sm hover:bg-raised disabled:opacity-40">
              <ArrowUp className="size-5" aria-hidden />
            </button>
          </div>
        )}
        <button
          type="button"
          aria-pressed={auto}
          onClick={() => setAuto(!auto)}
          className={clsx('inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm backdrop-blur', auto ? 'border-accent bg-accent/15' : 'border-line bg-canvas/85')}
        >
          <DoorOpen className="size-4" aria-hidden /> Puertas automáticas
        </button>
        {hud && (
          <div className="rounded-md border border-line bg-canvas/85 p-1.5 backdrop-blur">
            <button type="button" aria-expanded={mapOpen} onClick={() => setMapOpen((o) => !o)} className="flex min-h-11 w-full items-center justify-between gap-3 px-1.5 text-xs text-muted">
              Minimapa <span className="text-fg">{hud.levelName}</span>
            </button>
            {mapOpen && <MiniMap model={model} levelId={hud.levelId} x={hud.x} z={hud.z} heading={hud.heading} onGo={(x, z) => send({ type: 'teleport', x, z })} />}
          </div>
        )}
      </div>

      {help && (
        <div role="dialog" aria-label="Cómo recorrer" className="pointer-events-auto absolute top-1/2 left-1/2 w-[min(92vw,380px)] -translate-1/2 rounded-xl border border-line-strong bg-canvas/95 p-5 shadow-xl backdrop-blur">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Cómo recorrer</h2>
            <button type="button" aria-label="Cerrar ayuda" onClick={closeHelp} className="inline-flex size-11 items-center justify-center rounded-md hover:bg-raised">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
            {touch ? (
              <>
                <li>Camina con el joystick (al máximo, corres).</li>
                <li>Mira arrastrando un dedo sobre la pantalla.</li>
                <li>Apunta a una puerta, ventana o escalera y toca el botón que aparece, o toca la puerta directamente.</li>
              </>
            ) : (
              <>
                <li>Haz clic en «Clic para caminar»; mira con el mouse.</li>
                <li>
                  Camina con <kbd>W A S D</kbd> o flechas; <kbd>Shift</kbd> corre.
                </li>
                <li>
                  Apunta a una puerta, ventana o escalera y pulsa <kbd>E</kbd>. <kbd>Q</kbd>/<kbd>Z</kbd> sube o baja de piso.
                </li>
              </>
            )}
          </ol>
          <button type="button" onClick={closeHelp} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand text-sm font-medium text-brand-ink">
            Entendido
          </button>
        </div>
      )}
    </div>
  )
}
