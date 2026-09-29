/**
 * Store central (Zustand): el BuildingModel es la única fuente de verdad.
 * El editor 2D y el visor 3D se suscriben al mismo estado (Observer), así
 * cualquier edición en 2D se ve al instante en 3D.
 */
import { create } from 'zustand'
import type { BuildingModel } from '@/api/types'
import { CommandError, CommandHistory, type Command } from '@/domain/commands'

export type Tool = 'select' | 'wall' | 'door' | 'window' | 'calibrate'

export type Selection =
  | { kind: 'wall'; id: string }
  | { kind: 'opening'; id: string; wallId: string }
  | { kind: 'room'; id: string }
  | null

interface EditorState {
  projectId: string | null
  model: BuildingModel | null
  /** posición del historial actual y la que está guardada en el servidor */
  head: Command | null
  savedHead: Command | null
  levelId: string
  tool: Tool
  selection: Selection
  error: string | null
  canUndo: boolean
  canRedo: boolean
  undoLabel?: string
  redoLabel?: string

  load: (projectId: string, model: BuildingModel) => void
  dispatch: (cmd: Command) => boolean
  undo: () => void
  redo: () => void
  setTool: (tool: Tool) => void
  select: (sel: Selection) => void
  markSaved: () => void
  clearError: () => void
  reset: () => void
}

const history = new CommandHistory()

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
  savedHead: null,
  levelId: 'lvl_0',
  tool: 'select' as Tool,
  selection: null,
  error: null,
}

export const useEditor = create<EditorState>()((set, get) => ({
  ...initial,
  ...flags(),

  load: (projectId, model) => {
    history.clear()
    set({ ...initial, projectId, model, levelId: model.levels[0]?.id ?? 'lvl_0', ...flags() })
  },

  dispatch: (cmd) => {
    const { model } = get()
    if (!model) return false
    try {
      set({ model: history.execute(cmd, model), error: null, ...flags() })
      return true
    } catch (e) {
      set({ error: e instanceof CommandError || e instanceof Error ? e.message : 'Edición inválida' })
      return false
    }
  },

  undo: () => {
    const { model } = get()
    if (model) set({ model: history.undo(model), selection: null, ...flags() })
  },

  redo: () => {
    const { model } = get()
    if (model) set({ model: history.redo(model), selection: null, ...flags() })
  },

  setTool: (tool) => set({ tool, selection: tool === 'select' ? get().selection : null }),
  select: (selection) => set({ selection }),
  markSaved: () => set({ savedHead: get().head }),
  clearError: () => set({ error: null }),
  reset: () => {
    history.clear()
    set({ ...initial, ...flags() })
  },
}))

/** Hay cambios si la posición del historial difiere de la guardada (deshacer hasta ahí = limpio). */
export const selectIsDirty = (s: EditorState): boolean => s.head !== s.savedHead

export const selectLevel = (s: EditorState) => s.model?.levels.find((l) => l.id === s.levelId) ?? null
