/**
 * Operaciones del editor sobre la selección (eliminar, mover, copiar, pegar,
 * duplicar, seleccionar todo). Traducen la selección a comandos del dominio;
 * los atajos, la paleta de comandos y el menú contextual llaman a estas mismas
 * funciones, así cada acción tiene una sola implementación.
 */
import type { Opening, Wall } from '@/api/types'
import { modelBounds, wallDirection } from '@/domain/model'
import { findOpening, placeOpening } from '@/domain/openings'
import {
  AddFurniture,
  cloneWalls,
  CompositeCommand,
  DeleteDimension,
  DeleteFurniture,
  DeleteLevelItem,
  DeleteOpening,
  DeleteWall,
  DuplicateOpening,
  InsertWalls,
  MoveOpening,
  UpdateOpening,
  TranslateWalls,
  translateItem,
  UpdateFurniture,
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
  for (const g of s.group) if (g.kind === 'furniture') parts.push(new DeleteFurniture(s.levelId, g.id))
  for (const g of s.group) if (g.kind === 'column') parts.push(new DeleteLevelItem(s.levelId, 'columns', g.id))
  for (const g of s.group) if (g.kind === 'stair') parts.push(new DeleteLevelItem(s.levelId, 'stairs', g.id))
  if (parts.length === 0) return false
  const n = parts.length
  const cmd = n === 1 ? parts[0]! : new CompositeCommand(`Eliminar ${n} elementos`, parts)
  const ok = s.dispatch(cmd)
  if (ok) s.select(null)
  return ok
}

/** Muebles seleccionados en el nivel actual. */
function selectedFurniture() {
  const s = state()
  const ids = new Set(s.group.filter((g) => g.kind === 'furniture').map((g) => g.id))
  return (selectLevel(s)?.furniture ?? []).filter((f) => ids.has(f.id))
}

/** Aberturas seleccionadas con su muro (las de muros que también están seleccionados no cuentan). */
function selectedOpenings(): { wall: Wall; opening: Opening }[] {
  const s = state()
  const lv = selectLevel(s)
  if (!lv) return []
  return s.group.flatMap((g) => {
    if (g.kind !== 'opening') return []
    const hit = findOpening(lv.walls, g.id)
    return hit ? [hit] : []
  })
}

/**
 * Mueve muros y muebles seleccionados (flechas: 5 cm, con Shift 25 cm) en un solo paso.
 * Las puertas y ventanas se corren a lo largo de su muro, en el sentido de la flecha.
 */
export function nudgeSelection(dx: number, dy: number): boolean {
  const s = state()
  const ids = selectedWalls().map((w) => w.id)
  const parts: Command[] = []
  if (ids.length > 0) parts.push(new TranslateWalls(s.levelId, ids, dx, dy))
  for (const f of selectedFurniture())
    parts.push(new UpdateFurniture(s.levelId, f.id, { position: { x: f.position.x + dx, y: f.position.y + dy } }))
  const lv = selectLevel(s)
  for (const g of s.group) {
    const column = g.kind === 'column' ? lv?.columns?.find((c) => c.id === g.id) : undefined
    const stair = g.kind === 'stair' ? lv?.stairs?.find((x) => x.id === g.id) : undefined
    if (column) parts.push(translateItem(s.levelId, { kind: 'column', value: column }, dx, dy))
    if (stair) parts.push(translateItem(s.levelId, { kind: 'stair', value: stair }, dx, dy))
  }
  for (const { wall, opening } of selectedOpenings()) {
    if (ids.includes(wall.id)) continue
    const d = wallDirection(wall)
    const along = dx * d.x + dy * d.y
    if (Math.abs(along) < 1e-9) continue
    const center = opening.offset + opening.width / 2 + Math.sign(along) * Math.hypot(dx, dy)
    const p = placeOpening(wall, opening.width, center, opening.id, 0)
    if (p.ok && Math.abs(p.offset - opening.offset) > 1e-9) parts.push(new MoveOpening(s.levelId, opening.id, wall.id, p.offset))
  }
  if (parts.length === 0) return false
  return s.dispatch(parts.length === 1 ? parts[0]! : new CompositeCommand('Mover selección', parts))
}

/** Agrega una pieza del catálogo en el centro del plano y la deja seleccionada. */
export function addFurnitureAtCenter(catalogId: string): boolean {
  const s = state()
  if (!s.model) return false
  const cmd = new AddFurniture(s.levelId, catalogId, modelBounds(s.model).center)
  const ok = s.dispatch(cmd)
  if (ok) {
    s.setTool('select')
    s.select({ kind: 'furniture', id: cmd.furniture.id })
  }
  return ok
}

const selectedDoors = () => selectedOpenings().filter((x) => x.opening.kind === 'door')

export function canRotate(): boolean {
  return selectedFurniture().length > 0 || selectedDoors().length > 0
}

/**
 * Gira 90° los muebles seleccionados, cada uno sobre su centro. Las puertas recorren
 * las cuatro formas de abrir: cambia el lado de apertura y, cada dos, la bisagra.
 */
export function rotateSelection(): boolean {
  const s = state()
  const parts: Command[] = selectedFurniture().map(
    (f) => new UpdateFurniture(s.levelId, f.id, { rotation: (f.rotation ?? 0) + Math.PI / 2 }, 'Girar mueble'),
  )
  for (const { wall, opening } of selectedDoors()) {
    const left = opening.opens_left ?? true
    const hinge = opening.hinge_at_end ?? false
    parts.push(new UpdateOpening(s.levelId, wall.id, opening.id, left ? { opens_left: false } : { opens_left: true, hinge_at_end: !hinge }))
  }
  if (parts.length === 0) return false
  return s.dispatch(parts.length === 1 ? parts[0]! : new CompositeCommand(`Girar ${parts.length} elementos`, parts))
}

export function canCopy(): boolean {
  return selectedWalls().length > 0
}

export function canDuplicate(): boolean {
  return selectedWalls().length > 0 || selectedOpenings().length === 1
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

/** Duplica los muros seleccionados o, si es una sola abertura, la copia al lado en su muro. */
export function duplicateSelection(): boolean {
  const walls = selectedWalls()
  if (walls.length > 0) return insert(walls, walls.length === 1 ? 'Duplicar muro' : `Duplicar ${walls.length} muros`)
  const [only] = selectedOpenings()
  if (!only) return false
  const { wall, opening } = only
  const gap = 0.3
  // primero a la derecha, si no cabe a la izquierda
  for (const center of [opening.offset + opening.width * 1.5 + gap, opening.offset - opening.width / 2 - gap]) {
    const p = placeOpening(wall, opening.width, center, undefined, 0)
    if (!p.ok) continue
    const s = state()
    const cmd = new DuplicateOpening(s.levelId, wall.id, opening, p.offset)
    const ok = s.dispatch(cmd)
    if (ok) s.select({ kind: 'opening', id: cmd.opening.id, wallId: wall.id })
    return ok
  }
  state().setError('No cabe otra abertura igual en este muro')
  return false
}

export function selectAllWalls(): number {
  const lv = selectLevel(state())
  if (!lv) return 0
  state().selectMany(lv.walls.map((w): Selected => ({ kind: 'wall', id: w.id })))
  return lv.walls.length
}
