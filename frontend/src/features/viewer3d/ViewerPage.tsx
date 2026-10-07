/** Recorrido a pantalla completa: orbitar / caminar, antes-después, ambientes y exportación. */
import * as Slider from '@radix-ui/react-slider'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { ArrowLeft, Camera, ChevronUp, Download, Footprints, Layers, Orbit, Ruler } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '@/api/client'
import type { Point } from '@/api/types'
import { tourWaypoints } from '@/domain/geometry'
import { roomArea } from '@/domain/model'
import { sunPosition } from '@/domain/sun'
import { Button, ErrorState, Kbd, Spinner } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { Joystick } from './Joystick'
import { Viewer3D, type ViewMode } from './Viewer3D'
import type { WalkInput } from './WalkControls'
import { downloadBlob, exportGlb } from './scene/exportGlb'
import type { BuiltScene } from './scene/SceneBuilder'
import { DISPLAY_LABEL, exportObj, PRESET_LABEL, type CameraPreset, type DisplayMode } from './scene/viewTools'

const SELECT = 'h-8 rounded-md border border-line-strong bg-canvas px-2 text-xs pointer-coarse:h-11'
const today = () => new Date().toISOString().slice(0, 10)

const isTouch = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

export function ViewerPage() {
  const { id = '' } = useParams()
  const { data: project, error, loading } = useAsync(() => api.getProject(id), [id])
  const [mode, setMode] = useState<ViewMode>('orbit')
  const [overlay, setOverlay] = useState(0)
  const [flyTo, setFlyTo] = useState<Point | null>(null)
  const [walkStart, setWalkStart] = useState<Point | undefined>()
  const [exporting, setExporting] = useState(false)
  const scene = useRef<BuiltScene | null>(null)
  const walkInput = useRef<WalkInput>({ x: 0, y: 0 })
  const [touch] = useState(isTouch)
  // en pantallas chicas el panel arranca plegado para no tapar el modelo
  const [panelOpen, setPanelOpen] = useState(() => window.matchMedia('(min-width: 640px)').matches)
  // herramientas de análisis
  const [preset, setPreset] = useState<{ name: CameraPreset; nonce: number } | null>(null)
  const [display, setDisplay] = useState<DisplayMode>('material')
  const [sunOn, setSunOn] = useState(false)
  const [sunDate, setSunDate] = useState(today)
  const [sunHour, setSunHour] = useState(10)
  const [cutOn, setCutOn] = useState(false)
  const [cut, setCut] = useState(1.2)
  const [measuring, setMeasuring] = useState(false)
  const [points, setPoints] = useState<[number, number, number][]>([])
  const box = useRef<HTMLDivElement>(null)
  const onScene = useCallback((s: BuiltScene) => {
    scene.current = s
  }, [])
  const onPoint = useCallback((p: [number, number, number]) => setPoints((prev) => (prev.length >= 2 ? [p] : [...prev, p])), [])

  const rooms = useMemo(() => (project?.model ? tourWaypoints(project.model.levels.flatMap((l) => l.rooms)) : []), [project])

  if (loading) return <div className="p-8"><Spinner label="Cargando modelo" /></div>
  if (error || !project?.model)
    return (
      <div className="p-8">
        <ErrorState title="El modelo no está disponible" message={error?.message ?? 'El proyecto aún no terminó de procesarse.'} action={<Link className="text-accent underline" to={`/p/${id}`}>Volver</Link>} />
      </div>
    )

  const model = project.model

  const doExport = async () => {
    if (!scene.current) return
    setExporting(true)
    try {
      downloadBlob(await exportGlb(scene.current.root), `${project.name.replace(/[^\w-]+/g, '_') || 'plano'}.glb`)
    } finally {
      setExporting(false)
    }
  }

  const fileBase = project.name.replace(/[^\w-]+/g, '_') || 'plano'
  const sun = (() => {
    if (!sunOn) return null
    const [y, m, d] = sunDate.split('-').map(Number)
    return sunPosition({ year: y ?? 2026, month: m ?? 1, day: d ?? 1, hour: sunHour })
  })()

  const doObj = async () => {
    if (!scene.current) return
    setExporting(true)
    try {
      downloadBlob(await exportObj(scene.current.root), `${fileBase}.obj`)
    } finally {
      setExporting(false)
    }
  }

  const doPng = () => {
    const canvas = box.current?.querySelector('canvas')
    if (!canvas) return
    canvas.toBlob((blob) => blob && downloadBlob(blob, `${fileBase}.png`), 'image/png')
  }

  const goTo = (p: Point) => {
    if (mode === 'walk') setWalkStart({ ...p })
    else setFlyTo({ ...p })
  }

  return (
    <div ref={box} className="relative flex-1 bg-canvas">
      <Viewer3D
        model={model}
        mode={mode}
        overlayUrl={api.imageUrl(project.id, 'rectified', project.updated_at)}
        overlayOpacity={overlay}
        flyTo={flyTo}
        walkStart={walkStart ?? rooms[0]?.at}
        walkInput={walkInput}
        touch={touch}
        onScene={onScene}
        className="absolute inset-0"
        label={`Modelo 3D de ${project.name}`}
        sun={sun}
        section={cutOn ? cut : null}
        preset={preset}
        display={display}
        measure={measuring ? { points, onPoint } : null}
      />

      {/* barra superior: compacta en el celular (solo íconos) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
        <Link
          to={`/p/${project.id}`}
          aria-label="Volver al editor"
          className="pointer-events-auto inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-md border border-line bg-canvas/80 px-3 text-sm backdrop-blur hover:border-accent"
        >
          <ArrowLeft className="size-4" aria-hidden /> <span className="hidden sm:inline">Editor</span>
        </Link>
        <ToggleGroup.Root
          type="single"
          value={mode}
          onValueChange={(v) => v && setMode(v as ViewMode)}
          aria-label="Modo de cámara"
          className="pointer-events-auto flex rounded-md border border-line bg-canvas/80 p-1 backdrop-blur"
        >
          <ToggleGroup.Item value="orbit" className="inline-flex h-10 pointer-coarse:h-11 items-center gap-1.5 rounded-sm px-3 text-sm text-muted data-[state=on]:bg-accent data-[state=on]:text-accent-ink">
            <Orbit className="size-4" aria-hidden /> Orbitar
          </ToggleGroup.Item>
          <ToggleGroup.Item value="walk" className="inline-flex h-10 pointer-coarse:h-11 items-center gap-1.5 rounded-sm px-3 text-sm text-muted data-[state=on]:bg-accent data-[state=on]:text-accent-ink">
            <Footprints className="size-4" aria-hidden /> Recorrer
          </ToggleGroup.Item>
        </ToggleGroup.Root>
        <div className="pointer-events-auto flex gap-2">
        {/* en el celular la barra no da para más botones: PNG y OBJ desde pantallas medianas */}
        <div className="hidden gap-2 sm:flex">
        <Button className="h-11" aria-label="Guardar imagen PNG" title="Guardar la vista actual como imagen" icon={<Camera className="size-4" aria-hidden />} onClick={doPng}>
          <span className="hidden sm:inline">PNG</span>
        </Button>
        <Button className="h-11" loading={exporting} aria-label="Descargar modelo OBJ" title="Descargar el modelo 3D (.obj) para SketchUp, Revit u otros" icon={<Download className="size-4" aria-hidden />} onClick={() => void doObj()}>
          <span className="hidden sm:inline">OBJ</span>
        </Button>
        </div>
        <Button
          className="h-11"
          loading={exporting}
          aria-label="Descargar modelo GLB"
          title="Descargar el modelo 3D (.glb) para Blender u otros visores"
          icon={<Download className="size-4" aria-hidden />}
          onClick={() => void doExport()}
        >
          <span className="hidden sm:inline">GLB</span>
        </Button>
        </div>
      </div>

      {/* panel inferior plegable: antes/después + ambientes (plegado por defecto en el celular) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3">
        <div className="pointer-events-auto flex max-w-[calc(100%-9rem)] flex-col rounded-md border border-line bg-canvas/85 backdrop-blur sm:w-80 sm:max-w-none">
          <button
            type="button"
            aria-expanded={panelOpen}
            aria-controls="viewer-panel"
            onClick={() => setPanelOpen((o) => !o)}
            className="flex min-h-11 items-center justify-between gap-2 px-3 text-sm font-medium"
          >
            <span className="flex items-center gap-2">
              <Layers className="size-4 text-accent" aria-hidden /> Ambientes<span className="hidden sm:inline"> y plano</span>
            </span>
            <ChevronUp className={`size-4 transition-transform ${panelOpen ? '' : 'rotate-180'}`} aria-hidden />
          </button>
          {panelOpen && (
            <div id="viewer-panel" className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto border-t border-line p-3">
              <label id="overlay-label" className="flex justify-between text-xs text-muted">
                <span>Plano original sobre el modelo</span>
                <span className="font-mono">{Math.round(overlay * 100)}%</span>
              </label>
              <Slider.Root className="relative flex h-11 touch-none items-center" value={[overlay]} max={1} step={0.01} onValueChange={([v]) => setOverlay(v ?? 0)} aria-labelledby="overlay-label">
                <Slider.Track className="relative h-1 grow bg-raised">
                  <Slider.Range className="absolute h-full bg-accent" />
                </Slider.Track>
                <Slider.Thumb className="block size-7 rounded-full border-2 border-accent bg-canvas" aria-label="Opacidad del plano original" />
              </Slider.Root>
              <nav aria-label="Ambientes" className="flex max-h-40 flex-col overflow-y-auto">
                {rooms.map((r) => {
                  const room = model.levels.flatMap((l) => l.rooms).find((x) => x.id === r.id)
                  return (
                    <button key={r.id} type="button" onClick={() => goTo(r.at)} className="flex min-h-11 items-center justify-between gap-3 rounded-sm px-2 text-left text-sm hover:bg-raised sm:min-h-9">
                      <span>{r.label}</span>
                      <span className="font-mono text-xs text-subtle">{room ? roomArea(room).toFixed(1) : ''} m²</span>
                    </button>
                  )
                })}
              </nav>

              <section aria-label="Vista" className="flex flex-col gap-2 border-t border-line pt-2">
                <div className="grid grid-cols-4 gap-1" role="group" aria-label="Encuadre">
                  {(Object.keys(PRESET_LABEL) as CameraPreset[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setMode('orbit')
                        setPreset({ name: p, nonce: Date.now() })
                      }}
                      className="min-h-11 rounded-sm px-1 text-xs hover:bg-raised sm:min-h-8"
                    >
                      {PRESET_LABEL[p]}
                    </button>
                  ))}
                </div>
                <label className="flex items-center justify-between gap-2 text-xs">
                  <span>Visualización</span>
                  <select value={display} onChange={(e) => setDisplay(e.target.value as DisplayMode)} className={SELECT}>
                    {(Object.keys(DISPLAY_LABEL) as DisplayMode[]).map((d) => (
                      <option key={d} value={d}>
                        {DISPLAY_LABEL[d]}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              <section aria-label="Estudio solar" className="flex flex-col gap-2 border-t border-line pt-2">
                <label className="flex items-center justify-between gap-2 text-xs pointer-coarse:min-h-11">
                  <span>Estudio solar (Bogotá)</span>
                  <input type="checkbox" checked={sunOn} onChange={(e) => setSunOn(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
                </label>
                {sunOn && (
                  <>
                    <label className="flex items-center justify-between gap-2 text-xs">
                      <span>Fecha</span>
                      <input type="date" value={sunDate} onChange={(e) => e.target.value && setSunDate(e.target.value)} className={SELECT} />
                    </label>
                    <label id="sun-hour-label" className="flex justify-between text-xs text-muted">
                      <span>Hora</span>
                      <span className="font-mono">
                        {String(Math.floor(sunHour)).padStart(2, '0')}:{String(Math.round((sunHour % 1) * 60)).padStart(2, '0')}
                      </span>
                    </label>
                    <Slider.Root className="relative flex h-11 touch-none items-center" value={[sunHour]} min={5} max={19} step={0.25} onValueChange={([v]) => setSunHour(v ?? 12)} aria-labelledby="sun-hour-label">
                      <Slider.Track className="relative h-1 grow bg-raised">
                        <Slider.Range className="absolute h-full bg-accent" />
                      </Slider.Track>
                      <Slider.Thumb className="block size-7 rounded-full border-2 border-accent bg-canvas" aria-label="Hora del día" />
                    </Slider.Root>
                    {sun && (
                      <p className="font-mono text-[11px] text-subtle" aria-live="polite">
                        {sun.altitude > 0 ? `altura ${sun.altitude.toFixed(0)}° · azimut ${sun.azimuth.toFixed(0)}°` : 'el sol está bajo el horizonte'}
                      </p>
                    )}
                  </>
                )}
              </section>

              <section aria-label="Corte de sección" className="flex flex-col gap-2 border-t border-line pt-2">
                <label className="flex items-center justify-between gap-2 text-xs pointer-coarse:min-h-11">
                  <span>Corte horizontal</span>
                  <input type="checkbox" checked={cutOn} onChange={(e) => setCutOn(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
                </label>
                {cutOn && (
                  <>
                    <label id="cut-label" className="flex justify-between text-xs text-muted">
                      <span>Altura del corte</span>
                      <span className="font-mono">{cut.toFixed(2)} m</span>
                    </label>
                    <Slider.Root className="relative flex h-11 touch-none items-center" value={[cut]} min={0.2} max={3} step={0.05} onValueChange={([v]) => setCut(v ?? 1.2)} aria-labelledby="cut-label">
                      <Slider.Track className="relative h-1 grow bg-raised">
                        <Slider.Range className="absolute h-full bg-accent" />
                      </Slider.Track>
                      <Slider.Thumb className="block size-7 rounded-full border-2 border-accent bg-canvas" aria-label="Altura del corte" />
                    </Slider.Root>
                  </>
                )}
              </section>

              <section aria-label="Medir en 3D" className="flex flex-col gap-2 border-t border-line pt-2">
                <Button
                  size="sm"
                  variant={measuring ? 'primary' : 'secondary'}
                  aria-pressed={measuring}
                  icon={<Ruler className="size-4" aria-hidden />}
                  onClick={() => {
                    setMeasuring((m) => !m)
                    setPoints([])
                  }}
                >
                  Medir
                </Button>
                {measuring && (
                  <p className="text-xs text-subtle">
                    {points.length < 2 ? 'Haz clic en dos puntos del modelo.' : 'Un clic más empieza una medición nueva.'}
                  </p>
                )}
              </section>
            </div>
          )}
        </div>

        {mode === 'walk' &&
          (touch ? (
            <div className="pointer-events-auto">
              <Joystick
                onChange={(x, y) => {
                  walkInput.current.x = x
                  walkInput.current.y = y
                }}
              />
            </div>
          ) : (
            <div className="pointer-events-auto rounded-md border border-line bg-canvas/85 p-3 text-xs text-muted backdrop-blur">
              <button id="walk-start" type="button" className="mb-2 block rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-ink">
                Clic para caminar
              </button>
              <Kbd>W A S D</Kbd> moverse · mouse para mirar · <Kbd>Esc</Kbd> soltar
            </div>
          ))}
      </div>
    </div>
  )
}
