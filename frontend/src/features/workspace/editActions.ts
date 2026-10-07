/**
 * Operaciones del editor sobre la selección (eliminar, mover, copiar, pegar,
 * duplicar, seleccionar todo). Traducen la selección a comandos del dominio;
 * los atajos, la paleta de comandos y el menú contextual llaman a estas mismas
 * funciones, así cada acción tiene una sola implementación.
 */
import type { Wall } from '@/api/types'
import {
  cloneWalls,
  CompositeCommand,
  DeleteDimension,
  DeleteOpening,
  DeleteWall,
  InsertWalls,
  TranslateWalls,
  type Command,
} from '@/domain/commands'
import { selectLevel, useEditor, type Selected } from '@/store/editorStore'

/** desplazamiento de lo pegado, para que no quede encima del original */
export const PASTE_OFFSET = 0.5

const state = () => useEditor.getState()

function selectedWalls(): Wall[] {
  const s = state()
  const lv = selectLevel(s)
  if (!lv) return []
  const ids = new Set(s.group.filter((g) => g.kind === 'wall').map((g) => g.id))
  return lv.walls.filter((w) => ids.has(w.id))
}

export function hasSelection(): boolean {
  return state().group.length > 0
}

export function canDelete(): boolean {
  return state().group.some((g) => g.kind !== 'room')
}

/** Elimina muros, aberturas y cotas seleccionados en un solo paso de deshacer. */
export function deleteSelection(): boolean {
  const s = state()
  const walls = new Set(s.group.filter((g) => g.kind === 'wall').map((g) => g.id))
  const parts: Command[] = []
  // las aberturas de muros que también se eliminan desaparecen con su muro
  for (const g of s.group)
    if (g.kind === 'opening' && !walls.has(g.wallId)) parts.push(new DeleteOpening(s.levelId, g.wallId, g.id))
  for (const id of walls) parts.push(new DeleteWall(s.levelId, id))
  for (const g of s.group) if (g.kind === 'dimension') parts.push(new DeleteDimension(s.levelId, g.id))
  if (parts.length === 0) return false
  const n = parts.length
  const cmd = n === 1 ? parts[0]! : new CompositeCommand(`Eliminar ${n} elementos`, parts)
  const ok = s.dispatch(cmd)
  if (ok) s.select(null)
  return ok
}

/** Mueve los muros seleccionados (flechas: 5 cm, con Shift 25 cm). */
export function nudgeSelection(dx: number, dy: number): boolean {
  const ids = selectedWalls().map((w) => w.id)
  if (ids.length === 0) return false
  const s = state()
  return s.dispatch(new TranslateWalls(s.levelId, ids, dx, dy))
}

export function canCopy(): boolean {
  return selectedWalls().length > 0
}

export function copySelection(): number {
  const walls = selectedWalls()
  if (walls.length > 0) state().setClipboard(walls)
  return walls.length
}

function insert(walls: Wall[], label: string): boolean {
  const s = state()
  if (walls.length === 0) return false
  const copies = cloneWalls(walls, PASTE_OFFSET, PASTE_OFFSET)
  const ok = s.dispatch(new InsertWalls(s.levelId, copies, label))
  if (ok) s.selectMany(copies.map((w): Selected => ({ kind: 'wall', id: w.id })))
  return ok
}

export function canPaste(): boolean {
  return state().clipboard.length > 0
}

/** Pega lo copiado; pegar de nuevo desplaza otra vez (cada copia queda escalonada). */
export function paste(): boolean {
  const s = state()
  const n = s.clipboard.length
  const ok = insert(s.clipboard, n === 1 ? 'Pegar muro' : `Pegar ${n} muros`)
  if (ok) s.setClipboard(cloneWalls(s.clipboard, PASTE_OFFSET, PASTE_OFFSET))
  return ok
}

export function duplicateSelection(): boolean {
  const walls = selectedWalls()
  return insert(walls, walls.length === 1 ? 'Duplicar muro' : `Duplicar ${walls.length} muros`)
}

export function selectAllWalls(): number {
  const lv = selectLevel(state())
  if (!lv) return 0
  state().selectMany(lv.walls.map((w): Selected => ({ kind: 'wall', id: w.id })))
  return lv.walls.length
}
