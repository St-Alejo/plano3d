/**
 * Store central (Zustand): el BuildingModel es la única fuente de verdad.
 * El editor 2D y el visor 3D se suscriben al mismo estado (Observer), así
 * cualquier edición en 2D se ve al instante en 3D.
 *
 * Los ambientes son DERIVADOS: después de cada cambio de muros (incluido deshacer)
 * se recalculan desde la geometría, conservando nombres por superposición.
 */
import { create } from 'zustand'
import type { BuildingModel, Point, Room, Wall } from '@/api/types'
import { CommandError, CommandHistory, type Command } from '@/domain/commands'
import { recomputeRooms } from '@/domain/rooms'

export type Tool = 'select' | 'room' | 'wall' | 'door' | 'window' | 'calibrate' | 'measure' | 'dimension' | 'paint'

export type Selection =
  | { kind: 'wall'; id: string }
  | { kind: 'opening'; id: string; wallId: string }
  | { kind: 'room'; id: string }
  | { kind: 'dimension'; id: string }
  | { kind: 'furniture'; id: string }
  | { kind: 'column'; id: string }
  | { kind: 'stair'; id: string }
  | null

export type Selected = NonNullable<Selection>

/** Capas del plano que se pueden ocultar o bloquear (bloqueada = visible pero no seleccionable). */
export type LayerKey = 'image' | 'rooms' | 'walls' | 'openings' | 'dimensions' | 'furniture'

export type ViewMode = '2d' | 'split' | '3d'

export const GRID_STEPS = [0, 0.01, 0.05, 0.1] as const

export const sameSelected = (a: Selected, b: Selected): boolean => a.kind === b.kind && a.id === b.id

interface EditorState {
  projectId: string | null
  model: BuildingModel | null
  /** revisión del servidor sobre la que se está editando (va en If-Match al guardar) */
  revision: number
  /** posición del historial actual y la que está guardada en el servidor */
  head: Command | null
  savedHead: Command | null
  levelId: string
  tool: Tool
  /** elemento principal (el que muestra el inspector) */
  selection: Selection
  /** todos los seleccionados; `selection` es el último de este grupo */
  group: Selected[]
  clipboard: Wall[]
  hiddenLayers: ReadonlySet<LayerKey>
  lockedLayers: ReadonlySet<LayerKey>
  viewMode: ViewMode
  /** posición del puntero sobre el plano, en metros (barra de estado) */
  cursor: Point | null
  /** zoom del editor 2D relativo al encuadre (1 = plano completo) */
  zoom: number
  /** acabados que aplica el pincel (herramienta "Pintar") */
  brush: { wall: string; floor: string }
  error: string | null
  gridStep: number
  showDimensions: boolean
  canUndo: boolean
  canRedo: boolean
  undoLabel?: string
  redoLabel?: string

  load: (projectId: string, model: BuildingModel, revision?: number) => void
  dispatch: (cmd: Command) => boolean
  undo: () => void
  redo: () => void
  setTool: (tool: Tool) => void
  /** cambia la planta que se edita (láminas con varios niveles) */
  setLevel: (levelId: string) => void
  select: (sel: Selection) => void
  /** Shift+clic: agrega o quita del grupo */
  toggleSelect: (sel: Selected) => void
  selectMany: (items: Selected[]) => void
  setClipboard: (walls: Wall[]) => void
  toggleLayer: (layer: LayerKey, which: 'hidden' | 'locked') => void
  setViewMode: (mode: ViewMode) => void
  setPointer: (cursor: Point | null, zoom?: number) => void
  setBrush: (brush: Partial<{ wall: string; floor: string }>) => void
  /**
   * Marca como guardada la posición `head` del historial (por defecto la actual). Al
   * guardar en segundo plano hay que pasar la posición que se envió: lo editado mientras
   * viajaba la petición sigue pendiente.
   */
  markSaved: (revision?: number, head?: Command | null) => void
  setGridStep: (step: number) => void
  toggleDimensions: () => void
  clearError: () => void
  /** aviso al usuario que no viene de un comando (p. ej. "no cabe") */
  setError: (message: string) => void
  /** sube cada vez que se pide reencuadrar el plano (p. ej. tras dibujar con el chat) */
  fitRequest: number
  requestFit: () => void
  reset: () => void
}

const history = new CommandHistory()

/** Todos los ambientes vistos (por id): permite recuperar nombres al deshacer una edición que los borró. */
const roomMemory = new Map<string, Room>()

function remember(model: BuildingModel): void {
  for (const lv of model.levels) for (const r of lv.rooms) roomMemory.set(r.id, r)
}

/** Recalcula los ambientes de los niveles cuyos muros cambiaron. */
export function withDerivedRooms(prev: BuildingModel, next: BuildingModel): BuildingModel {
  let changed = false
  const levels = next.levels.map((lv) => {
    const before = prev.levels.find((l) => l.id === lv.id)
    if (before && before.walls === lv.walls) return lv
    changed = true
    // candidatos: los ambientes actuales primero y luego los recordados
    const known = [...lv.rooms, ...[...roomMemory.values()].filter((r) => !lv.rooms.some((x) => x.id === r.id))]
    return { ...lv, rooms: recomputeRooms({ ...lv, rooms: known }) }
  })
  return changed ? { ...next, levels } : next
}

const flags = () => ({
  head: history.head,
  canUndo: history.canUndo,
  canRedo: history.canRedo,
  undoLabel: history.undoLabel,
  redoLabel: history.redoLabel,
})

const initial = {
  projectId: null,
  model: null,
  revision: 0,
  savedHead: null,
  levelId: 'lvl_0',
  tool: 'select' as Tool,
  selection: null,
  group: [] as Selected[],
  error: null,
}

const toggled = <T,>(set: ReadonlySet<T>, v: T): ReadonlySet<T> => {
  const next = new Set(set)
  if (next.has(v)) next.delete(v)
  else next.add(v)
  return next
}

export const useEditor = create<EditorState>()((set, get) => {
  const apply = (next: BuildingModel, extra: Partial<EditorState> = {}) => {
    const prev = get().model
    const model = prev ? withDerivedRooms(prev, next) : next
    remember(model)
    set({ model, ...extra, ...flags() })
  }

  return {
    ...initial,
    gridStep: 0.05,
    showDimensions: true,
    clipboard: [],
    hiddenLayers: new Set<LayerKey>(),
    lockedLayers: new Set<LayerKey>(),
    viewMode: 'split',
    cursor: null,
    zoom: 1,
    brush: { wall: 'ladrillo', floor: 'madera_roble' },
    ...flags(),

    load: (projectId, model, revision = 0) => {
      history.clear()
      roomMemory.clear()
      remember(model)
      set({ ...initial, projectId, model, revision, levelId: model.levels[0]?.id ?? 'lvl_0', ...flags() })
    },

    dispatch: (cmd) => {
      const { model } = get()
      if (!model) return false
      try {
        apply(history.execute(cmd, model), { error: null })
        return true
      } catch (e) {
        set({ error: e instanceof CommandError || e instanceof Error ? e.message : 'Edición inválida' })
        return false
      }
    },

    undo: () => {
      const { model } = get()
      if (model) apply(history.undo(model), { selection: null, group: [] })
    },

    redo: () => {
      const { model } = get()
      if (model) apply(history.redo(model), { selection: null, group: [] })
    },

    setTool: (tool) => (tool === 'select' ? set({ tool }) : set({ tool, selection: null, group: [] })),
    setLevel: (levelId) => {
      const { model } = get()
      if (model?.levels.some((l) => l.id === levelId)) set({ levelId, selection: null, group: [] })
    },
    select: (selection) => set({ selection, group: selection ? [selection] : [] }),
    toggleSelect: (sel) => {
      const { group } = get()
      const next = group.some((g) => sameSelected(g, sel)) ? group.filter((g) => !sameSelected(g, sel)) : [...group, sel]
      set({ group: next, selection: next.at(-1) ?? null })
    },
    selectMany: (items) => set({ group: items, selection: items.at(-1) ?? null }),
    setClipboard: (clipboard) => set({ clipboard }),
    toggleLayer: (layer, which) =>
      which === 'hidden'
        ? set({ hiddenLayers: toggled(get().hiddenLayers, layer) })
        : set({ lockedLayers: toggled(get().lockedLayers, layer) }),
    setViewMode: (viewMode) => set({ viewMode }),
    setPointer: (cursor, zoom) => set(zoom === undefined ? { cursor } : { cursor, zoom }),
    setBrush: (brush) => set({ brush: { ...get().brush, ...brush } }),
    markSaved: (revision, head) =>
      set({ savedHead: head === undefined ? get().head : head, ...(revision !== undefined ? { revision } : {}) }),
    setGridStep: (gridStep) => set({ gridStep }),
    toggleDimensions: () => set({ showDimensions: !get().showDimensions }),
    clearError: () => set({ error: null }),
    setError: (message) => set({ error: message }),
    fitRequest: 0,
    requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
    reset: () => {
      history.clear()
      roomMemory.clear()
      set({ ...initial, ...flags() })
    },
  }
})

/** Hay cambios si la posición del historial difiere de la guardada (deshacer hasta ahí = limpio). */
export const selectIsDirty = (s: EditorState): boolean => s.head !== s.savedHead

export const selectLevel = (s: EditorState) => s.model?.levels.find((l) => l.id === s.levelId) ?? null
