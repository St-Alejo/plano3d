/**
 * Editor 2D de corrección, superpuesto a la imagen rectificada del plano.
 * Trabaja en píxeles de imagen (px = metros / m_por_px) para que los trazos
 * caigan exactamente sobre el dibujo original.
 */
import type Konva from 'konva'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Circle, Group, Image as KImage, Label, Layer, Line, Stage, Tag, Text } from 'react-konva'
import type { Point, Wall } from '@/api/types'
import { AddOpening, AddWall, MoveWallEndpoint } from '@/domain/commands'
import { polygonCentroid, roomArea, wallDirection, wallLength } from '@/domain/model'
import { nearestWall, snapPoint, wallEndpoints } from '@/domain/snap'
import { selectLevel, useEditor } from '@/store/editorStore'
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
  const dispatch = useEditor((s) => s.dispatch)

  const mpp = model?.scale.meters_per_pixel ?? 0.01
  const imgW = model?.source_image?.width_px ?? image?.width ?? 1000
  const imgH = model?.source_image?.height_px ?? image?.height ?? 800

  // vista: escala y desplazamiento (zoom con rueda / pellizco, arrastre para desplazar)
  const [userView, setView] = useState<{ scale: number; x: number; y: number } | null>(null)
  const autoView = useMemo(() => {
    const s = Math.min(size.width / imgW, size.height / imgH) * 0.95
    return { scale: s, x: (size.width - imgW * s) / 2, y: (size.height - imgH * s) / 2 }
  }, [size.width, size.height, imgW, imgH])
  const view = userView ?? autoView
  const fit = useCallback(() => setView(null), [])

  const toPx = (p: Point) => ({ x: p.x / mpp, y: p.y / mpp })
  const toM = (p: Point) => ({ x: p.x * mpp, y: p.y * mpp })
  const screenTol = 12 / view.scale // px de imagen equivalentes a 12 px de pantalla

  const [draft, setDraft] = useState<{ a: Point; b: Point } | null>(null)

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
      const a = tool === 'wall' ? snapPoint(p, { candidates, tol: screenTol }) : p
      setDraft({ a, b: a })
    } else if (tool === 'door' || tool === 'window') {
      const hit = nearestWall(level, toM(p), screenTol * mpp)
      if (hit) {
        const cmd = new AddOpening(level.id, hit.wall.id, tool, hit.offset, wallLength(hit.wall))
        if (dispatch(cmd)) select({ kind: 'opening', id: cmd.opening.id, wallId: hit.wall.id })
      }
    } else if (e.target === stage) {
      select(null)
    }
  }

  const onMove = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if ('touches' in e.evt && touchPinch(e as Konva.KonvaEventObject<TouchEvent>)) return
    if (!draft) return
    const stage = e.target.getStage()
    const p = stage && pointerPx(stage)
    if (!p) return
    const b = tool === 'wall' ? snapPoint(p, { anchor: draft.a, candidates, tol: screenTol }) : p
    setDraft({ ...draft, b })
  }

  const onUp = () => {
    pinch.current = null
    if (!draft || !level) return
    const { a, b } = draft
    setDraft(null)
    const lenPx = Math.hypot(b.x - a.x, b.y - a.y)
    if (lenPx < 4 / view.scale) return
    if (tool === 'wall') {
      const template = level.walls[0]
      try {
        const cmd = new AddWall(level.id, toM(a), toM(b), { thickness: template?.thickness, height: template?.height })
        if (dispatch(cmd)) select({ kind: 'wall', id: cmd.wall.id })
      } catch {
        /* muro demasiado corto: se ignora */
      }
    } else if (tool === 'calibrate') {
      onCalibrate(toM(a), toM(b))
    }
  }

  const selectedWall: Wall | undefined =
    selection?.kind === 'wall' ? level?.walls.find((w) => w.id === selection.id) : undefined

  const dragEndpoint = (w: Wall, end: 'start' | 'end') => (e: Konva.KonvaEventObject<DragEvent>) => {
    if (!level) return
    const anchor = toPx(end === 'start' ? w.end : w.start)
    const own = candidates.filter((c) => !(Math.abs(c.x - anchor.x) < 1e-6 && Math.abs(c.y - anchor.y) < 1e-6))
    const p = snapPoint({ x: e.target.x(), y: e.target.y() }, { anchor, candidates: own, tol: screenTol })
    e.target.position(p)
    dispatch(new MoveWallEndpoint(level.id, w.id, end, toM(p)))
  }

  const cursor = tool === 'select' ? 'default' : 'crosshair'
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
      >
        <Layer listening={false}>{image && <KImage image={image} width={imgW} height={imgH} opacity={0.55} />}</Layer>

        <Layer>
          {level?.rooms.map((r) => {
            const pts = r.polygon.flatMap((p) => [p.x / mpp, p.y / mpp])
            const c = toPx(polygonCentroid(r.polygon))
            const sel = selection?.kind === 'room' && selection.id === r.id
            const low = r.confidence < LOW_CONFIDENCE
            return (
              <Group key={r.id} onClick={() => tool === 'select' && select({ kind: 'room', id: r.id })} onTap={() => tool === 'select' && select({ kind: 'room', id: r.id })}>
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

          {level?.walls.map((w) => {
            const a = toPx(w.start)
            const b = toPx(w.end)
            const sel = selectedWall?.id === w.id
            const d = wallDirection(w)
            return (
              <Group key={w.id}>
                <Line
                  points={[a.x, a.y, b.x, b.y]}
                  stroke={sel ? C.wallSel : C.wall}
                  strokeWidth={w.thickness / mpp}
                  lineCap="square"
                  hitStrokeWidth={Math.max(w.thickness / mpp, 14 / view.scale)}
                  onClick={() => tool === 'select' && select({ kind: 'wall', id: w.id })}
                  onTap={() => tool === 'select' && select({ kind: 'wall', id: w.id })}
                />
                {w.openings.map((o) => {
                  const s = { x: w.start.x + d.x * o.offset, y: w.start.y + d.y * o.offset }
                  const e = { x: s.x + d.x * o.width, y: s.y + d.y * o.width }
                  const sp = toPx(s)
                  const ep = toPx(e)
                  const osel = selection?.kind === 'opening' && selection.id === o.id
                  return (
                    <Line
                      key={o.id}
                      points={[sp.x, sp.y, ep.x, ep.y]}
                      stroke={osel ? C.wallSel : o.kind === 'door' ? C.door : C.window}
                      strokeWidth={(w.thickness / mpp) * 1.25}
                      hitStrokeWidth={Math.max(w.thickness / mpp, 14 / view.scale)}
                      onClick={() => tool === 'select' && select({ kind: 'opening', id: o.id, wallId: w.id })}
                      onTap={() => tool === 'select' && select({ kind: 'opening', id: o.id, wallId: w.id })}
                    />
                  )
                })}
              </Group>
            )
          })}

          {selectedWall &&
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
                  onDragMove={(e) => {
                    const anchor = toPx(end === 'start' ? selectedWall.end : selectedWall.start)
                    e.target.position(snapPoint({ x: e.target.x(), y: e.target.y() }, { anchor, candidates, tol: screenTol }))
                  }}
                  onDragEnd={dragEndpoint(selectedWall, end)}
                />
              )
            })}

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
