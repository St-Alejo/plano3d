/**
 * Control de calidad del modelo: problemas que un arquitecto debería revisar antes de
 * exportar o computar. Cada aviso apunta a un elemento para poder seleccionarlo.
 */
import type { BuildingModel, Level, Wall } from '@/api/types'
import { distance, wallDirection, wallLength } from './model'
import { JOINT_TOL } from './topology'

export type Severity = 'error' | 'warning' | 'info'

export type QATarget = { kind: 'wall'; id: string } | { kind: 'opening'; id: string; wallId: string } | { kind: 'room'; id: string }

export interface QAIssue {
  code: 'overlap' | 'dangling' | 'short-wall' | 'opening-at-corner' | 'no-rooms' | 'scale' | 'low-confidence' | 'unnamed'
  severity: Severity
  message: string
  target?: QATarget
}

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

/** ¿El punto toca algún otro muro (su extremo o su tramo, dentro del grosor)? */
function touchesOther(p: { x: number; y: number }, self: Wall, walls: Wall[]): boolean {
  return walls.some((o) => {
    if (o.id === self.id) return false
    if (distance(p, o.start) <= JOINT_TOL * 2 || distance(p, o.end) <= JOINT_TOL * 2) return true
    if (o.bulge) return false // muro curvo: solo cuentan sus extremos
    const d = wallDirection(o)
    const along = (p.x - o.start.x) * d.x + (p.y - o.start.y) * d.y
    const perp = Math.abs(-(p.x - o.start.x) * d.y + (p.y - o.start.y) * d.x)
    return along >= -JOINT_TOL && along <= wallLength(o) + JOINT_TOL && perp <= o.thickness / 2 + JOINT_TOL
  })
}

/** Longitud en que dos muros casi colineales se pisan (0 si no). */
function overlapLength(a: Wall, b: Wall): number {
  const d = wallDirection(a)
  const cross = Math.abs(d.x * wallDirection(b).y - d.y * wallDirection(b).x)
  if (cross > 0.02) return 0 // no son paralelos (> ~1°)
  const perp = Math.abs(-(b.start.x - a.start.x) * d.y + (b.start.y - a.start.y) * d.x)
  if (perp > Math.max(a.thickness, b.thickness) / 2) return 0
  const proj = (p: { x: number; y: number }) => (p.x - a.start.x) * d.x + (p.y - a.start.y) * d.y
  const [b0, b1] = [proj(b.start), proj(b.end)].sort((x, y) => x - y) as [number, number]
  return Math.max(0, Math.min(wallLength(a), b1) - Math.max(0, b0))
}

function levelIssues(lv: Level): QAIssue[] {
  const issues: QAIssue[] = []
  const walls = lv.walls

  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const ov = overlapLength(walls[i]!, walls[j]!)
      if (ov > 0.05) {
        issues.push({
          code: 'overlap',
          severity: 'error',
          message: `Dos muros se superponen ${ov.toFixed(2)} m (duplicado)`,
          target: { kind: 'wall', id: walls[j]!.id },
        })
      }
    }
  }

  for (const w of walls) {
    const len = wallLength(w)
    if (len < w.thickness) {
      issues.push({ code: 'short-wall', severity: 'warning', message: `Muro de ${len.toFixed(2)} m, más corto que su grosor`, target: { kind: 'wall', id: w.id } })
    }
    const loose = (['start', 'end'] as const).filter((e) => !touchesOther(w[e], w, walls))
    if (loose.length > 0) {
      issues.push({
        code: 'dangling',
        severity: 'warning',
        message: loose.length === 2 ? 'Muro suelto: no toca ningún otro' : 'Muro con un extremo suelto',
        target: { kind: 'wall', id: w.id },
      })
    }
    for (const o of w.openings) {
      const margin = w.thickness / 2
      if (o.offset < margin - 1e-6 || len - (o.offset + o.width) < margin - 1e-6) {
        issues.push({
          code: 'opening-at-corner',
          severity: 'warning',
          message: `${o.kind === 'door' ? 'Puerta' : 'Ventana'} pegada a la esquina (no cabe el marco)`,
          target: { kind: 'opening', id: o.id, wallId: w.id },
        })
      }
    }
  }

  if (walls.length >= 3 && lv.rooms.length === 0) {
    issues.push({ code: 'no-rooms', severity: 'warning', message: 'Los muros no encierran ningún ambiente: revisa que las esquinas estén unidas' })
  }
  for (const r of lv.rooms) {
    if (r.confidence < 0.6) {
      issues.push({ code: 'low-confidence', severity: 'warning', message: `"${r.label}": detección dudosa, revisa sus límites`, target: { kind: 'room', id: r.id } })
    } else if (/^Espacio \d+$/.test(r.label)) {
      issues.push({ code: 'unnamed', severity: 'info', message: `"${r.label}" no tiene nombre`, target: { kind: 'room', id: r.id } })
    }
  }
  return issues
}

export function modelQA(m: BuildingModel): QAIssue[] {
  const issues = m.levels.flatMap(levelIssues)
  // exacta si la calibró una persona, si vino de un archivo CAD o si se ajustó a las cotas
  if (!['calibrated', 'vector', 'dimensions'].includes(m.scale.source ?? 'estimated')) {
    issues.push({
      code: 'scale',
      severity: 'warning',
      message: 'La escala es estimada: calibra con una cota conocida para que los metros sean exactos',
    })
  }
  return issues.sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
}
