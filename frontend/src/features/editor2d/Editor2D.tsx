/**
 * Editor 2D de corrección, superpuesto a la imagen rectificada del plano.
 * Trabaja en píxeles de imagen (px = metros / m_por_px) para que los trazos
 * caigan exactamente sobre el dibujo original.
 */
import type Konva from 'konva'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Circle, Group, Image as KImage, Label, Layer, Line, Stage, Tag, Text } from 'react-konva'
import type { Point, Wall } from '@/api/types'
import { AddOpening, AddWall, MoveJoint, MoveWallEndpoint, SetWallLength } from '@/domain/commands'
import { wallAxis } from '@/domain/geometry'
import { polygonArea, polygonCentroid, roomArea, wallDirection, wallLength } from '@/domain/model'
import { nearestWall, snapPoint, wallEndpoints } from '@/domain/snap'
import { selectLevel, useEditor, type Selected } from '@/store/editorStore'
import { PlanElements } from './PlanElements'
import { contentBounds, parseLength, wallsInBox } from './selectionMath'
import { pinchOf, pinchStep, zoomAt, type Pinch } from './viewMath'

const LOW_CONFIDENCE = 0.6
const C = {
  wall: '#11294d',
  wallSel: '#5fd4e8',
  door: '#e8a23d',
  window: '#3a8fa3',
  roomOk: 'rgba(95,212,232,0.10)',
  roomLow: 'rgba(232,162,61,0.20)',
  roomSel: 'rgba(95,212,232,0.28)',
  text: '#122036',
  draft: '#e8a23d',
}

function useImage(url: string | undefined): HTMLImageElement | undefined {
  const [img, setImg] = useState<HTMLImageElement>()
  useEffect(() => {
    if (!url) return
    const el = new window.Image()
    el.onload = () => setImg(el)
    el.src = url
    return () => {
      el.onload = null
    }
  }, [url])
  return img
}

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 300, height: 300 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

export function Editor2D({ imageUrl, onCalibrate }: { imageUrl?: string; onCalibrate: (a: Point, b: Point) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const size = useSize(container)
  const image = useImage(imageUrl)
  const model = useEditor((s) => s.model)
  const level = useEditor(selectLevel)
  const tool = useEditor((s) => s.tool)
  const selection = useEditor((s) => s.selection)
  const select = useEditor((s) => s.select)
  const toggleSelect = useEditor((s) => s.toggleSelect)
  const selectMany = useEditor((s) => s.selectMany)
  const group = useEditor((s) => s.group)
  const hidden = useEditor((s) => s.hiddenLayers)
  const locked = useEditor((s) => s.lockedLayers)
  const setPointer = useEditor((s) => s.setPointer)
  const dispatch = useEditor((s) => s.dispatch)
  const gridStep = useEditor((s) => s.gridStep)
  const showDimensions = useEditor((s) => s.showDimensions)

  const mpp = model?.scale.meters_per_pixel ?? 0.01
  const imgW = model?.source_image?.width_px ?? image?.width ?? 1000
  const imgH = model?.source_image?.height_px ?? image?.height ?? 800

  // vista: escala y desplazamiento (zoom con rueda / pellizco, arrastre para desplazar)
  const [userView, setView] = useState<{ scale: number; x: number; y: number } | null>(null)
  // encuadre: los muros del plano (no la hoja entera, que deja márgenes vacíos); sin muros, la imagen.
  // Se calcula al cargar el proyecto o al cambiar el tamaño, no en cada edición.
  const projectId = model?.project_id
  const [bounds, setBounds] = useState(() => contentBounds(model))
  const [boundsFor, setBoundsFor] = useState(projectId)
  if (boundsFor !== projectId) {
    setBoundsFor(projectId)
    setBounds(contentBounds(model))
  }
  const autoView = useMemo(() => {
    const box = bounds
      ? { x: bounds.minX / mpp, y: bounds.minY / mpp, w: (bounds.maxX - bounds.minX) / mpp, h: (bounds.maxY - bounds.minY) / mpp }
      : { x: 0, y: 0, w: imgW, h: imgH }
    const s = Math.min(size.width / Math.max(box.w, 1), size.height / Math.max(box.h, 1)) * (bounds ? 0.86 : 0.95)
    return { scale: s, x: (size.width - box.w * s) / 2 - box.x * s, y: (size.height - box.h * s) / 2 - box.y * s }
  }, [size.width, size.height, imgW, imgH, mpp, bounds])
  const view = userView ?? autoView
  const fit = useCallback(() => setView(null), [])
  useEffect(() => setPointer(null, view.scale / autoView.scale), [view.scale, autoView.scale, setPointer])

  const toPx = (p: Point) => ({ x: p.x / mpp, y: p.y / mpp })
  const toM = (p: Point) => ({ x: p.x * mpp, y: p.y * mpp })
  const screenTol = 12 / view.scale // px de imagen equivalentes a 12 px de pantalla

  const [draft, setDraft] = useState<{ a: Point; b: Point } | null>(null)
  // selección por caja (Shift + arrastrar sobre el fondo)
  const [box, setBox] = useState<{ a: Point; b: Point } | null>(null)
  // largo tecleado para el último muro dibujado (estilo SketchUp: "3,5" + Enter)
  const [typed, setTyped] = useState<{ wallId: string; text: string } | null>(null)
  const [measure, setMeasure] = useState<Point[]>([])
  const grid = gridStep > 0 ? gridStep / mpp : 0 // paso de rejilla en px de imagen
  // al cambiar de herramienta se descarta la medición en curso
  const [measureTool, setMeasureTool] = useState(tool)
  if (measureTool !== tool) {
    setMeasureTool(tool)
    setMeasure([])
  }
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMeasure([])
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])
  if (typed && tool !== 'wall') setTyped(null)
  useEffect(() => {
    if (!typed) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const k = e.key.toLowerCase()
      const unit = (k === 'c' || k === 'm') && typed.text !== ''
      if (/^[0-9.,]$/.test(e.key) || unit) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setTyped({ ...typed, text: typed.text + e.key })
      } else if (e.key === 'Backspace' && typed.text) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setTyped({ ...typed, text: typed.text.slice(0, -1) })
      } else if (e.key === 'Enter') {
        const v = parseLength(typed.text)
        try {
          if (v !== null) dispatch(new SetWallLength(useEditor.getState().levelId, typed.wallId, v))
        } catch {
          /* largo inválido: se ignora */
        }
        setTyped(null)
      } else if (e.key === 'Escape') setTyped(null)
    }
    // en captura: el largo tecleado tiene prioridad sobre los atajos de una letra
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [typed, dispatch])

  const pointerPx = (stage: Konva.Stage): Point | null => {
    const p = stage.getRelativePointerPosition()
    return p ? { x: p.x, y: p.y } : null
  }

  const candidates = useMemo(() => (level ? wallEndpoints(level.walls).map((p) => ({ x: p.x / mpp, y: p.y / mpp })) : []), [level, mpp])

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = e.target.getStage()
    const pointer = stage?.getPointerPosition()
    if (!pointer) return
    setView(zoomAt(view, pointer, e.evt.deltaY > 0 ? 1 / 1.12 : 1.12))
  }

  // pellizco con dos dedos: zoom + desplazamiento; mientras dura, no se dibuja ni se arrastra
  const pinch = useRef<Pinch | null>(null)
  const touchPinch = (e: Konva.KonvaEventObject<TouchEvent>): boolean => {
    const t = e.evt.touches
    const stage = e.target.getStage()
    if (t.length !== 2 || !stage) {
      pinch.current = null
      return false
    }
    e.evt.preventDefault()
    const rect = stage.container().getBoundingClientRect()
    const pt = (i: number) => ({ x: t[i]!.clientX - rect.left, y: t[i]!.clientY - rect.top })
    const next = pinchOf(pt(0), pt(1))
    if (pinch.current) setView(pinchStep(view, pinch.current, next))
    pinch.current = next
    stage.stopDrag()
    setDraft(null)
    return true
  }

  const onDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if ('touches' in e.evt && e.evt.touches.length > 1) {
      touchPinch(e as Konva.KonvaEventObject<TouchEvent>)
      return
    }
    const stage = e.target.getStage()
    if (!stage || !level) return
    const p = pointerPx(stage)
    if (!p) return
    if (tool === 'wall' || tool === 'calibrate') {
      const a = tool === 'wall' ? snapPoint(p, { candidates, tol: screenTol, grid }) : p
      setDraft({ a, b: a })
    } else if (tool === 'measure') {
      // actualización funcional: dos clics muy seguidos no pierden un punto
      setMeasure((prev) => [...prev, snapPoint(p, { anchor: prev.at(-1), candidates, tol: screenTol, grid })])
    } else if (tool === 'door' || tool === 'window') {
      const hit = nearestWall(level, toM(p), screenTol * mpp)
      if (hit) {
        const cmd = new AddOpening(level.id, hit.wall.id, tool, hit.offset, wallLength(hit.wall))
        if (dispatch(cmd)) select({ kind: 'opening', id: cmd.opening.id, wallId: hit.wall.id })
      }
    } else if (e.target === stage) {
      if (tool === 'select' && 'shiftKey' in e.evt && e.evt.shiftKey) {
        stage.stopDrag()
        setBox({ a: p, b: p })
      } else select(null)
    }
  }

  const onMove = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if ('touches' in e.evt && touchPinch(e as Konva.KonvaEventObject<TouchEvent>)) return
    const stage = e.target.getStage()
    const p = stage && pointerPx(stage)
    if (!p) return
    setPointer(toM(p))
    if (box) {
      setBox({ ...box, b: p })
      return
    }
    if (!draft) return
    const b = tool === 'wall' ? snapPoint(p, { anchor: draft.a, candidates, tol: screenTol, grid }) : p
    setDraft({ ...draft, b })
  }

  const onUp = () => {
    pinch.current = null
    if (box && level) {
      const inBox = wallsInBox(level.walls, toM(box.a), toM(box.b)).map((w): Selected => ({ kind: 'wall', id: w.id }))
      const keep = group.filter((g) => !inBox.some((x) => x.id === g.id))
      selectMany([...keep, ...inBox])
      setBox(null)
      return
    }
    if (!draft || !level) return
    const { a, b } = draft
    setDraft(null)
    const lenPx = Math.hypot(b.x - a.x, b.y - a.y)
    if (lenPx < 4 / view.scale) return
    if (tool === 'wall') {
      const template = level.walls[0]
      try {
        const cmd = new AddWall(level.id, toM(a), toM(b), { thickness: template?.thickness, height: template?.height })
        if (dispatch(cmd)) {
          select({ kind: 'wall', id: cmd.wall.id })
          setTyped({ wallId: cmd.wall.id, text: '' })
        }
      } catch {
        /* muro demasiado corto: se ignora */
      }
    } else if (tool === 'calibrate') {
      onCalibrate(toM(a), toM(b))
    }
  }

  /** Clic: selecciona; con Shift agrega o quita del grupo. Las capas bloqueadas no responden. */
  const pick = (sel: Selected) => (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (tool !== 'select') return
    e.cancelBubble = true
    if ('shiftKey' in e.evt && e.evt.shiftKey) toggleSelect(sel)
    else select(sel)
  }
  const inGroup = (kind: Selected['kind'], id: string) => group.some((g) => g.kind === kind && g.id === id)
  /** Clic derecho sobre algo no seleccionado: se selecciona antes de abrir el menú contextual. */
  const pickForMenu = (sel: Selected) => () => {
    if (tool === 'select' && !inGroup(sel.kind, sel.id)) select(sel)
  }
  const lockedWalls = locked.has('walls')

  const selectedWall: Wall | undefined =
    selection?.kind === 'wall' ? level?.walls.find((w) => w.id === selection.id) : undefined

  /** Imanes para un extremo en arrastre: se excluye la propia esquina (si no, se pegaría a sí misma). */
  const dragSnap = (w: Wall, end: 'start' | 'end', p: Point) => {
    const own = toPx(w[end])
    const anchor = toPx(end === 'start' ? w.end : w.start)
    const others = candidates.filter((c) => Math.hypot(c.x - own.x, c.y - own.y) > 1e-6)
    return snapPoint(p, { anchor, candidates: others, tol: screenTol, grid })
  }

  // arrastrar un extremo mueve la ESQUINA (todos los muros que llegan ahí); con Alt se despega solo este muro
  const dragEndpoint = (w: Wall, end: 'start' | 'end') => (e: Konva.KonvaEventObject<DragEvent>) => {
    if (!level) return
    const p = dragSnap(w, end, { x: e.target.x(), y: e.target.y() })
    e.target.position(p)
    const to = toM(p)
    const ok = e.evt.altKey ? dispatch(new MoveWallEndpoint(level.id, w.id, end, to)) : dispatch(new MoveJoint(level.id, w[end], to))
    if (!ok) e.target.position(toPx(w[end])) // edición rechazada: el tirador vuelve a su lugar
  }

  const cursor = tool === 'select' ? 'default' : 'crosshair'
  const measureM = measure.map(toM)
  const measureLen = measureM.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - measureM[i]!.x, p.y - measureM[i]!.y), 0)
  const measureArea = measureM.length >= 3 ? polygonArea(measureM) : 0
  const fontPx = 13 / view.scale

  return (
    <div ref={container} className="relative size-full overflow-hidden bg-paper" style={{ cursor }} data-testid="editor2d">
      <Stage
        width={size.width}
        height={size.height}
        scaleX={view.scale}
        scaleY={view.scale}
        x={view.x}
        y={view.y}
        draggable={tool === 'select'}
        onDragEnd={(e) => {
          if (e.target === e.target.getStage()) setView({ ...view, x: e.target.x(), y: e.target.y() })
        }}
        onWheel={onWheel}
        onMouseDown={onDown}
        onTouchStart={onDown}
        onMouseMove={onMove}
        onTouchMove={onMove}
        onMouseUp={onUp}
        onTouchEnd={onUp}
        onMouseLeave={() => setPointer(null)}
      >
        <Layer listening={false}>{image && !hidden.has('image') && <KImage image={image} width={imgW} height={imgH} opacity={0.55} />}</Layer>

        <Layer>
          {!hidden.has('rooms') && level?.rooms.map((r) => {
            const pts = r.polygon.flatMap((p) => [p.x / mpp, p.y / mpp])
            const c = toPx(polygonCentroid(r.polygon))
            const sel = inGroup('room', r.id)
            const low = r.confidence < LOW_CONFIDENCE
            return (
              <Group key={r.id} listening={!locked.has('rooms')} onClick={pick({ kind: 'room', id: r.id })} onTap={pick({ kind: 'room', id: r.id })}>
                <Line points={pts} closed fill={sel ? C.roomSel : low ? C.roomLow : C.roomOk} stroke={low ? C.door : undefined} strokeWidth={low ? 1.5 / view.scale : 0} dash={[6 / view.scale, 4 / view.scale]} />
                <Label x={c.x} y={c.y} offsetX={fontPx * 3.2} offsetY={fontPx * 1.4} listening={false}>
                  <Tag fill="rgba(238,240,230,0.92)" stroke={low ? C.door : 'rgba(18,32,54,0.25)'} strokeWidth={1 / view.scale} cornerRadius={3 / view.scale} />
                  <Text
                    text={`${r.label}\n${roomArea(r).toFixed(1)} m²`}
                    fontSize={fontPx}
                    fontFamily="IBM Plex Sans"
                    fill={C.text}
                    align="center"
                    padding={4 / view.scale}
                    width={fontPx * 6.4}
                  />
                </Label>
              </Group>
            )
          })}

          {!hidden.has('walls') && level?.walls.map((w) => {
            const a = toPx(w.start)
            const b = toPx(w.end)
            const sel = inGroup('wall', w.id)
            const d = wallDirection(w)
            return (
              <Group key={w.id}>
                <Line
                  points={w.bulge ? wallAxis(w).flatMap((p) => [p.x / mpp, p.y / mpp]) : [a.x, a.y, b.x, b.y]}
                  stroke={sel ? C.wallSel : C.wall}
                  strokeWidth={w.thickness / mpp}
                  lineCap={w.bulge ? 'butt' : 'square'}
                  lineJoin="round"
                  hitStrokeWidth={Math.max(w.thickness / mpp, 14 / view.scale)}
                  listening={!lockedWalls}
                  onClick={pick({ kind: 'wall', id: w.id })}
                  onTap={pick({ kind: 'wall', id: w.id })}
                  onContextMenu={pickForMenu({ kind: 'wall', id: w.id })}
                />
                {showDimensions && (() => {
                  // cota: largo del muro sobre su línea, desplazada hacia afuera y legible (nunca cabeza abajo)
                  const len = wallLength(w)
                  if (len * (1 / mpp) * view.scale < 40) return null // muy corto en pantalla: se omite
                  let ang = (Math.atan2(d.y, d.x) * 180) / Math.PI
                  if (ang > 90 || ang <= -90) ang += 180
                  const off = w.thickness / mpp / 2 + 10 / view.scale
                  const mid = { x: (a.x + b.x) / 2 - d.y * off, y: (a.y + b.y) / 2 + d.x * off }
                  const txt = `${len.toFixed(2)}`
                  return (
                    <Text
                      x={mid.x}
                      y={mid.y}
                      text={txt}
                      rotation={ang}
                      fontSize={11 / view.scale}
                      fontFamily="IBM Plex Mono"
                      fill="#2a6674"
                      offsetX={(txt.length * 11 * 0.6) / view.scale / 2}
                      offsetY={11 / view.scale / 2}
                      listening={false}
                    />
                  )
                })()}
                {!hidden.has('openings') && w.openings.map((o) => {
                  const s = { x: w.start.x + d.x * o.offset, y: w.start.y + d.y * o.offset }
                  const e = { x: s.x + d.x * o.width, y: s.y + d.y * o.width }
                  const sp = toPx(s)
                  const ep = toPx(e)
                  const osel = inGroup('opening', o.id)
                  return (
                    <Line
                      key={o.id}
                      points={[sp.x, sp.y, ep.x, ep.y]}
                      stroke={osel ? C.wallSel : o.kind === 'door' ? C.door : C.window}
                      strokeWidth={(w.thickness / mpp) * 1.25}
                      hitStrokeWidth={Math.max(w.thickness / mpp, 14 / view.scale)}
                      listening={!locked.has('openings')}
                      onClick={pick({ kind: 'opening', id: o.id, wallId: w.id })}
                      onTap={pick({ kind: 'opening', id: o.id, wallId: w.id })}
                      onContextMenu={pickForMenu({ kind: 'opening', id: o.id, wallId: w.id })}
                    />
                  )
                })}
              </Group>
            )
          })}

          {level && showDimensions && !hidden.has('dimensions') && (
            <PlanElements
              level={level}
              mpp={mpp}
              scale={view.scale}
              selection={selection}
              onSelect={select}
              interactive={tool === 'select' && !locked.has('dimensions')}
            />
          )}

          {selectedWall &&
            group.length === 1 &&
            !lockedWalls &&
            (['start', 'end'] as const).map((end) => {
              const p = toPx(selectedWall[end])
              return (
                <Circle
                  key={`${selectedWall.id}-${end}`}
                  x={p.x}
                  y={p.y}
                  radius={8 / view.scale}
                  fill="#070f22"
                  stroke={C.wallSel}
                  strokeWidth={2.5 / view.scale}
                  draggable
                  onDragMove={(e) => e.target.position(dragSnap(selectedWall, end, { x: e.target.x(), y: e.target.y() }))}
                  onDragEnd={dragEndpoint(selectedWall, end)}
                />
              )
            })}

          {measure.length > 0 && (
            <Group listening={false}>
              <Line
                points={measure.flatMap((p) => [p.x, p.y])}
                closed={measure.length >= 3}
                stroke="#b3261e"
                strokeWidth={2 / view.scale}
                dash={[6 / view.scale, 4 / view.scale]}
                fill={measure.length >= 3 ? 'rgba(179,38,30,0.08)' : undefined}
              />
              {measure.map((p, i) => (
                <Circle key={i} x={p.x} y={p.y} radius={4 / view.scale} fill="#b3261e" />
              ))}
            </Group>
          )}
          {box && (
            <Line
              points={[box.a.x, box.a.y, box.b.x, box.a.y, box.b.x, box.b.y, box.a.x, box.b.y]}
              closed
              stroke={C.wallSel}
              strokeWidth={1.5 / view.scale}
              // continua = ventana (solo lo que queda dentro); punteada = cruce (también lo que toca)
              dash={box.b.x < box.a.x ? [6 / view.scale, 4 / view.scale] : undefined}
              fill="rgba(95,212,232,0.08)"
              listening={false}
            />
          )}
          {draft && (
            <Line
              points={[draft.a.x, draft.a.y, draft.b.x, draft.b.y]}
              stroke={C.draft}
              strokeWidth={tool === 'wall' ? (level?.walls[0]?.thickness ?? 0.15) / mpp : 2 / view.scale}
              dash={tool === 'calibrate' ? [8 / view.scale, 5 / view.scale] : undefined}
              lineCap="square"
              listening={false}
            />
          )}
        </Layer>
      </Stage>
      {typed && (
        <div role="status" aria-live="polite" className="absolute top-2 left-1/2 -translate-x-1/2 rounded-md border border-ink/20 bg-paper/95 px-3 py-2 font-mono text-xs text-ink shadow-sm">
          {typed.text ? (
            <>
              Largo: <strong>{typed.text}</strong> m · Enter para aplicar
            </>
          ) : (
            'Escribe el largo exacto del muro (p. ej. 3,5) y pulsa Enter'
          )}
        </div>
      )}
      {tool === 'measure' && (
        <div role="status" aria-live="polite" className="absolute top-2 left-2 rounded-md border border-ink/20 bg-paper/95 px-3 py-2 font-mono text-xs text-ink shadow-sm">
          {measure.length === 0 ? (
            'Haz clic en el primer punto…'
          ) : measure.length === 1 ? (
            'Primer punto marcado: haz clic en el siguiente…'
          ) : (
            <>
              <div>Distancia: {measureLen.toFixed(2)} m</div>
              {measureArea > 0 && <div>Área: {measureArea.toFixed(2)} m²</div>}
              <button type="button" className="mt-1 underline" onClick={() => setMeasure([])}>
                Borrar medición
              </button>
            </>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={fit}
        className="absolute right-2 bottom-2 rounded-md border border-ink/20 bg-paper/90 px-2 py-1 font-mono text-xs text-ink hover:border-ink/50 pointer-coarse:min-h-11 pointer-coarse:px-3"
      >
        Encuadrar
      </button>
    </div>
  )
}
