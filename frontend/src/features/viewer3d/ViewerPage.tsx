/** Recorrido a pantalla completa: orbitar / caminar, antes-después, ambientes y exportación. */
import * as Slider from '@radix-ui/react-slider'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import * as Tabs from '@radix-ui/react-tabs'
import { ArrowLeft, Camera, ChevronUp, Download, Footprints, Layers, Orbit, Paintbrush, Ruler, Sofa } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { api } from '@/api/client'
import type { Point, Project } from '@/api/types'
import { streetEntry } from '@/domain/facadeGeometry'
import { facadeSpec, nextFacade, type FacadeStyle } from '@/domain/facades'
import { tourWaypoints } from '@/domain/geometry'
import { roomArea } from '@/domain/model'
import { fold } from '@/domain/planOps'
import { sunPosition } from '@/domain/sun'
import { Button, ErrorState, Kbd, Menu, Spinner } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { TutorialButton } from '@/features/studio/TutorialButton'
import { Joystick } from './Joystick'
import { Viewer3D, type FlyTarget, type Quality, type ViewMode } from './Viewer3D'
import { LevelRail } from './LevelRail'
import { applyLevelFocus, highlightLevel } from './scene/levelFocus'
import { levelCamera, levelsAbove, levelSummaries } from '@/domain/levels'
import type { WalkInput, WalkStart } from './WalkControls'
import { WalkHud } from './WalkHud'
import { resetDoorProgress } from './doors'
import { useWalk } from './walkStore'
import { PLAN_MODES, planMode } from './modes'
import { ObraPanel } from './ObraPanel'
import { BRICKS, type BrickId } from '@/domain/structure/bricks'
import { deriveStructure } from '@/domain/structure/derive'
import type { StepCommand } from './SequencePanel'
import { ViewerChat, type ViewerReply } from './ViewerChat'
import { quantityAnswer, type ViewerAction } from './viewerCommands'
import { downloadBlob, exportGlb } from './scene/exportGlb'
import { exportRoot, type BuiltScene } from './scene/SceneBuilder'
import { DISPLAY_LABEL, exportObj, PRESET_LABEL, type CameraPreset, type DisplayMode } from './scene/viewTools'

const SELECT = 'h-8 rounded-md border border-line-strong bg-canvas px-2 text-xs pointer-coarse:h-11'
const today = () => new Date().toISOString().slice(0, 10)

const isTouch = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

const QUALITY_KEY = 'plano3d-calidad'

/** Pestañas del panel del visor: lo frecuente primero; "Obra" solo existe en los modos de obra. */
type DockTab = 'ambientes' | 'vista' | 'obra' | 'analisis'
const DOCK_TABS: { id: DockTab; label: string }[] = [
  { id: 'ambientes', label: 'Ambientes' },
  { id: 'vista', label: 'Vista' },
  { id: 'obra', label: 'Obra' },
  { id: 'analisis', label: 'Análisis' },
]

/** ¿El navegador dibuja sin tarjeta gráfica (SwiftShader, llvmpipe)? Ahí la calidad alta no fluye. */
function softwareRenderer(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    const name = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return /swiftshader|llvmpipe|software|basic render/i.test(name)
  } catch {
    return false
  }
}

/** La calidad elegida se recuerda; sin elección, baja en celulares o sin GPU, y alta en el resto. */
function initialQuality(): Quality {
  try {
    const saved = localStorage.getItem(QUALITY_KEY)
    if (saved === 'alta' || saved === 'baja') return saved
  } catch {
    // almacenamiento bloqueado: se usa el valor por defecto
  }
  return isTouch() || softwareRenderer() ? 'baja' : 'alta'
}

export function ViewerPage() {
  const { id = '' } = useParams()
  const { data: loaded, error, loading } = useAsync(() => api.getProject(id), [id])
  // lo que se guarda desde el visor (amoblar) reemplaza al proyecto cargado sin recargarlo
  const [saved, setSaved] = useState<Project | null>(null)
  const project = saved && saved.id === loaded?.id ? saved : loaded
  // última revisión guardada desde aquí (fachada, muebles): la siguiente escritura la exige
  const [savedRevision, setSavedRevision] = useState<{ id: string; n: number } | null>(null)
  const revision = savedRevision && savedRevision.id === project?.id ? savedRevision.n : project?.revision
  const setRevision = (p: Project) => setSavedRevision({ id: p.id, n: p.revision })
  const [mode, setMode] = useState<ViewMode>('orbit')
  // el modo del plano vive en la URL (?modo=obra) para poder compartir el enlace
  const [params, setParams] = useSearchParams()
  const strategy = planMode(params.get('modo'))
  const [tab, setTabState] = useState<DockTab>(() => (strategy.panel ? 'obra' : 'ambientes'))
  const setTab = (t: string) => setTabState(t as DockTab)
  // sin modo de obra no hay pestaña "Obra": se muestra la primera
  const activeTab: DockTab = tab === 'obra' && !strategy.panel ? 'ambientes' : tab
  const choosePlanMode = (id: string) => {
    // al entrar a un modo de obra se muestra su panel
    if (planMode(id).panel) setTabState('obra')
    setParams((p) => {
      if (id === 'presentacion') p.delete('modo')
      else p.set('modo', id)
      return p
    }, { replace: true })
  }
  const [overlay, setOverlay] = useState(0)
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null)
  // selector de pisos: piso aislado y piso resaltado (cursor o foco)
  const [focusLevel, setFocusLevel] = useState<string | null>(null)
  const [hoverLevel, setHoverLevel] = useState<string | null>(null)
  const [walkStart, setWalkStart] = useState<WalkStart | undefined>()
  const [exporting, setExporting] = useState(false)
  const scene = useRef<BuiltScene | null>(null)
  const walkInput = useRef<WalkInput>({ x: 0, y: 0 })
  const [touch] = useState(isTouch)
  // en pantallas chicas el panel arranca plegado para no tapar el modelo
  const [panelOpen, setPanelOpen] = useState(() => window.matchMedia('(min-width: 640px)').matches)
  // herramientas de análisis
  const [preset, setPreset] = useState<{ name: CameraPreset; nonce: number } | null>(null)
  const [display, setDisplay] = useState<DisplayMode>('material')
  const [quality, setQualityState] = useState<Quality>(initialQuality)
  const setQuality = (q: Quality) => {
    setQualityState(q)
    try {
      localStorage.setItem(QUALITY_KEY, q)
    } catch {
      // sin almacenamiento la elección dura lo que la página
    }
  }
  const [roof, setRoof] = useState(false)
  // modo obra: unidad de mampostería, esqueleto sin ladrillo y elemento tocado
  const [brick, setBrick] = useState<BrickId>('tolete')
  const [hideMasonry, setHideMasonry] = useState(false)
  const [elementId, setElementId] = useState<string | null>(null)
  const [stepCommand, setStepCommand] = useState<StepCommand | null>(null)
  // la obra a pantalla completa, reproduciéndose: la cámara gira despacio alrededor
  const [cinemaRotate, setCinemaRotate] = useState(false)
  const [sunOn, setSunOn] = useState(false)
  const [sunDate, setSunDate] = useState(today)
  const [sunHour, setSunHour] = useState(10)
  const [cutOn, setCutOn] = useState(false)
  const [cut, setCut] = useState(1.2)
  const [measuring, setMeasuring] = useState(false)
  const [points, setPoints] = useState<[number, number, number][]>([])
  const box = useRef<HTMLDivElement>(null)
  // la secuencia de obra anima la escena armada: se guarda también como estado
  const [built, setBuilt] = useState<BuiltScene | null>(null)
  const onScene = useCallback((s: BuiltScene) => {
    scene.current = s
    setBuilt(s)
  }, [])
  const onPoint = useCallback((p: [number, number, number]) => setPoints((prev) => (prev.length >= 2 ? [p] : [...prev, p])), [])

  // cada ambiente recuerda su nivel: al elegirlo, se aparece sobre su piso
  const rooms = useMemo(() => {
    const m = project?.model
    if (!m) return []
    const levelOf = new Map(m.levels.flatMap((l) => l.rooms.map((r) => [r.id, l.id] as const)))
    return tourWaypoints(m.levels.flatMap((l) => l.rooms)).map((r) => ({ ...r, levelId: levelOf.get(r.id) }))
  }, [project])
  // el recorrido empieza en el ambiente más grande (la sala, casi siempre), no en el primero por nombre
  const firstRoom = useMemo(() => {
    const all = project?.model?.levels.flatMap((l) => l.rooms) ?? []
    const big = all.reduce<(typeof all)[number] | undefined>((best, r) => (!best || roomArea(r) > roomArea(best) ? r : best), undefined)
    return rooms.find((r) => r.id === big?.id) ?? rooms[0]
  }, [project, rooms])
  // una casa de varios pisos se recorre desde la calle, frente al portón o la puerta de entrada
  const entry = useMemo(() => {
    const m = project?.model
    if (!m || m.levels.length < 2) return undefined
    const ground = [...m.levels].sort((a, b) => a.elevation - b.elevation)[0]!
    return streetEntry(ground) ?? undefined
  }, [project])

  // fachada: se ve al instante y se guarda en segundo plano; si falla vuelve a la anterior
  const [facade, setFacadeState] = useState<{ style: FacadeStyle; revision: number } | null>(null)
  const [facadeError, setFacadeError] = useState<string | null>(null)
  const facadeStyle = facade?.style ?? project?.model?.facade
  const viewModel = useMemo(() => (project?.model && facadeStyle ? { ...project.model, facade: facadeStyle } : project?.model), [project, facadeStyle])
  const cycleFacade = () => {
    if (!project) return
    const prev = facade
    const style = nextFacade(facadeStyle)
    const rev = revision ?? project.revision
    setFacadeError(null)
    setFacadeState({ style, revision: rev })
    api.setFacade(project.id, style, rev).then(
      (p) => {
        setFacadeState({ style, revision: p.revision })
        setRevision(p)
      },
      (e: unknown) => {
        setFacadeState(prev)
        setFacadeError(e instanceof Error ? e.message : 'No se pudo guardar la fachada')
      },
    )
  }

  // muebles: se ocultan sin reconstruir la escena; si el piso no tiene, se amobla según el plano
  const [showFurniture, setShowFurniture] = useState(true)
  const [furnishing, setFurnishing] = useState(false)
  const [furnishError, setFurnishError] = useState<string | null>(null)
  const furnitureCount = useMemo(
    () => (project?.model?.levels ?? []).filter((lv) => !focusLevel || lv.id === focusLevel).reduce((n, lv) => n + (lv.furniture?.length ?? 0), 0),
    [project, focusLevel],
  )
  const furnishNow = () => {
    if (!project) return
    setFurnishing(true)
    setFurnishError(null)
    api
      .furnish(project.id, focusLevel ?? undefined, revision)
      .then(
        (p) => {
          setSaved(p)
          setRevision(p)
          setShowFurniture(true)
        },
        (e: unknown) => setFurnishError(e instanceof Error ? e.message : 'No se pudo amoblar'),
      )
      .finally(() => setFurnishing(false))
  }

  const levels = useMemo(() => (project?.model ? levelSummaries(project.model) : []), [project])
  const focusSummary = levels.find((l) => l.id === focusLevel) ?? null
  useEffect(() => {
    if (!built || !project?.model) return
    applyLevelFocus(built.root, new Set(focusLevel ? levelsAbove(project.model, focusLevel) : []))
  }, [built, focusLevel, project])
  useEffect(() => {
    if (!built) return
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#2f6b55'
    highlightLevel(built.root, hoverLevel && hoverLevel !== focusLevel ? hoverLevel : null, accent)
  }, [built, hoverLevel, focusLevel])

  // puertas cerradas al entrar; en el celular se abren solas al acercarse
  useEffect(() => {
    useWalk.getState().reset()
    resetDoorProgress()
    useWalk.getState().setAutoDoors(touch)
  }, [id, touch])

  if (loading) return <div className="p-8"><Spinner label="Cargando modelo" /></div>
  if (error || !project?.model)
    return (
      <div className="p-8">
        <ErrorState title="El modelo no está disponible" message={error?.message ?? 'El proyecto aún no terminó de procesarse.'} action={<Link className="text-accent underline" to={`/p/${id}`}>Volver</Link>} />
      </div>
    )

  const model = viewModel ?? project.model

  const doExport = async () => {
    if (!scene.current) return
    setExporting(true)
    try {
      downloadBlob(await exportGlb(exportRoot(scene.current)), `${project.name.replace(/[^\w-]+/g, '_') || 'plano'}.glb`)
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
      downloadBlob(await exportObj(exportRoot(scene.current)), `${fileBase}.obj`)
    } finally {
      setExporting(false)
    }
  }

  const doPng = () => {
    const canvas = box.current?.querySelector('canvas')
    if (!canvas) return
    canvas.toBlob((blob) => blob && downloadBlob(blob, `${fileBase}.png`), 'image/png')
  }

  const goTo = (p: Point, levelId?: string) => {
    if (mode === 'walk') setWalkStart({ ...p, levelId })
    else setFlyTo({ ...p, elevation: levels.find((l) => l.id === levelId)?.elevation })
  }

  /** Recorrer un piso: aparece en su ambiente más grande, con la casa completa a la vista. */
  const walkLevel = (id: string) => {
    const lv = model.levels.find((l) => l.id === id)
    const big = lv?.rooms.reduce<(typeof lv.rooms)[number] | undefined>((b, r) => (!b || roomArea(r) > roomArea(b) ? r : b), undefined)
    const at = rooms.find((r) => r.id === big?.id)?.at
    setFocusLevel(null)
    setCutOn(false)
    if (at) setWalkStart({ ...at, levelId: id })
    setMode('walk')
  }

  /** Aísla un piso (o vuelve al edificio completo con null) y lo encuadra como maqueta. */
  const focusOn = (id: string | null) => {
    setFocusLevel(id)
    setMode('orbit')
    const summary = levels.find((l) => l.id === id)
    const cam = summary && levelCamera(summary)
    if (cam) setFlyTo({ x: cam.look[0], y: cam.look[2], look: cam.look, pos: cam.pos })
    else setPreset({ name: 'iso', nonce: Date.now() })
  }

  /** ids de la estructura derivada, para validar lo que pide el chat ("C-3") */
  const structureIds = () => {
    const s = deriveStructure(model, { brick })
    return [s.columns, s.footings, s.plinths, s.beams, s.lintels, s.panels].map((list) => list.map((e) => e.id))
  }
  /** los modos de obra tienen panel; si se pide algo de obra desde la presentación, se entra a Obra */
  const ensureObra = () => {
    if (!strategy.panel) choosePlanMode('obra')
    setTabState('obra')
    setPanelOpen(true)
  }

  /** Aplica una acción del chat de la vista y devuelve qué se hizo. */
  const runViewerAction = (act: ViewerAction): ViewerReply => {
    switch (act.a) {
      case 'plan_mode':
        choosePlanMode(act.id)
        setPanelOpen(true)
        return `Modo ${planMode(act.id).label}`
      case 'camera':
        setMode(act.mode)
        return act.mode === 'walk' ? 'Modo recorrer: haz clic en el modelo para caminar' : 'Modo orbitar'
      case 'preset':
        setTabState('vista')
        setMode('orbit')
        setPreset({ name: act.name, nonce: Date.now() })
        return `Vista ${PRESET_LABEL[act.name].toLowerCase()}`
      case 'display':
        setDisplay(act.mode)
        return `Visualización: ${DISPLAY_LABEL[act.mode].toLowerCase()}`
      case 'quality':
        setQuality(act.q)
        return `Calidad ${act.q}`
      case 'roof':
        setRoof(act.on)
        // la cubierta de teja se ve en la presentación
        if (act.on && strategy.panel) choosePlanMode('presentacion')
        return act.on ? 'Puse la cubierta de teja' : 'Quité la cubierta'
      case 'brick':
        setBrick(act.id)
        ensureObra()
        return `Mampostería en ${BRICKS[act.id].name}`
      case 'masonry':
        setHideMasonry(act.hidden)
        ensureObra()
        return act.hidden ? 'Oculté el ladrillo: se ve el esqueleto de concreto' : 'Mostré el ladrillo'
      case 'element': {
        const ids = structureIds()
        if (!ids.flat().includes(act.id)) {
          const prefix = act.id.split('-')[0]
          const same = ids.flat().filter((id) => id.split('-')[0] === prefix)
          throw new Error(same.length ? `No hay ${act.id}: van de ${same[0]} a ${same[same.length - 1]}` : `Este plano no tiene ${act.id}`)
        }
        ensureObra()
        setElementId(act.id)
        return `Seleccioné ${act.id}`
      }
      case 'step':
        if (strategy.id !== 'secuencia') choosePlanMode('secuencia')
        setTabState('obra')
        setPanelOpen(true)
        setStepCommand({ to: act.to, nonce: Date.now() })
        return act.to === 'play' ? 'Reproduzco la obra' : act.to === 'next' ? 'Siguiente paso' : act.to === 'prev' ? 'Paso anterior' : act.to === 'last' ? 'Último paso: la obra terminada' : `Paso ${act.to} de la secuencia`
      case 'cut':
        setTabState('analisis')
        setCutOn(act.on)
        if (act.at !== undefined) setCut(Math.min(3, Math.max(0.2, act.at)))
        return act.on ? `Corte horizontal a ${(act.at ?? cut).toFixed(2).replace('.', ',')} m` : 'Quité el corte'
      case 'sun':
        setTabState('analisis')
        setSunOn(act.on)
        if (act.hour !== undefined) setSunHour(act.hour)
        return act.on ? `Estudio solar${act.hour !== undefined ? ` a las ${Math.floor(act.hour)}:${String(Math.round((act.hour % 1) * 60)).padStart(2, '0')}` : ''}` : 'Apagué el estudio solar'
      case 'overlay':
        setOverlay(act.value)
        return act.value ? `Plano original al ${Math.round(act.value * 100)} %` : 'Oculté el plano original'
      case 'room': {
        const q = fold(act.room).replace(/^(?:la|el)\s+/, '')
        const r = rooms.find((x) => fold(x.label) === q) ?? rooms.find((x) => fold(x.label).startsWith(q) || q.includes(fold(x.label)))
        if (!r) throw new Error(`No encuentro el ambiente «${act.room}» (hay: ${rooms.map((x) => x.label).join(', ')})`)
        goTo(r.at, r.levelId)
        return `Fui a ${r.label}`
      }
      case 'ask':
        return quantityAnswer(model, brick, act.topic)
      case 'furniture':
        if (act.on && furnitureCount === 0) {
          furnishNow()
          return 'Amoblo según cada ambiente'
        }
        setShowFurniture(act.on)
        return act.on ? 'Puse los muebles' : 'Quité los muebles de la vista'
      case 'level': {
        if (act.n === 'all') {
          focusOn(null)
          return 'Edificio completo'
        }
        const l = levels[act.n - 1]
        if (!l) throw new Error(levels.length > 1 ? `Este plano tiene ${levels.length} pisos` : 'Este plano tiene un solo piso')
        focusOn(l.id)
        return `Piso ${l.number}: ${l.name}`
      }
    }
  }

  /** Estado de la vista para el asistente con IA (respaldo del chat). */
  const viewerContext = () => {
    const ids = structureIds()
    const range = (list: string[]) => (list.length ? `${list[0]}…${list[list.length - 1]}` : 'ninguno')
    return [
      `Modo del plano: ${strategy.id}. Cámara: ${mode === 'walk' ? 'recorrer' : 'orbitar'}. Calidad: ${quality}.`,
      `Unidad de mampostería: ${brick}. Ladrillo oculto: ${hideMasonry ? 'sí' : 'no'}. Cubierta: ${roof ? 'sí' : 'no'}. Muebles: ${showFurniture ? 'sí' : 'no'}. Corte: ${cutOn ? `${cut} m` : 'no'}.`,
      `Ambientes: ${rooms.map((r) => r.label).join(', ') || 'ninguno'}.`,
      `Columnetas ${range(ids[0]!)}; vigas de cimentación ${range(ids[1]!)}; vigas de amarre ${range(ids[3]!)}; dinteles ${range(ids[4]!)}; paños ${range(ids[5]!)}.`,
    ].join('\n')
  }

  return (
    <div ref={box} className="relative flex-1 bg-canvas">
      <Viewer3D
        model={model}
        mode={mode}
        overlayUrl={project.has_source === false ? undefined : api.imageUrl(project.id, 'rectified', project.updated_at)}
        overlayOpacity={overlay}
        flyTo={flyTo}
        walkStart={walkStart ?? entry ?? (firstRoom ? { ...firstRoom.at, levelId: firstRoom.levelId } : undefined)}
        walkInput={walkInput}
        touch={touch}
        onScene={onScene}
        className="absolute inset-0"
        label={`Modelo 3D de ${project.name}`}
        sun={sun}
        section={mode === 'walk' ? null : cutOn ? (focusSummary?.elevation ?? 0) + cut : focusSummary ? focusSummary.elevation + 1.2 : null}
        preset={preset}
        autoRotate={cinemaRotate && mode === 'orbit'}
        display={display}
        measure={measuring ? { points, onPoint } : null}
        strategy={strategy}
        quality={quality}
        roof={roof}
        facade={!strategy.panel}
        furniture={showFurniture}
        brick={brick}
        hideMasonry={hideMasonry}
        highlightElementId={strategy.panel ? elementId : null}
        onElement={strategy.panel && !measuring ? setElementId : undefined}
      />

      {mode === 'walk' && <WalkHud model={model} touch={touch} />}

      {/* pisos: a la izquierda, a media altura (en recorrido, el HUD ya tiene subir/bajar piso) */}
      {mode === 'orbit' && levels.length > 1 && (
        <div className="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2">
          <LevelRail levels={levels} focused={focusLevel} onFocus={focusOn} onHover={setHoverLevel} onWalk={walkLevel} />
        </div>
      )}

      {/* chat de ajustes: abajo al centro del área libre (a la izquierda del panel); arriba en el celular */}
      <ViewerChat
        projectId={project.id}
        run={runViewerAction}
        context={viewerContext}
        className="absolute top-16 left-3 z-20 sm:top-auto sm:bottom-4 sm:left-[calc((100%-21rem)/2)] sm:-translate-x-1/2 [body:has([data-cinema])_&]:hidden"
      />

      {/* barra superior: la única cabecera del visor (el AppShell se oculta aquí) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto flex items-center gap-2">
          <Link
            to={`/p/${project.id}`}
            aria-label="Volver al editor"
            className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-md border border-line bg-canvas/85 px-3 text-sm backdrop-blur hover:border-accent"
          >
            <ArrowLeft className="size-4" aria-hidden /> <span className="hidden sm:inline">Editor</span>
          </Link>
          <p className="hidden max-w-56 truncate text-sm font-medium lg:block">{project.name}</p>
        </div>
        <ToggleGroup.Root
          type="single"
          value={mode}
          onValueChange={(v) => v && setMode(v as ViewMode)}
          aria-label="Modo de cámara"
          className="pointer-events-auto flex rounded-md border border-line bg-canvas/85 p-1 backdrop-blur"
        >
          <ToggleGroup.Item value="orbit" className="inline-flex h-9 items-center gap-1.5 rounded-sm px-3 text-sm text-muted data-[state=on]:bg-fg data-[state=on]:text-canvas pointer-coarse:h-11">
            <Orbit className="size-4" aria-hidden /> Orbitar
          </ToggleGroup.Item>
          <ToggleGroup.Item value="walk" className="inline-flex h-9 items-center gap-1.5 rounded-sm px-3 text-sm text-muted data-[state=on]:bg-fg data-[state=on]:text-canvas pointer-coarse:h-11">
            <Footprints className="size-4" aria-hidden /> Recorrer
          </ToggleGroup.Item>
        </ToggleGroup.Root>
        <div className="pointer-events-auto flex gap-2">
          <div className="rounded-md bg-canvas/85 backdrop-blur [&>button]:h-11 [&>button]:w-11">
            <TutorialButton compact initial="recorrer" />
          </div>
          {!strategy.panel && (
            <Button
              className="h-11 bg-canvas/85 backdrop-blur"
              onClick={cycleFacade}
              aria-label={`Fachada: ${facadeSpec(facadeStyle).name}`}
              title="Cambia el estilo de la fachada (solo el exterior)"
              icon={<Paintbrush className="size-4" aria-hidden />}
            >
              <span className="hidden sm:inline">Fachada: {facadeSpec(facadeStyle).name}</span>
            </Button>
          )}
          {!strategy.panel &&
            (furnitureCount === 0 ? (
              <Button
                className="h-11 bg-canvas/85 backdrop-blur"
                loading={furnishing}
                onClick={furnishNow}
                aria-label="Amoblar según el plano"
                title="Pone los muebles de cada ambiente (alcoba, baño, cocina, sala)"
                icon={<Sofa className="size-4" aria-hidden />}
              >
                <span className="hidden sm:inline">Amoblar según el plano</span>
              </Button>
            ) : (
              <Button
                className="h-11 bg-canvas/85 backdrop-blur"
                onClick={() => setShowFurniture((v) => !v)}
                aria-pressed={showFurniture}
                aria-label={`Muebles: ${showFurniture ? 'sí' : 'no'}`}
                title={showFurniture ? 'Quita los muebles de la vista' : 'Pone los muebles del plano'}
                icon={<Sofa className="size-4" aria-hidden />}
              >
                <span className="hidden sm:inline">Muebles: {showFurniture ? 'sí' : 'no'}</span>
              </Button>
            ))}
          {furnishError && (
            <p role="alert" className="self-center rounded-sm bg-canvas/85 px-2 py-1 text-xs text-danger backdrop-blur">
              {furnishError}
            </p>
          )}
          {facadeError && (
            <p role="alert" className="self-center rounded-sm bg-canvas/85 px-2 py-1 text-xs text-danger backdrop-blur">
              {facadeError}
            </p>
          )}
          <Menu
            items={[
              { label: 'Guardar imagen PNG', icon: <Camera className="size-4" aria-hidden />, onSelect: doPng },
              { label: 'Descargar modelo OBJ', icon: <Download className="size-4" aria-hidden />, onSelect: () => void doObj() },
              { label: 'Descargar modelo GLB', icon: <Download className="size-4" aria-hidden />, onSelect: () => void doExport() },
            ]}
            trigger={
              <Button className="h-11 bg-canvas/85 backdrop-blur" loading={exporting} aria-label="Exportar" title="Imagen PNG o modelo 3D (OBJ, GLB)" icon={<Download className="size-4" aria-hidden />}>
                <span className="hidden sm:inline">Exportar</span>
              </Button>
            }
          />
        </div>
      </div>

      {/* panel: abajo a la izquierda en el celular (plegado); a la derecha, a toda altura, en pantallas medianas */}
      <aside
        aria-label="Panel del visor"
        className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-h-[calc(100%-5.5rem)] max-w-[calc(100%-9rem)] flex-col justify-end sm:top-[4.25rem] sm:right-3 sm:left-auto sm:max-h-none sm:w-80 sm:max-w-none sm:justify-start"
      >
        <div className="pointer-events-auto flex min-h-0 flex-col rounded-lg border border-line bg-canvas/90 shadow-lg backdrop-blur">
          <button
            type="button"
            aria-expanded={panelOpen}
            aria-controls="viewer-panel"
            onClick={() => setPanelOpen((o) => !o)}
            className="flex min-h-11 shrink-0 items-center justify-between gap-2 px-3 text-sm font-medium"
          >
            <span className="flex items-center gap-2">
              <Layers className="size-4 text-accent" aria-hidden />
              <span>
                Ambientes<span className="hidden sm:inline"> y vista</span>
              </span>
            </span>
            <ChevronUp className={`size-4 transition-transform ${panelOpen ? '' : 'rotate-180'}`} aria-hidden />
          </button>
          {panelOpen && (
            <div id="viewer-panel" className="flex min-h-0 flex-col border-t border-line">
              {PLAN_MODES.length > 1 && (
                <ToggleGroup.Root
                  type="single"
                  value={strategy.id}
                  onValueChange={(v) => v && choosePlanMode(v)}
                  aria-label="Modo del plano"
                  className="grid shrink-0 grid-cols-2 gap-1 border-b border-line p-2"
                >
                  {PLAN_MODES.map((m) => (
                    <ToggleGroup.Item key={m.id} value={m.id} title={m.hint} className="min-h-11 rounded-sm px-2 text-xs text-muted data-[state=on]:bg-accent data-[state=on]:text-accent-ink sm:min-h-8">
                      {m.label}
                    </ToggleGroup.Item>
                  ))}
                </ToggleGroup.Root>
              )}
              <Tabs.Root value={activeTab} onValueChange={setTab} className="flex min-h-0 flex-col">
                <Tabs.List aria-label="Secciones del visor" className="flex shrink-0 border-b border-line px-1">
                  {DOCK_TABS.filter((t) => t.id !== 'obra' || strategy.panel).map((t) => (
                    <Tabs.Trigger
                      key={t.id}
                      value={t.id}
                      className="h-9 flex-1 border-b-2 border-transparent px-1 text-xs text-muted data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-fg pointer-coarse:h-11"
                    >
                      {t.label}
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>
                <div className="max-h-[50vh] min-h-0 overflow-y-auto p-3 sm:max-h-[calc(100dvh-14rem)]">
                  <Tabs.Content value="ambientes" className="flex flex-col gap-2">
                    <nav aria-label="Ambientes" className="flex flex-col">
                      {rooms.map((r) => {
                        const room = model.levels.flatMap((l) => l.rooms).find((x) => x.id === r.id)
                        return (
                          <button key={r.id} type="button" onClick={() => goTo(r.at, r.levelId)} className="flex min-h-11 items-center justify-between gap-3 rounded-sm px-2 text-left text-sm hover:bg-raised sm:min-h-9">
                            <span>{r.label}</span>
                            <span className="font-mono text-xs text-subtle">{room ? roomArea(room).toFixed(1) : ''} m²</span>
                          </button>
                        )
                      })}
                    </nav>
                    <div className="border-t border-line pt-2">
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
                    </div>
                  </Tabs.Content>

                  <Tabs.Content value="vista">
                    <section aria-label="Vista" className="flex flex-col gap-2">
                      <div className="grid grid-cols-4 gap-1" role="group" aria-label="Encuadre">
                        {(Object.keys(PRESET_LABEL) as CameraPreset[]).map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => {
                              setMode('orbit')
                              setPreset({ name: p, nonce: Date.now() })
                            }}
                            className="min-h-11 rounded-sm border border-line px-1 text-xs hover:border-accent hover:bg-raised sm:min-h-8"
                          >
                            {PRESET_LABEL[p]}
                          </button>
                        ))}
                      </div>
                      <label className="flex items-center justify-between gap-2 text-xs">
                        <span>Calidad</span>
                        <select value={quality} onChange={(e) => setQuality(e.target.value as Quality)} className={SELECT} title="Alta: cielo, sombras suaves y oclusión ambiental. Baja: más fluida en equipos modestos.">
                          <option value="alta">Alta (realista)</option>
                          <option value="baja">Baja (fluida)</option>
                        </select>
                      </label>
                      {!strategy.panel && (
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span>Fachada</span>
                          <button type="button" onClick={cycleFacade} className="min-h-11 rounded-sm border border-line px-2 hover:border-accent hover:bg-raised sm:min-h-8">
                            {facadeSpec(facadeStyle).name} →
                          </button>
                        </div>
                      )}
                      {!strategy.panel && (
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <label className="flex items-center gap-2 pointer-coarse:min-h-11">
                            <input type="checkbox" checked={showFurniture} onChange={(e) => setShowFurniture(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
                            <span>Muebles</span>
                          </label>
                          <button
                            type="button"
                            onClick={furnishNow}
                            disabled={furnishing}
                            title="Agrega lo que falte en cada ambiente sin mover lo que ya está"
                            className="min-h-11 rounded-sm border border-line px-2 hover:border-accent hover:bg-raised disabled:opacity-50 sm:min-h-8"
                          >
                            Completar muebles
                          </button>
                        </div>
                      )}
                      {!strategy.panel && (
                        <label className="flex items-center justify-between gap-2 text-xs pointer-coarse:min-h-11">
                          <span>Cubierta (losa o techo)</span>
                          <input type="checkbox" checked={roof} onChange={(e) => setRoof(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
                        </label>
                      )}
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
                  </Tabs.Content>

                  {strategy.panel && (
                    <Tabs.Content value="obra">
                      <ObraPanel
                        variant={strategy.panel}
                        root={built?.root ?? null}
                        model={model}
                        brick={brick}
                        onBrick={setBrick}
                        hideMasonry={hideMasonry}
                        onHideMasonry={setHideMasonry}
                        elementId={elementId}
                        onElement={setElementId}
                        onClose={() => setElementId(null)}
                        fileBase={fileBase}
                        stepCommand={stepCommand}
                        onCinemaChange={setCinemaRotate}
                      />
                    </Tabs.Content>
                  )}

                  <Tabs.Content value="analisis" className="flex flex-col gap-3">
                    <section aria-label="Estudio solar" className="flex flex-col gap-2">
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
                            <span>Altura del corte{focusSummary ? ` sobre ${focusSummary.name}` : ''}</span>
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
                  </Tabs.Content>
                </div>
              </Tabs.Root>
            </div>
          )}
        </div>
      </aside>

      {/* abajo: joystick (celular, a la derecha) o ayuda de teclado (escritorio, a la izquierda: el panel va a la derecha) */}
      <div className="pointer-events-none absolute right-0 bottom-0 flex justify-end p-3 sm:right-auto sm:left-0 sm:justify-start">
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
              <Kbd>W A S D</Kbd> moverse · <Kbd>Shift</Kbd> correr · <Kbd>E</Kbd> abrir o usar · <Kbd>Q</Kbd>/<Kbd>Z</Kbd> piso · <Kbd>Esc</Kbd> soltar
            </div>
          ))}
      </div>
    </div>
  )
}
