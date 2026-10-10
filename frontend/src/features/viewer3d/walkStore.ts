/**
 * Estado compartido del recorrido entre el lienzo 3D (física, animación) y la interfaz
 * HTML (botón de acción, piso actual, minimapa). El bucle de render escribe aquí a baja
 * frecuencia; la interfaz manda órdenes que el bucle consume (patrón Command).
 */
import { create } from 'zustand'

/** Lo que se tiene delante y con lo que se puede interactuar. */
export type Focus =
  | { kind: 'door'; id: string; open: boolean }
  | { kind: 'window'; id: string }
  | { kind: 'stair'; id: string; up: boolean }
  | null

/** Órdenes de la interfaz que ejecuta el bucle del recorrido. */
export type WalkCommand =
  | { type: 'act' }
  | { type: 'level'; dir: 1 | -1 }
  | { type: 'teleport'; x: number; z: number; levelId?: string }

export interface WalkHud {
  x: number
  z: number
  y: number
  /** rumbo de la mirada en planta (radianes, 0 = +x, sentido de la planta) */
  heading: number
  levelId: string
  levelIndex: number
  levelCount: number
  levelName: string
}

interface WalkState {
  /** puertas abiertas (meta de la animación); por defecto cerradas */
  doors: Record<string, boolean>
  autoDoors: boolean
  focus: Focus
  hud: WalkHud | null
  queue: WalkCommand[]
  lookSensitivity: number
  toggleDoor: (id: string) => void
  setDoor: (id: string, open: boolean) => void
  setAutoDoors: (on: boolean) => void
  setFocus: (f: Focus) => void
  setHud: (h: WalkHud) => void
  send: (c: WalkCommand) => void
  take: () => WalkCommand[]
  setLookSensitivity: (v: number) => void
  reset: () => void
}

const sameFocus = (a: Focus, b: Focus) =>
  a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id && JSON.stringify(a) === JSON.stringify(b))

export const useWalk = create<WalkState>()((set, get) => ({
  doors: {},
  autoDoors: false,
  focus: null,
  hud: null,
  queue: [],
  lookSensitivity: 1,
  toggleDoor: (id) => set((s) => ({ doors: { ...s.doors, [id]: !s.doors[id] } })),
  setDoor: (id, open) => {
    if (!!get().doors[id] !== open) set((s) => ({ doors: { ...s.doors, [id]: open } }))
  },
  setAutoDoors: (on) => set({ autoDoors: on }),
  setFocus: (f) => {
    if (!sameFocus(get().focus, f)) set({ focus: f })
  },
  setHud: (h) => set({ hud: h }),
  send: (c) => set((s) => ({ queue: [...s.queue, c] })),
  take: () => {
    const q = get().queue
    if (q.length) set({ queue: [] })
    return q
  },
  setLookSensitivity: (v) => set({ lookSensitivity: v }),
  reset: () => set({ doors: {}, focus: null, hud: null, queue: [] }),
}))
