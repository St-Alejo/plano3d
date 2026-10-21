/**
 * Capa "Estructura (obra)" del editor: la planta estructural del nivel activo, derivada del
 * plano igual que en el 3D (ADR-017). En el primer piso, la planta de cimentación punteada;
 * en todos, las columnetas numeradas y el rótulo de cada viga de amarre.
 */
import { useMemo } from 'react'
import { Group, Line, Rect, Text } from 'react-konva'
import type { BuildingModel, Point } from '@/api/types'
import { deriveStructure, type LinearElement } from '@/domain/structure/derive'

const COLOR = { footing: '#7d7a74', column: '#3b3f45', beam: '#8a5a2b', label: '#1c1f1d' }

export function StructureOverlay({ model, levelId, mpp, scale }: { model: BuildingModel; levelId: string; mpp: number; scale: number }) {
  const s = useMemo(() => deriveStructure(model), [model])
  const px = (p: Point) => ({ x: p.x / mpp, y: p.y / mpp })
  const font = 11 / scale
  const footings = s.footings.filter((f) => f.levelId === levelId)
  const beams = s.beams.filter((b) => b.levelId === levelId)
  const columns = s.columns.filter((c) => c.levelId === levelId)

  /** contorno de un elemento lineal de ancho `width` */
  const outline = (e: LinearElement) => {
    const a = px(e.start)
    const b = px(e.end)
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = (-(b.y - a.y) / len) * (e.width / mpp / 2)
    const ny = ((b.x - a.x) / len) * (e.width / mpp / 2)
    return [a.x + nx, a.y + ny, b.x + nx, b.y + ny, b.x - nx, b.y - ny, a.x - nx, a.y - ny]
  }
  const mid = (e: LinearElement) => px({ x: (e.start.x + e.end.x) / 2, y: (e.start.y + e.end.y) / 2 })

  return (
    <Group listening={false} name="estructura">
      {footings.map((f) => (
        <Line key={f.id} points={outline(f)} closed stroke={COLOR.footing} strokeWidth={1.2 / scale} dash={[6 / scale, 4 / scale]} />
      ))}
      {beams.map((b) => {
        const m = mid(b)
        return <Text key={b.id} x={m.x + 4 / scale} y={m.y + 4 / scale} text={b.id} fontSize={font} fontFamily="Geist Mono" fill={COLOR.beam} />
      })}
      {columns.map((c) => {
        const at = px(c.center)
        const w = c.along / mpp
        const h = c.across / mpp
        return (
          <Group key={c.id} x={at.x} y={at.y}>
            <Rect width={w} height={h} offsetX={w / 2} offsetY={h / 2} rotation={(c.angle * 180) / Math.PI} fill={COLOR.column} />
            <Text x={w / 2 + 2 / scale} y={-h / 2 - font} text={c.id} fontSize={font} fontFamily="Geist Mono" fill={COLOR.label} />
          </Group>
        )
      })}
    </Group>
  )
}
