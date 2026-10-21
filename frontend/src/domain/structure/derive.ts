/**
 * Estructura de mampostería confinada derivada del plano (ADR-017). No se guarda: sale de
 * los muros cada vez, con reglas de NSR-10 Título E (ver nsr10.ts):
 *
 * - muros confinados = los que no son tabique (`kind !== 'partition'`) o marcados `structural`;
 * - columnetas en extremos, esquinas, uniones en T o X, bordes de vanos grandes y donde
 *   se pasa la separación máxima; si el plano ya trae una columna cerca, se usa esa;
 * - viga de amarre sobre cada muro confinado en cada piso; viga de cimentación y
 *   sobrecimiento bajo los muros confinados del primer piso; dinteles sobre los vanos;
 * - paños de mampostería entre columnetas (de aquí sale el ladrillo pieza por pieza).
 */
import type { BuildingModel, Level, Point, Wall } from '@/api/types'
import { distance, pointAlong, projectOnWall, wallDirection, wallLength } from '../model'
import { BRICKS, type BrickId } from './bricks'
import { columnDepth, FOOTING_BY_STORIES, NSR10, type Reinforcement } from './nsr10'

export interface StructureSettings {
  brick: BrickId
}

export const DEFAULT_SETTINGS: StructureSettings = { brick: 'tolete' }

export type LinearKind = 'footing' | 'plinth' | 'beam' | 'lintel'

/** Elemento lineal (viga, cimiento, sobrecimiento, dintel) a lo largo de un eje en planta. */
export interface LinearElement {
  id: string
  kind: LinearKind
  levelId: string
  start: Point
  end: Point
  /** ancho (perpendicular al eje) y alto */
  width: number
  height: number
  /** cota inferior absoluta (m; 0 = piso terminado del primer piso) */
  bottom: number
  wallId: string
  /** sin refuerzo: sobrecimiento en concreto ciclópeo */
  rebar: Reinforcement | null
}

export interface TieColumn {
  id: string
  levelId: string
  center: Point
  /** largo a lo largo del muro principal y ancho (grosor del muro) */
  along: number
  across: number
  /** ángulo del muro principal en planta (rad) */
  angle: number
  bottom: number
  height: number
  /** derivada por las reglas o tomada de una columna del plano */
  source: 'derived' | 'model'
  /** por qué está aquí (para el rótulo del maestro) */
  reason: 'extremo' | 'esquina' | 'unión' | 'vano' | 'separación' | 'plano'
  rebar: Reinforcement
}

/** Paño de mampostería: tramo de muro entre caras de columnetas, del piso a la viga. */
export interface MasonryPanel {
  id: string
  wallId: string
  levelId: string
  /** tramo a lo largo del eje del muro */
  from: number
  to: number
  bottom: number
  top: number
  confined: boolean
}

export interface Structure {
  settings: StructureSettings
  stories: number
  columns: TieColumn[]
  footings: LinearElement[]
  plinths: LinearElement[]
  beams: LinearElement[]
  lintels: LinearElement[]
  panels: MasonryPanel[]
  /** avisos para el maestro (muros curvos, más de dos pisos...) */
  warnings: string[]
}

const TOL = 0.08

export const isConfined = (w: Wall): boolean => !w.bulge && (w.structural === true || w.kind !== 'partition')

/** Los pisos de abajo hacia arriba, solo los que tienen muros. */
function storiesOf(model: BuildingModel): Level[] {
  return [...model.levels].filter((l) => l.walls.length > 0).sort((a, b) => a.elevation - b.elevation)
}

interface Candidate {
  offset: number
  reason: TieColumn['reason']
}

/** Puntos a lo largo de un muro confinado donde va una columneta (offsets desde su inicio). */
function columnOffsets(w: Wall, others: Wall[], clearHeight: number): Candidate[] {
  const len = wallLength(w)
  const d = columnDepth(w.thickness)
  const out: Candidate[] = []
  const isCorner = (p: Point) => others.some((o) => distance(o.start, p) < TOL || distance(o.end, p) < TOL)
  out.push({ offset: 0, reason: isCorner(w.start) ? 'esquina' : 'extremo' })
  out.push({ offset: len, reason: isCorner(w.end) ? 'esquina' : 'extremo' })
  // uniones en T: otro muro confinado muere en el interior de este
  for (const o of others) {
    for (const p of [o.start, o.end]) {
      const { offset, distance: dist } = projectOnWall(w, p)
      if (dist < w.thickness / 2 + TOL && offset > TOL && offset < len - TOL) out.push({ offset, reason: 'unión' })
    }
  }
  // vanos grandes: columneta pegada a cada borde, por fuera del vano
  for (const o of w.openings) {
    if (o.width * o.height <= NSR10.openingNeedsColumns) continue
    out.push({ offset: Math.max(0, o.offset - d / 2), reason: 'vano' })
    out.push({ offset: Math.min(len, o.offset + o.width + d / 2), reason: 'vano' })
  }
  out.sort((a, b) => a.offset - b.offset)
  const merged: Candidate[] = []
  for (const c of out) {
    const last = merged[merged.length - 1]
    if (last && c.offset - last.offset < d) continue
    merged.push(c)
  }
  // separación máxima: columnetas intermedias repartidas, corridas fuera de los vanos
  const max = NSR10.maxColumnSpacing(w.thickness, clearHeight)
  const filled: Candidate[] = []
  merged.forEach((c, i) => {
    filled.push(c)
    const next = merged[i + 1]
    if (!next) return
    const gap = next.offset - c.offset
    const n = Math.ceil(gap / max - 1e-9) - 1
    for (let k = 1; k <= n; k++) {
      let at = c.offset + (gap * k) / (n + 1)
      const hole = w.openings.find((o) => at > o.offset - d / 2 && at < o.offset + o.width + d / 2)
      if (hole) {
        const before = hole.offset - d / 2
        const after = hole.offset + hole.width + d / 2
        at = at - before < after - at && before > c.offset + d ? before : after
      }
      if (at > c.offset + d / 2 && at < next.offset - d / 2) filled.push({ offset: at, reason: 'separación' })
    }
  })
  return filled.sort((a, b) => a.offset - b.offset)
}

export function deriveStructure(model: BuildingModel, settings: StructureSettings = DEFAULT_SETTINGS): Structure {
  const stories = storiesOf(model)
  const warnings: string[] = []
  if (stories.length > 2) warnings.push(`El plano tiene ${stories.length} pisos: el Título E cubre casas de uno y dos pisos; esta estructura requiere diseño de un ingeniero.`)
  const footingSection = FOOTING_BY_STORIES[stories.length >= 2 ? 2 : 1]
  const footingTop = -NSR10.foundationDepth + NSR10.leanConcrete + footingSection.height

  const columns: Omit<TieColumn, 'id'>[] = []
  const footings: Omit<LinearElement, 'id'>[] = []
  const plinths: Omit<LinearElement, 'id'>[] = []
  const beams: Omit<LinearElement, 'id'>[] = []
  const lintels: Omit<LinearElement, 'id'>[] = []
  const panels: Omit<MasonryPanel, 'id'>[] = []

  stories.forEach((lv, storyIndex) => {
    const ground = storyIndex === 0
    const confined = lv.walls.filter(isConfined)
    for (const w of lv.walls.filter((x) => x.bulge)) warnings.push(`El muro curvo ${w.id} no se confina: se dibuja como tabique.`)
    const wallTop = (w: Wall) => lv.elevation + w.height
    const beamBottom = (w: Wall) => wallTop(w) - NSR10.beamHeight
    const levelColumns: Omit<TieColumn, 'id'>[] = []

    // columnetas de cada muro confinado, sin repetir las de las esquinas compartidas
    for (const w of confined) {
      const others = confined.filter((o) => o !== w)
      const dir = wallDirection(w)
      const angle = Math.atan2(dir.y, dir.x)
      for (const c of columnOffsets(w, others, w.height - NSR10.beamHeight)) {
        const center = pointAlong(w, c.offset)
        const same = levelColumns.find((x) => distance(x.center, center) < TOL * 2)
        if (same) {
          // una esquina compartida toma el muro más grueso como sección
          if (w.thickness > same.across) Object.assign(same, { across: w.thickness, along: columnDepth(w.thickness), angle })
          if (c.reason === 'esquina' || c.reason === 'unión') same.reason = same.reason === 'extremo' ? c.reason : same.reason
          continue
        }
        levelColumns.push({
          levelId: lv.id,
          center,
          along: columnDepth(w.thickness),
          across: w.thickness,
          angle,
          bottom: ground ? footingTop : lv.elevation,
          height: beamBottom(w) - (ground ? footingTop : lv.elevation),
          source: 'derived',
          reason: c.reason,
          rebar: NSR10.columnRebar,
        })
      }
    }
    // las columnas dibujadas en el plano mandan sobre las derivadas cercanas
    for (const mc of lv.columns ?? []) {
      const near = levelColumns.find((x) => distance(x.center, mc.center) < 0.35)
      const top = lv.elevation + (lv.height ?? 2.6) - NSR10.beamHeight
      const bottom = ground ? footingTop : lv.elevation
      const fromPlan = { center: mc.center, along: mc.width, across: mc.depth, angle: mc.rotation ?? 0, source: 'model' as const, reason: 'plano' as const, bottom, height: top - bottom }
      if (near) Object.assign(near, fromPlan)
      else levelColumns.push({ levelId: lv.id, rebar: NSR10.columnRebar, ...fromPlan })
    }
    columns.push(...levelColumns)

    for (const w of lv.walls) {
      const len = wallLength(w)
      const dir = wallDirection(w)
      const ext = w.thickness / 2
      const axis = (pad: number) => ({ start: pointAlong(w, -pad), end: pointAlong(w, len + pad) })
      if (!isConfined(w)) {
        panels.push({ wallId: w.id, levelId: lv.id, from: 0, to: len, bottom: lv.elevation, top: wallTop(w), confined: false })
        continue
      }
      beams.push({ kind: 'beam', levelId: lv.id, ...axis(ext), width: w.thickness, height: NSR10.beamHeight, bottom: beamBottom(w), wallId: w.id, rebar: NSR10.beamRebar })
      if (ground) {
        footings.push({ kind: 'footing', levelId: lv.id, ...axis(footingSection.width / 2), width: footingSection.width, height: footingSection.height, bottom: -NSR10.foundationDepth + NSR10.leanConcrete, wallId: w.id, rebar: footingSection.rebar })
        plinths.push({ kind: 'plinth', levelId: lv.id, ...axis(ext), width: w.thickness, height: -footingTop, bottom: footingTop, wallId: w.id, rebar: null })
      }
      // paños: el muro menos las columnetas que caen sobre su eje
      const cuts = levelColumns
        .map((c) => ({ c, p: projectOnWall(w, c.center) }))
        .filter(({ p }) => p.distance < w.thickness / 2 + TOL && p.offset > -TOL && p.offset < len + TOL)
        .map(({ c, p }) => {
          // largo de la columneta medido sobre este muro (si está girada respecto a él, cuenta su ancho)
          const parallel = Math.abs(Math.cos(c.angle - Math.atan2(dir.y, dir.x))) > 0.7
          const half = (parallel ? c.along : c.across) / 2
          return [p.offset - half, p.offset + half] as const
        })
        .sort((a, b) => a[0] - b[0])
      let cursor = 0
      for (const [a, b] of cuts) {
        if (a - cursor > 0.02) panels.push({ wallId: w.id, levelId: lv.id, from: cursor, to: a, bottom: lv.elevation, top: beamBottom(w), confined: true })
        cursor = Math.max(cursor, b)
      }
      if (len - cursor > 0.02) panels.push({ wallId: w.id, levelId: lv.id, from: cursor, to: len, bottom: lv.elevation, top: beamBottom(w), confined: true })

      // dinteles: sobre cada vano que no llega a la viga de amarre
      for (const o of w.openings) {
        const top = lv.elevation + o.sill + o.height
        const room = beamBottom(w) - top
        if (room < NSR10.lintelHeight) continue
        const from = Math.max(0, o.offset - NSR10.lintelBearing)
        const to = Math.min(len, o.offset + o.width + NSR10.lintelBearing)
        lintels.push({ kind: 'lintel', levelId: lv.id, start: pointAlong(w, from), end: pointAlong(w, to), width: w.thickness, height: NSR10.lintelHeight, bottom: top, wallId: w.id, rebar: NSR10.lintelRebar })
      }
    }
  })

  // numeración del maestro: por piso y de arriba hacia abajo, izquierda a derecha en planta
  const order = (a: { levelId: string; center: Point }, b: { levelId: string; center: Point }) => {
    const la = stories.findIndex((l) => l.id === a.levelId)
    const lb = stories.findIndex((l) => l.id === b.levelId)
    return la - lb || Math.round((a.center.y - b.center.y) * 100) || a.center.x - b.center.x
  }
  const mid = (e: Omit<LinearElement, 'id'>) => ({ levelId: e.levelId, center: { x: (e.start.x + e.end.x) / 2, y: (e.start.y + e.end.y) / 2 } })
  const name = <T extends object>(list: T[], prefix: string, key: (t: T) => { levelId: string; center: Point }) =>
    [...list].sort((a, b) => order(key(a), key(b))).map((t, i) => ({ ...t, id: `${prefix}-${i + 1}` }))

  return {
    settings,
    stories: stories.length,
    columns: name(columns, 'C', (c) => c),
    footings: name(footings, 'VC', mid),
    plinths: name(plinths, 'SC', mid),
    beams: name(beams, 'VA', mid),
    lintels: name(lintels, 'D', mid),
    panels: panels.map((p, i) => ({ ...p, id: `M-${i + 1}` })),
    warnings,
  }
}

/** Unidad de mampostería elegida. */
export const brickOf = (s: Structure) => BRICKS[s.settings.brick]
