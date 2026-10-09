/**
 * Elementos del modelo v2 sobre el plano (ADR-012): columnas, escaleras y COTAS.
 *
 * Las cotas se dibujan como en el plano (línea, marcas a 45° y valor) con el color de
 * su estado: exacta (verde), inferida (gris) o en conflicto (rojo). Un clic la
 * selecciona para corregir su valor en el panel.
 */
import type Konva from 'konva'
import { Circle, Group, Line, Rect, Text } from 'react-konva'
import type { Column, Dimension, Level, MeasureStatus, Point, Stair } from '@/api/types'
import { stairSteps } from '@/domain/geometry'
import type { Selected, Selection } from '@/store/editorStore'

const SEL = '#23845f'

/** Columna o escalera arrastrada: cuánto se movió, en metros. */
export type ItemMove = { kind: 'column'; value: Column } | { kind: 'stair'; value: Stair }

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
  /** columnas y escaleras: seleccionables y arrastrables (capa de muros sin bloquear) */
  editable?: boolean
  showDimensions?: boolean
  isSelected?: (kind: Selected['kind'], id: string) => boolean
  onPick?: (sel: Selected, e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void
  onMoveItem?: (item: ItemMove, dx: number, dy: number) => void
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

export function PlanElements({
  level,
  mpp,
  scale,
  selection,
  onSelect,
  interactive,
  editable = false,
  showDimensions = true,
  isSelected = () => false,
  onPick,
  onMoveItem,
}: Props) {
  const px = (p: Point) => ({ x: p.x / mpp, y: p.y / mpp })
  const font = 11 / scale
  // el grupo se arrastra desde (0,0): al soltar, su posición es el desplazamiento en px de imagen
  const dragProps = (item: ItemMove, sel: Selected) => ({
    draggable: editable,
    listening: editable,
    onClick: (e: Konva.KonvaEventObject<MouseEvent>) => onPick?.(sel, e),
    onTap: (e: Konva.KonvaEventObject<TouchEvent>) => onPick?.(sel, e),
    onDragStart: () => onSelect(sel),
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      const dx = e.target.x() * mpp
      const dy = e.target.y() * mpp
      e.target.position({ x: 0, y: 0 })
      if (Math.hypot(dx, dy) > 1e-4) onMoveItem?.(item, dx, dy)
    },
  })
  return (
    <Group>
      {(level.columns ?? []).map((c) => {
        const p = px(c.center)
        const sel = isSelected('column', c.id)
        const look = { fill: sel ? SEL : '#3b3b3b', stroke: sel ? SEL : undefined, strokeWidth: sel ? 3 / scale : 0, hitStrokeWidth: 10 / scale }
        return (
          <Group key={c.id} {...dragProps({ kind: 'column', value: c }, { kind: 'column', id: c.id })}>
            {c.round ? (
              <Circle x={p.x} y={p.y} radius={c.width / mpp / 2} {...look} />
            ) : (
              <Rect
                x={p.x}
                y={p.y}
                width={c.width / mpp}
                height={c.depth / mpp}
                offsetX={c.width / mpp / 2}
                offsetY={c.depth / mpp / 2}
                rotation={((c.rotation ?? 0) * 180) / Math.PI}
                {...look}
              />
            )}
          </Group>
        )
      })}

      {(level.stairs ?? []).map((s) => {
        const sel = isSelected('stair', s.id)
        return (
          <Group key={s.id} {...dragProps({ kind: 'stair', value: s }, { kind: 'stair', id: s.id })}>
            {stairSteps(s).map((st, i) => {
              const len = st.size[0] / mpp
              const w = st.size[2] / mpp
              return (
                <Rect
                  key={i}
                  x={st.center[0] / mpp}
                  y={st.center[2] / mpp}
                  width={len}
                  height={w}
                  offsetX={len / 2}
                  offsetY={w / 2}
                  rotation={(-st.rotationY * 180) / Math.PI}
                  stroke={sel ? SEL : '#8a6d4b'}
                  strokeWidth={(sel ? 2 : 1) / scale}
                  fill={sel ? 'rgba(35,132,95,0.18)' : 'rgba(169,140,106,0.18)'}
                />
              )
            })}
          </Group>
        )
      })}

      {showDimensions && (level.dimensions ?? []).map((d) => {
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
              fontFamily="Geist Mono"
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
