/**
 * Patrón Command: cada edición del editor es un objeto con `execute` y `undo`.
 *
 * Como el modelo es inmutable, cada comando guarda la versión anterior de la
 * entidad que toca (no del modelo completo), así el historial es liviano y
 * deshacer una edición no pisa otras ediciones posteriores de otras entidades.
 */
import type { BuildingModel, Dimension, Furniture, Level, Opening, OpeningKind, Point, Room, Wall } from '@/api/types'
import { catalogItem } from './catalog'
import {
  DOOR,
  MIN_WALL_LENGTH,
  WINDOW,
  findLevel,
  findWall,
  moveWallEndpoint,
  newId,
  removeWall,
  replaceLevel,
  rescaleModel,
  upsertRoom,
  upsertWall,
  validateWall,
  wallDirection,
  wallLength,
} from './model'
import { applyJointMoves, type JointMove } from './topology'

export interface Command {
  readonly label: string
  execute(model: BuildingModel): BuildingModel
  undo(model: BuildingModel): BuildingModel
}

export class CommandError extends Error {}

function checked(w: Wall): Wall {
  const err = validateWall(w)
  if (err) throw new CommandError(err)
  return w
}

/** Reemplaza un muro por otra versión; base de varios comandos. */
abstract class WallEdit implements Command {
  abstract readonly label: string
  private before: Wall | null = null
  protected constructor(
    protected readonly levelId: string,
    protected readonly wallId: string,
  ) {}

  protected abstract transform(w: Wall): Wall

  execute(model: BuildingModel): BuildingModel {
    const lv = findLevel(model, this.levelId)
    const current = findWall(lv, this.wallId)
    this.before = current
    return replaceLevel(model, upsertWall(lv, checked(this.transform(current))))
  }

  undo(model: BuildingModel): BuildingModel {
    if (!this.before) return model
    const lv = findLevel(model, this.levelId)
    return replaceLevel(model, upsertWall(lv, this.before))
  }
}

export class MoveWallEndpoint extends WallEdit {
  readonly label = 'Mover extremo del muro'
  constructor(
    levelId: string,
    wallId: string,
    private readonly end: 'start' | 'end',
    private readonly to: Point,
  ) {
    super(levelId, wallId)
  }
  protected transform(w: Wall): Wall {
    return moveWallEndpoint(w, this.end, this.to)
  }
}

/**
 * Edición que mueve UNIONES (esquinas y encuentros en T): puede cambiar varios muros a
 * la vez. Guarda solo los muros tocados, así deshacer no pisa ediciones de otros muros.
 */
abstract class JointEdit implements Command {
  abstract readonly label: string
  private before: Wall[] = []
  protected constructor(protected readonly levelId: string) {}

  protected abstract moves(level: Level): { moves: JointMove[]; only?: Set<string> }

  execute(model: BuildingModel): BuildingModel {
    const lv = findLevel(model, this.levelId)
    const { moves, only } = this.moves(lv)
    const changed = applyJointMoves(lv, moves, only)
    if (changed.size === 0) throw new CommandError('No hay nada que mover')
    changed.forEach((w) => checked(w))
    this.before = lv.walls.filter((w) => changed.has(w.id))
    return replaceLevel(model, { ...lv, walls: lv.walls.map((w) => changed.get(w.id) ?? w) })
  }

  undo(model: BuildingModel): BuildingModel {
    const lv = findLevel(model, this.levelId)
    const byId = new Map(this.before.map((w) => [w.id, w]))
    return replaceLevel(model, { ...lv, walls: lv.walls.map((w) => byId.get(w.id) ?? w) })
  }
}

/** Mueve una esquina: todos los muros que llegan a ella la siguen. */
export class MoveJoint extends JointEdit {
  readonly label = 'Mover esquina'
  constructor(
    levelId: string,
    private readonly from: Point,
    private readonly to: Point,
  ) {
    super(levelId)
  }
  protected moves() {
    return { moves: [{ from: this.from, to: this.to }] }
  }
}

/** Desplaza el muro completo; los muros unidos a sus puntas se estiran para seguirlo. */
export class TranslateWall extends JointEdit {
  readonly label = 'Mover muro'
  constructor(
    levelId: string,
    private readonly wallId: string,
    private readonly dx: number,
    private readonly dy: number,
  ) {
    super(levelId)
  }
  protected moves(level: Level) {
    const w = findWall(level, this.wallId)
    const mv = (p: Point): Point => ({ x: p.x + this.dx, y: p.y + this.dy })
    return { moves: [{ from: w.start, to: mv(w.start) }, { from: w.end, to: mv(w.end) }] }
  }
}

/**
 * Desplaza varios muros a la vez como un bloque. Las esquinas compartidas se mueven
 * una sola vez (con `TranslateWall` repetido se desplazarían dos veces).
 */
export class TranslateWalls extends JointEdit {
  readonly label: string
  constructor(
    levelId: string,
    private readonly wallIds: string[],
    private readonly dx: number,
    private readonly dy: number,
  ) {
    super(levelId)
    this.label = wallIds.length === 1 ? 'Mover muro' : `Mover ${wallIds.length} muros`
  }
  protected moves(level: Level) {
    const mv = (p: Point): Point => ({ x: p.x + this.dx, y: p.y + this.dy })
    const moves: JointMove[] = []
    for (const id of this.wallIds) {
      const w = findWall(level, id)
      moves.push({ from: w.start, to: mv(w.start) }, { from: w.end, to: mv(w.end) })
    }
    return { moves }
  }
}

/** Largo exacto: el inicio queda fijo y la esquina final se desplaza (arrastrando sus muros). */
export class SetWallLength extends JointEdit {
  readonly label = 'Cambiar largo del muro'
  constructor(
    levelId: string,
    private readonly wallId: string,
    private readonly length: number,
  ) {
    super(levelId)
    if (!(length >= MIN_WALL_LENGTH)) throw new CommandError('El largo debe ser mayor a 5 cm')
  }
  protected moves(level: Level) {
    const w = findWall(level, this.wallId)
    const d = wallDirection(w)
    return { moves: [{ from: w.end, to: { x: w.start.x + d.x * this.length, y: w.start.y + d.y * this.length } }] }
  }
}

/** Ángulo exacto en grados (0° = derecha, 90° = abajo en planta), girando alrededor del inicio. */
export class SetWallAngle extends JointEdit {
  readonly label = 'Cambiar ángulo del muro'
  constructor(
    levelId: string,
    private readonly wallId: string,
    private readonly degrees: number,
  ) {
    super(levelId)
    if (!Number.isFinite(degrees)) throw new CommandError('Ángulo inválido')
  }
  protected moves(level: Level) {
    const w = findWall(level, this.wallId)
    const len = wallLength(w)
    const a = (this.degrees * Math.PI) / 180
    return { moves: [{ from: w.end, to: { x: w.start.x + Math.cos(a) * len, y: w.start.y + Math.sin(a) * len } }] }
  }
}

export class UpdateWall extends WallEdit {
  readonly label = 'Editar muro'
  constructor(
    levelId: string,
    wallId: string,
    private readonly patch: Partial<Pick<Wall, 'thickness' | 'height' | 'material'>>,
  ) {
    super(levelId, wallId)
  }
  protected transform(w: Wall): Wall {
    return { ...w, ...this.patch }
  }
}

export class AddOpening extends WallEdit {
  readonly label: string
  readonly opening: Opening
  constructor(levelId: string, wallId: string, kind: OpeningKind, centerOffset: number, wallLen: number) {
    super(levelId, wallId)
    const spec = kind === 'door' ? DOOR : WINDOW
    const width = Math.min(spec.width, wallLen * 0.9)
    const offset = Math.min(Math.max(0, centerOffset - width / 2), wallLen - width)
    this.opening = { id: newId('op'), kind, offset, width, height: spec.height, sill: spec.sill, confidence: 1 }
    this.label = kind === 'door' ? 'Agregar puerta' : 'Agregar ventana'
  }
  protected transform(w: Wall): Wall {
    return { ...w, openings: [...w.openings, this.opening] }
  }
}

export class UpdateOpening extends WallEdit {
  readonly label = 'Editar abertura'
  constructor(
    levelId: string,
    wallId: string,
    private readonly openingId: string,
    private readonly patch: Partial<Omit<Opening, 'id'>>,
  ) {
    super(levelId, wallId)
  }
  protected transform(w: Wall): Wall {
    return { ...w, openings: w.openings.map((o) => (o.id === this.openingId ? { ...o, ...this.patch } : o)) }
  }
}

export class DeleteOpening extends WallEdit {
  readonly label = 'Eliminar abertura'
  constructor(
    levelId: string,
    wallId: string,
    private readonly openingId: string,
  ) {
    super(levelId, wallId)
  }
  protected transform(w: Wall): Wall {
    if (!w.openings.some((o) => o.id === this.openingId)) throw new CommandError('La abertura no existe')
    return { ...w, openings: w.openings.filter((o) => o.id !== this.openingId) }
  }
}

export class AddWall implements Command {
  readonly label = 'Agregar muro'
  readonly wall: Wall
  constructor(
    private readonly levelId: string,
    start: Point,
    end: Point,
    template: Partial<Pick<Wall, 'thickness' | 'height'>> = {},
  ) {
    this.wall = checked({
      id: newId('w'),
      start,
      end,
      thickness: template.thickness ?? 0.15,
      height: template.height ?? 2.6,
      material: 'plaster',
      openings: [],
      confidence: 1,
    })
  }
  execute(model: BuildingModel): BuildingModel {
    const lv = findLevel(model, this.levelId)
    return replaceLevel(model, upsertWall(lv, this.wall))
  }
  undo(model: BuildingModel): BuildingModel {
    return replaceLevel(model, removeWall(findLevel(model, this.levelId), this.wall.id))
  }
}

export class DeleteWall implements Command {
  readonly label = 'Eliminar muro'
  private before: { wall: Wall; index: number } | null = null
  constructor(
    private readonly levelId: string,
    private readonly wallId: string,
  ) {}
  execute(model: BuildingModel): BuildingModel {
    const lv = findLevel(model, this.levelId)
    const index = lv.walls.findIndex((w) => w.id === this.wallId)
    if (index < 0) throw new CommandError('El muro no existe')
    this.before = { wall: lv.walls[index]!, index }
    return replaceLevel(model, removeWall(lv, this.wallId))
  }
  undo(model: BuildingModel): BuildingModel {
    if (!this.before) return model
    const lv = findLevel(model, this.levelId)
    const walls = [...lv.walls]
    walls.splice(this.before.index, 0, this.before.wall)
    return replaceLevel(model, { ...lv, walls })
  }
}

export class RelabelRoom implements Command {
  readonly label = 'Renombrar ambiente'
  private before: Room | null = null
  constructor(
    private readonly levelId: string,
    private readonly roomId: string,
    private readonly newLabel: string,
  ) {}
  execute(model: BuildingModel): BuildingModel {
    const lv = findLevel(model, this.levelId)
    const room = lv.rooms.find((r) => r.id === this.roomId)
    if (!room) throw new CommandError('El ambiente no existe')
    const clean = this.newLabel.trim()
    if (!clean) throw new CommandError('El nombre no puede estar vacío')
    this.before = room
    // un nombre puesto por una persona tiene confianza total
    return replaceLevel(model, upsertRoom(lv, { ...room, label: clean.slice(0, 60), confidence: 1 }))
  }
  undo(model: BuildingModel): BuildingModel {
    if (!this.before) return model
    const lv = findLevel(model, this.levelId)
    const current = lv.rooms.find((r) => r.id === this.roomId)
    if (!current) return model // el ambiente ya no existe (se recalculó sin él)
    // solo nombre y confianza: el polígono pudo recalcularse después del renombrado
    return replaceLevel(model, upsertRoom(lv, { ...current, label: this.before.label, confidence: this.before.confidence }))
  }
}

/**
 * Calibración: el usuario dice que la distancia entre `a` y `b` (en metros del
 * modelo actual) mide en realidad `meters`. Toda la planta se re-escala.
 */
export class CalibrateScale implements Command {
  readonly label = 'Calibrar escala'
  readonly factor: number
  private before: BuildingModel | null = null
  constructor(a: Point, b: Point, meters: number) {
    const current = wallLength({ start: a, end: b })
    if (current < 1e-3) throw new CommandError('La línea de calibración es demasiado corta')
    if (!(meters > 0)) throw new CommandError('La medida real debe ser positiva')
    this.factor = meters / current
  }
  execute(model: BuildingModel): BuildingModel {
    this.before = model
    return rescaleModel(model, this.factor)
  }
  undo(model: BuildingModel): BuildingModel {
    // la calibración afecta a todo el modelo: se restaura la versión exacta anterior
    return this.before ?? model
  }
}

/** Historial acotado de comandos: deshacer / rehacer. */
export class CommandHistory {
  private past: Command[] = []
  private future: Command[] = []
  constructor(private readonly limit = 100) {}

  execute(cmd: Command, model: BuildingModel): BuildingModel {
    const next = cmd.execute(model)
    this.past.push(cmd)
    if (this.past.length > this.limit) this.past.shift()
    this.future = []
    return next
  }

  undo(model: BuildingModel): BuildingModel {
    const cmd = this.past.pop()
    if (!cmd) return model
    this.future.push(cmd)
    return cmd.undo(model)
  }

  redo(model: BuildingModel): BuildingModel {
    const cmd = this.future.pop()
    if (!cmd) return model
    this.past.push(cmd)
    return cmd.execute(model)
  }

  /** Último comando aplicado (identifica la posición actual del historial). */
  get head(): Command | null {
    return this.past.at(-1) ?? null
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }
  get canRedo(): boolean {
    return this.future.length > 0
  }
  get undoLabel(): string | undefined {
    return this.past.at(-1)?.label
  }
  get redoLabel(): string | undefined {
    return this.future.at(-1)?.label
  }
  clear(): void {
    this.past = []
    this.future = []
  }
}


/**
 * Corrige el VALOR de una cota (lo que dice el plano). No mueve muros: eso lo hace el
 * ajuste a cotas (solver del servidor), que se aplica después con `ReplaceModel`.
 */
export class SetDimensionValue implements Command {
  readonly label = 'Corregir cota'
  private before: Dimension | null = null
  constructor(
    private readonly levelId: string,
    private readonly dimensionId: string,
    private readonly value: number,
  ) {
    if (!(value > 0) || !Number.isFinite(value)) throw new CommandError('La cota debe ser positiva')
  }
  execute(model: BuildingModel): BuildingModel {
    const lv = findLevel(model, this.levelId)
    const dims = lv.dimensions ?? []
    const d = dims.find((x) => x.id === this.dimensionId)
    if (!d) throw new CommandError('La cota no existe')
    this.before = d
    const text = this.value.toFixed(2).replace('.', ',')
    // la escribió una persona: confianza total y fuente manual; el solver dirá si cierra
    const next: Dimension = { ...d, value: this.value, text, source: 'manual', confidence: 1, status: 'inferred' }
    return replaceLevel(model, { ...lv, dimensions: dims.map((x) => (x.id === d.id ? next : x)) })
  }
  undo(model: BuildingModel): BuildingModel {
    if (!this.before) return model
    const lv = findLevel(model, this.levelId)
    const before = this.before
    return replaceLevel(model, {
      ...lv,
      dimensions: (lv.dimensions ?? []).map((x) => (x.id === before.id ? before : x)),
    })
  }
}

/** Reemplaza el modelo entero por uno calculado afuera (p. ej. el ajuste a cotas). */
export class ReplaceModel implements Command {
  private before: BuildingModel | null = null
  constructor(
    private readonly next: BuildingModel,
    readonly label = 'Ajuste a cotas',
  ) {}
  execute(model: BuildingModel): BuildingModel {
    this.before = model
    return this.next
  }
  undo(model: BuildingModel): BuildingModel {
    return this.before ?? model
  }
}

/**
 * Patrón Composite: varias ediciones que se aplican y se deshacen como UNA sola
 * entrada del historial (eliminar una selección, pegar un grupo...). Si una parte
 * falla, se revierten las anteriores y el modelo queda intacto.
 */
export class CompositeCommand implements Command {
  constructor(
    readonly label: string,
    private readonly parts: Command[],
  ) {
    if (parts.length === 0) throw new CommandError('No hay nada que hacer')
  }
  execute(model: BuildingModel): BuildingModel {
    let m = model
    const done: Command[] = []
    try {
      for (const c of this.parts) {
        m = c.execute(m)
        done.push(c)
      }
    } catch (e) {
      for (const c of done.reverse()) m = c.undo(m)
      throw e
    }
    return m
  }
  undo(model: BuildingModel): BuildingModel {
    return [...this.parts].reverse().reduce((m, c) => c.undo(m), model)
  }
}

/** Copias de muros (con sus aberturas) desplazadas y con ids nuevos: base de pegar y duplicar. */
export function cloneWalls(walls: Wall[], dx: number, dy: number): Wall[] {
  return walls.map((w) => ({
    ...w,
    id: newId('w'),
    start: { x: w.start.x + dx, y: w.start.y + dy },
    end: { x: w.end.x + dx, y: w.end.y + dy },
    openings: w.openings.map((o) => ({ ...o, id: newId('o') })),
    confidence: 1,
  }))
}

/** Inserta muros ya construidos (pegar / duplicar). */
export class InsertWalls implements Command {
  readonly label: string
  constructor(
    private readonly levelId: string,
    readonly walls: Wall[],
    label?: string,
  ) {
    if (walls.length === 0) throw new CommandError('No hay muros para insertar')
    walls.forEach((w) => checked(w))
    this.label = label ?? (walls.length === 1 ? 'Pegar muro' : `Pegar ${walls.length} muros`)
  }
  execute(model: BuildingModel): BuildingModel {
    const lv = findLevel(model, this.levelId)
    return replaceLevel(model, { ...lv, walls: [...lv.walls, ...this.walls] })
  }
  undo(model: BuildingModel): BuildingModel {
    const ids = new Set(this.walls.map((w) => w.id))
    const lv = findLevel(model, this.levelId)
    return replaceLevel(model, { ...lv, walls: lv.walls.filter((w) => !ids.has(w.id)) })
  }
}

/** Distancia mínima de una cota nueva (evita cotas de un clic). */
export const MIN_DIMENSION = 0.05
/** separación de la línea de cota respecto de lo que mide, en metros */
export const DIMENSION_OFFSET = 0.35

/**
 * Cota dibujada por la persona: mide la distancia actual entre dos puntos. Su valor
 * se puede corregir luego con la medida real (SetDimensionValue) y el ajuste a cotas
 * mueve el plano para que cierre.
 */
export class AddDimension implements Command {
  readonly label = 'Agregar cota'
  readonly dimension: Dimension
  constructor(
    private readonly levelId: string,
    a: Point,
    b: Point,
    /** muros que acota (informativo: el solver trabaja con los extremos) */
    wallIds: string[] = [],
  ) {
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (!(len >= MIN_DIMENSION)) throw new CommandError('La cota es demasiado corta')
    this.dimension = {
      id: newId('dim'),
      a,
      b,
      axis: 'aligned',
      offset: DIMENSION_OFFSET,
      value: len,
      measured: len,
      text: len.toFixed(2).replace('.', ','),
      source: 'manual',
      status: 'exact',
      confidence: 1,
      wall_ids: wallIds,
    }
  }
  execute(model: BuildingModel): BuildingModel {
    const lv = findLevel(model, this.levelId)
    return replaceLevel(model, { ...lv, dimensions: [...(lv.dimensions ?? []), this.dimension] })
  }
  undo(model: BuildingModel): BuildingModel {
    const lv = findLevel(model, this.levelId)
    return replaceLevel(model, { ...lv, dimensions: (lv.dimensions ?? []).filter((d) => d.id !== this.dimension.id) })
  }
}

export class DeleteDimension implements Command {
  readonly label = 'Eliminar cota'
  private before: { dim: Dimension; index: number } | null = null
  constructor(
    private readonly levelId: string,
    private readonly dimensionId: string,
  ) {}
  execute(model: BuildingModel): BuildingModel {
    const lv = findLevel(model, this.levelId)
    const dims = lv.dimensions ?? []
    const index = dims.findIndex((d) => d.id === this.dimensionId)
    if (index < 0) throw new CommandError('La cota no existe')
    this.before = { dim: dims[index]!, index }
    return replaceLevel(model, { ...lv, dimensions: dims.filter((d) => d.id !== this.dimensionId) })
  }
  undo(model: BuildingModel): BuildingModel {
    if (!this.before) return model
    const lv = findLevel(model, this.levelId)
    const dims = [...(lv.dimensions ?? [])]
    dims.splice(this.before.index, 0, this.before.dim)
    return replaceLevel(model, { ...lv, dimensions: dims })
  }
}

// ----------------------------------------------------------------------------- mobiliario y acabados (ADR-016)

type FurniturePatch = Partial<Pick<Furniture, 'position' | 'rotation' | 'width' | 'depth' | 'height'>>

function furnitureOf(level: Level): Furniture[] {
  return level.furniture ?? []
}

/** Coloca una pieza del catálogo con sus medidas de catálogo. */
export class AddFurniture implements Command {
  readonly label: string
  readonly furniture: Furniture
  constructor(
    private readonly levelId: string,
    catalogId: string,
    position: Point,
    rotation = 0,
  ) {
    const item = catalogItem(catalogId)
    if (!item) throw new CommandError(`No existe la pieza "${catalogId}" en el catálogo`)
    this.label = `Agregar ${item.name.toLowerCase()}`
    this.furniture = {
      id: newId('f'),
      catalog_id: item.id,
      position,
      rotation,
      width: item.width,
      depth: item.depth,
      height: item.height,
    }
  }
  execute(model: BuildingModel): BuildingModel {
    const lv = findLevel(model, this.levelId)
    return replaceLevel(model, { ...lv, furniture: [...furnitureOf(lv), this.furniture] })
  }
  undo(model: BuildingModel): BuildingModel {
    const lv = findLevel(model, this.levelId)
    return replaceLevel(model, { ...lv, furniture: furnitureOf(lv).filter((f) => f.id !== this.furniture.id) })
  }
}

/** Mover, girar o redimensionar un mueble. */
export class UpdateFurniture implements Command {
  private before: Furniture | null = null
  constructor(
    private readonly levelId: string,
    private readonly furnitureId: string,
    private readonly patch: FurniturePatch,
    readonly label = 'Mover mueble',
  ) {
    const dims = [patch.width, patch.depth, patch.height].filter((v) => v !== undefined)
    if (dims.some((v) => !(v! > 0) || !Number.isFinite(v))) throw new CommandError('Las medidas del mueble deben ser positivas')
  }
  execute(model: BuildingModel): BuildingModel {
    const lv = findLevel(model, this.levelId)
    const current = furnitureOf(lv).find((f) => f.id === this.furnitureId)
    if (!current) throw new CommandError('El mueble no existe')
    this.before = current
    const next = { ...current, ...this.patch }
    return replaceLevel(model, { ...lv, furniture: furnitureOf(lv).map((f) => (f.id === current.id ? next : f)) })
  }
  undo(model: BuildingModel): BuildingModel {
    const before = this.before
    if (!before) return model
    const lv = findLevel(model, this.levelId)
    return replaceLevel(model, { ...lv, furniture: furnitureOf(lv).map((f) => (f.id === before.id ? before : f)) })
  }
}

export class DeleteFurniture implements Command {
  readonly label = 'Eliminar mueble'
  private before: { f: Furniture; index: number } | null = null
  constructor(
    private readonly levelId: string,
    private readonly furnitureId: string,
  ) {}
  execute(model: BuildingModel): BuildingModel {
    const lv = findLevel(model, this.levelId)
    const list = furnitureOf(lv)
    const index = list.findIndex((f) => f.id === this.furnitureId)
    if (index < 0) throw new CommandError('El mueble no existe')
    this.before = { f: list[index]!, index }
    return replaceLevel(model, { ...lv, furniture: list.filter((f) => f.id !== this.furnitureId) })
  }
  undo(model: BuildingModel): BuildingModel {
    if (!this.before) return model
    const lv = findLevel(model, this.levelId)
    const list = [...furnitureOf(lv)]
    list.splice(this.before.index, 0, this.before.f)
    return replaceLevel(model, { ...lv, furniture: list })
  }
}

/** Acabado de uno o varios muros (pincel de materiales). */
export class SetWallMaterial implements Command {
  readonly label: string
  private before = new Map<string, string>()
  constructor(
    private readonly levelId: string,
    private readonly wallIds: string[],
    private readonly material: string,
  ) {
    if (wallIds.length === 0) throw new CommandError('No hay muros para pintar')
    this.label = wallIds.length === 1 ? 'Cambiar acabado del muro' : `Cambiar acabado de ${wallIds.length} muros`
  }
  execute(model: BuildingModel): BuildingModel {
    const lv = findLevel(model, this.levelId)
    const ids = new Set(this.wallIds)
    for (const id of ids) findWall(lv, id)
    this.before = new Map(lv.walls.filter((w) => ids.has(w.id)).map((w) => [w.id, w.material]))
    return replaceLevel(model, { ...lv, walls: lv.walls.map((w) => (ids.has(w.id) ? { ...w, material: this.material } : w)) })
  }
  undo(model: BuildingModel): BuildingModel {
    const lv = findLevel(model, this.levelId)
    return replaceLevel(model, {
      ...lv,
      walls: lv.walls.map((w) => (this.before.has(w.id) ? { ...w, material: this.before.get(w.id)! } : w)),
    })
  }
}

/** Acabado de piso de un ambiente (null = el de su tipo). */
export class SetFloorMaterial implements Command {
  readonly label = 'Cambiar piso del ambiente'
  private before: string | null | undefined
  constructor(
    private readonly levelId: string,
    private readonly roomId: string,
    private readonly material: string | null,
  ) {}
  execute(model: BuildingModel): BuildingModel {
    const lv = findLevel(model, this.levelId)
    const room = lv.rooms.find((r) => r.id === this.roomId)
    if (!room) throw new CommandError('El ambiente no existe')
    this.before = room.floor_material
    return replaceLevel(model, upsertRoom(lv, { ...room, floor_material: this.material }))
  }
  undo(model: BuildingModel): BuildingModel {
    const lv = findLevel(model, this.levelId)
    const room = lv.rooms.find((r) => r.id === this.roomId)
    if (!room) return model
    return replaceLevel(model, upsertRoom(lv, { ...room, floor_material: this.before ?? null }))
  }
}
