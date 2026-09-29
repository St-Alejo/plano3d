/**
 * Patrón Command: cada edición del editor es un objeto con `execute` y `undo`.
 *
 * Como el modelo es inmutable, cada comando guarda la versión anterior de la
 * entidad que toca (no del modelo completo), así el historial es liviano y
 * deshacer una edición no pisa otras ediciones posteriores de otras entidades.
 */
import type { BuildingModel, Opening, OpeningKind, Point, Room, Wall } from '@/api/types'
import {
  DOOR,
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
  wallLength,
} from './model'

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

/** Desplaza el muro completo (flechas del teclado en el editor). */
export class TranslateWall extends WallEdit {
  readonly label = 'Mover muro'
  constructor(
    levelId: string,
    wallId: string,
    private readonly dx: number,
    private readonly dy: number,
  ) {
    super(levelId, wallId)
  }
  protected transform(w: Wall): Wall {
    const mv = (p: Point): Point => ({ x: p.x + this.dx, y: p.y + this.dy })
    return { ...w, start: mv(w.start), end: mv(w.end) }
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
    return replaceLevel(model, upsertRoom(findLevel(model, this.levelId), this.before))
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
