/**
 * Lo que hacen los demás en este piso (edición en vivo, ADR-021): el contorno de lo que
 * cada uno tiene seleccionado, con su nombre, y el fantasma de lo que está arrastrando.
 */
import { Group, Label, Line, Tag, Text } from 'react-konva'
import type { Level, Point } from '@/api/types'
import { peerColor, useCollab } from '@/collab/collabStore'
import type { PeerInfo, PreviewEntity } from '@/collab/protocol'
import { wallAxis } from '@/domain/geometry'
import { wallDirection } from '@/domain/model'

interface Props {
  level: Level
  mpp: number
  scale: number
}

type Outline = { points: number[]; closed: boolean; width: number; anchor: Point }

/** Contorno (en píxeles del plano) de la entidad con ese id, si está en el piso. */
function outlineOf(level: Level, id: string, mpp: number): Outline | null {
  const px = (p: Point) => [p.x / mpp, p.y / mpp]
  const wall = level.walls.find((w) => w.id === id)
  if (wall) {
    return { points: wallAxis(wall).flatMap(px), closed: false, width: wall.thickness / mpp + 6, anchor: wall.start }
  }
  for (const w of level.walls) {
    const o = w.openings.find((x) => x.id === id)
    if (!o) continue
    const d = wallDirection(w)
    const a = { x: w.start.x + d.x * o.offset, y: w.start.y + d.y * o.offset }
    const b = { x: a.x + d.x * o.width, y: a.y + d.y * o.width }
    return { points: [...px(a), ...px(b)], closed: false, width: w.thickness / mpp + 6, anchor: a }
  }
  const room = level.rooms.find((r) => r.id === id)
  if (room) return { points: room.polygon.flatMap(px), closed: true, width: 3, anchor: room.polygon[0] ?? { x: 0, y: 0 } }
  const f = (level.furniture ?? []).find((x) => x.id === id)
  if (f) return { points: rectPoints(f.position, f.width, f.depth, f.rotation ?? 0).flatMap(px), closed: true, width: 3, anchor: f.position }
  const c = (level.columns ?? []).find((x) => x.id === id)
  if (c) return { points: rectPoints(c.center, c.width, c.depth, c.rotation ?? 0).flatMap(px), closed: true, width: 3, anchor: c.center }
  return null
}

function rectPoints(center: Point, w: number, d: number, rot: number): Point[] {
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map(([x, y]) => ({ x: center.x + x! * cos - y! * sin, y: center.y + x! * sin + y! * cos }))
}

function ghostOf(entity: PreviewEntity, level: Level, mpp: number): Outline | null {
  const v = entity.v as Record<string, unknown>
  if (entity.k === 'opening') {
    const w = level.walls.find((x) => x.id === v.wall)
    if (!w) return null
    const d = wallDirection(w)
    const off = Number(v.offset ?? 0)
    const a = { x: w.start.x + d.x * off, y: w.start.y + d.y * off }
    const b = { x: a.x + d.x * Number(v.width ?? 0.9), y: a.y + d.y * Number(v.width ?? 0.9) }
    return { points: [a.x / mpp, a.y / mpp, b.x / mpp, b.y / mpp], closed: false, width: (w.thickness / mpp) * 1.6, anchor: a }
  }
  if (entity.k === 'wall') {
    const start = v.start as Point | undefined
    const end = v.end as Point | undefined
    if (!start || !end) return null
    return { points: [start.x / mpp, start.y / mpp, end.x / mpp, end.y / mpp], closed: false, width: Number(v.thickness ?? 0.15) / mpp, anchor: start }
  }
  const pos = v.position as Point | undefined
  if (!pos) return null
  const pts = rectPoints(pos, Number(v.width ?? 0.5), Number(v.depth ?? 0.5), Number(v.rotation ?? 0))
  return { points: pts.flatMap((p) => [p.x / mpp, p.y / mpp]), closed: true, width: 2, anchor: pos }
}

function NameTag({ at, name, color, scale, mpp }: { at: Point; name: string; color: string; scale: number; mpp: number }) {
  return (
    <Label x={at.x / mpp} y={at.y / mpp} offsetY={22 / scale} listening={false}>
      <Tag fill={color} cornerRadius={3 / scale} />
      <Text text={name} fontSize={11 / scale} fontFamily="Hanken Grotesk Variable" fill="#ffffff" padding={3 / scale} />
    </Label>
  )
}

export function RemoteLayer({ level, mpp, scale }: Props) {
  const peers = useCollab((s) => s.peers)
  const previews = useCollab((s) => s.previews)
  const here = (p: PeerInfo) => p.presence?.level === level.id

  return (
    <Group listening={false}>
      {Object.values(peers).filter(here).map((peer) => {
        const id = peer.presence?.selection
        const shape = id && !previews[peer.id] ? outlineOf(level, id, mpp) : null
        if (!shape) return null
        const color = peerColor(peer.id)
        return (
          <Group key={peer.id}>
            <Line points={shape.points} closed={shape.closed} stroke={color} strokeWidth={shape.closed ? 2.5 / scale : shape.width} opacity={shape.closed ? 1 : 0.35} lineCap="round" />
            <NameTag at={shape.anchor} name={peer.name} color={color} scale={scale} mpp={mpp} />
          </Group>
        )
      })}
      {Object.entries(previews).map(([peerId, entity]) => {
        if (entity.level !== level.id) return null
        const shape = ghostOf(entity, level, mpp)
        const peer = peers[peerId]
        if (!shape || !peer) return null
        const color = peerColor(peerId)
        return (
          <Group key={`ghost-${peerId}`} opacity={0.6}>
            {shape.closed ? (
              <Line points={shape.points} closed stroke={color} strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} fill={`${color}22`} />
            ) : (
              <Line points={shape.points} stroke={color} strokeWidth={shape.width} lineCap="square" />
            )}
            <NameTag at={shape.anchor} name={peer.name} color={color} scale={scale} mpp={mpp} />
          </Group>
        )
      })}
    </Group>
  )
}
