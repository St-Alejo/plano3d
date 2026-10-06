/**
 * Store central (Zustand): el BuildingModel es la única fuente de verdad.
 * El editor 2D y el visor 3D se suscriben al mismo estado (Observer), así
 * cualquier edición en 2D se ve al instante en 3D.
 *
 * Los ambientes son DERIVADOS: después de cada cambio de muros (incluido deshacer)
 * se recalculan desde la geometría, conservando nombres por superposición.
 */
import { create } from 'zustand'
import type { BuildingModel, Room } from '@/api/types'
import { CommandError, CommandHistory, type Command } from '@/domain/commands'
import { recomputeRooms } from '@/domain/rooms'

export type Tool = 'select' | 'wall' | 'door' | 'window' | 'calibrate' | 'measure'

export type Selection =
  | { kind: 'wall'; id: string }
  | { kind: 'opening'; id: string; wallId: string }
  | { kind: 'room'; id: string }
  | { kind: 'dimension'; id: string }
  | null

export const GRID_STEPS = [0, 0.01, 0.05, 0.1] as const

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
  selection: Selection
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
  select: (sel: Selection) => void
  markSaved: (revision?: number) => void
  setGridStep: (step: number) => void
  toggleDimensions: () => void
  clearError: () => void
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
  error: null,
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
      if (model) apply(history.undo(model), { selection: null })
    },

    redo: () => {
      const { model } = get()
      if (model) apply(history.redo(model), { selection: null })
    },

    setTool: (tool) => set({ tool, selection: tool === 'select' ? get().selection : null }),
    select: (selection) => set({ selection }),
    markSaved: (revision) => set({ savedHead: get().head, ...(revision !== undefined ? { revision } : {}) }),
    setGridStep: (gridStep) => set({ gridStep }),
    toggleDimensions: () => set({ showDimensions: !get().showDimensions }),
    clearError: () => set({ error: null }),
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
