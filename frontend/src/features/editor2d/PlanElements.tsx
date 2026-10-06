/**
 * Elementos del modelo v2 sobre el plano (ADR-012): columnas, escaleras y COTAS.
 *
 * Las cotas se dibujan como en el plano (línea, marcas a 45° y valor) con el color de
 * su estado: exacta (verde), inferida (gris) o en conflicto (rojo). Un clic la
 * selecciona para corregir su valor en el panel.
 */
import { Circle, Group, Line, Rect, Text } from 'react-konva'
import type { Dimension, Level, MeasureStatus, Point } from '@/api/types'
import { stairSteps } from '@/domain/geometry'
import type { Selection } from '@/store/editorStore'

export const DIM_COLORS: Record<MeasureStatus, string> = {
  exact: '#2e7d4f',
  inferred: '#6b7280',
  conflict: '#c0392b',
}

interface Props {
  level: Level
  mpp: number
  scale: number // zoom de la vista (px de pantalla por px de imagen)
  selection: Selection
  onSelect: (sel: Selection) => void
  interactive: boolean
}

/** Extremos de la línea de cota: proyectados según su eje y desplazados por `offset`. */
export function dimensionLine(d: Dimension): { a: Point; b: Point } {
  let a = d.a
  let b = d.b
  if (d.axis === 'horizontal') b = { x: d.b.x, y: d.a.y }
  if (d.axis === 'vertical') b = { x: d.a.x, y: d.b.y }
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const nx = -(b.y - a.y) / len
  const ny = (b.x - a.x) / len
  const off = d.offset ?? 0
  a = { x: a.x + nx * off, y: a.y + ny * off }
  b = { x: b.x + nx * off, y: b.y + ny * off }
  return { a, b }
}

export function PlanElements({ level, mpp, scale, selection, onSelect, interactive }: Props) {
  const px = (p: Point) => ({ x: p.x / mpp, y: p.y / mpp })
  const font = 11 / scale
  return (
    <Group>
      {(level.columns ?? []).map((c) => {
        const p = px(c.center)
        return c.round ? (
          <Circle key={c.id} x={p.x} y={p.y} radius={c.width / mpp / 2} fill="#3b3b3b" listening={false} />
        ) : (
          <Rect
            key={c.id}
            x={p.x}
            y={p.y}
            width={c.width / mpp}
            height={c.depth / mpp}
            offsetX={c.width / mpp / 2}
            offsetY={c.depth / mpp / 2}
            rotation={((c.rotation ?? 0) * 180) / Math.PI}
            fill="#3b3b3b"
            listening={false}
          />
        )
      })}

      {(level.stairs ?? []).map((s) =>
        stairSteps(s).map((st, i) => {
          const len = st.size[0] / mpp
          const w = st.size[2] / mpp
          return (
            <Rect
              key={`${s.id}-${i}`}
              x={st.center[0] / mpp}
              y={st.center[2] / mpp}
              width={len}
              height={w}
              offsetX={len / 2}
              offsetY={w / 2}
              rotation={(-st.rotationY * 180) / Math.PI}
              stroke="#8a6d4b"
              strokeWidth={1 / scale}
              fill="rgba(169,140,106,0.18)"
              listening={false}
            />
          )
        }),
      )}

      {(level.dimensions ?? []).map((d) => {
        const { a, b } = dimensionLine(d)
        const pa = px(a)
        const pb = px(b)
        const sel = selection?.kind === 'dimension' && selection.id === d.id
        const color = DIM_COLORS[d.status ?? 'inferred']
        const tick = 6 / scale
        const ang = (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI
        const readable = ang > 90 || ang <= -90 ? ang + 180 : ang
        const text = d.text || d.value.toFixed(2).replace('.', ',')
        const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }
        const choose = () => interactive && onSelect({ kind: 'dimension', id: d.id })
        return (
          <Group key={d.id} onClick={choose} onTap={choose}>
            <Line
              points={[pa.x, pa.y, pb.x, pb.y]}
              stroke={color}
              strokeWidth={(sel ? 2.5 : 1.2) / scale}
              hitStrokeWidth={14 / scale}
            />
            {[pa, pb].map((p, i) => (
              <Line key={i} points={[p.x - tick, p.y + tick, p.x + tick, p.y - tick]} stroke={color} strokeWidth={1.5 / scale} />
            ))}
            <Text
              x={mid.x}
              y={mid.y}
              text={d.status === 'conflict' ? `${text} ⚠` : text}
              rotation={readable}
              fontSize={font}
              fontFamily="IBM Plex Mono"
              fontStyle={sel ? 'bold' : 'normal'}
              fill={color}
              offsetX={(text.length * font * 0.6) / 2}
              offsetY={font * 1.3}
            />
          </Group>
        )
      })}
    </Group>
  )
}
