/** Recorrido a pantalla completa: orbitar / caminar, antes-después, ambientes y exportación. */
import * as Slider from '@radix-ui/react-slider'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { ArrowLeft, ChevronUp, Download, Footprints, Layers, Orbit } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '@/api/client'
import type { Point } from '@/api/types'
import { tourWaypoints } from '@/domain/geometry'
import { roomArea } from '@/domain/model'
import { Button, ErrorState, Kbd, Spinner } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { Joystick } from './Joystick'
import { Viewer3D, type ViewMode } from './Viewer3D'
import type { WalkInput } from './WalkControls'
import { downloadBlob, exportGlb } from './scene/exportGlb'
import type { BuiltScene } from './scene/SceneBuilder'

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

  const goTo = (p: Point) => {
    if (mode === 'walk') setWalkStart({ ...p })
    else setFlyTo({ ...p })
  }

  return (
    <div className="relative flex-1 bg-canvas">
      <Viewer3D
        model={model}
        mode={mode}
        overlayUrl={api.imageUrl(project.id, 'rectified', project.updated_at)}
        overlayOpacity={overlay}
        flyTo={flyTo}
        walkStart={walkStart ?? rooms[0]?.at}
        walkInput={walkInput}
        touch={touch}
        onScene={(s) => (scene.current = s)}
        className="absolute inset-0"
        label={`Modelo 3D de ${project.name}`}
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
        <Button
          className="pointer-events-auto h-11"
          loading={exporting}
          aria-label="Descargar modelo GLB"
          title="Descargar el modelo 3D (.glb) para Blender u otros visores"
          icon={<Download className="size-4" aria-hidden />}
          onClick={() => void doExport()}
        >
          <span className="hidden sm:inline">GLB</span>
        </Button>
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
            <div id="viewer-panel" className="flex flex-col gap-2 border-t border-line p-3">
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
