/**
 * Estado de la simulación "a lo Sims" (personas, carro, día y noche) compartido entre el
 * lienzo 3D, la barra, el panel Vista, el minimapa y el chat. Las preferencias se recuerdan
 * en este navegador; si el almacenamiento falla, se usan los valores por defecto.
 */
import { create } from 'zustand'

const KEY = 'plano3d-simulacion'

export interface SimPrefs {
  people: number
  car: boolean
  dayNight: boolean
  /** horas simuladas por cada 20 s reales */
  speed: number
}

/** Dónde está cada quien, para el minimapa (lo escribe el bucle unas veces por segundo). */
export interface SimMarks {
  people: { id: number; x: number; z: number; levelId: string; color: string }[]
  cars: { id: number; x: number; z: number; yaw: number; visible: boolean }[]
}

interface SimState extends SimPrefs {
  on: boolean
  paused: boolean
  hour: number
  night: boolean
  /** pisos ocultos por el foco de piso: ahí no se dibuja a nadie */
  hidden: string[]
  marks: SimMarks
  /** contador para "Llamar al carro" (el bucle lo compara con el último que atendió) */
  callNonce: number
  /** contador para reiniciar las personas (cambió el número o el modelo) */
  resetNonce: number
  setOn: (on: boolean) => void
  toggle: () => void
  setPaused: (p: boolean) => void
  setPeople: (n: number) => void
  setCar: (on: boolean) => void
  setDayNight: (on: boolean) => void
  setSpeed: (s: number) => void
  setHour: (h: number, night: boolean) => void
  setHidden: (ids: string[]) => void
  setMarks: (m: SimMarks) => void
  callCar: () => void
}

export const MAX_PEOPLE = 8
const DEFAULTS: SimPrefs = { people: 5, car: true, dayNight: true, speed: 1 }

function load(): SimPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const p = JSON.parse(raw) as Partial<SimPrefs>
    return {
      people: Math.max(0, Math.min(MAX_PEOPLE, Math.round(Number(p.people ?? DEFAULTS.people)))),
      car: p.car ?? DEFAULTS.car,
      dayNight: p.dayNight ?? DEFAULTS.dayNight,
      speed: [0.5, 1, 2, 4].includes(Number(p.speed)) ? Number(p.speed) : DEFAULTS.speed,
    }
  } catch {
    return DEFAULTS
  }
}

function save(s: SimPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ people: s.people, car: s.car, dayNight: s.dayNight, speed: s.speed }))
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

export const useSim = create<SimState>()((set, get) => {
  const persist = (patch: Partial<SimPrefs>) => {
    set(patch)
    save(get())
  }
  return {
    ...load(),
    on: false,
    paused: false,
    hour: 8,
    night: false,
    hidden: [],
    marks: { people: [], cars: [] },
    callNonce: 0,
    resetNonce: 0,
    setOn: (on) => set({ on, paused: false }),
    toggle: () => set((s) => ({ on: !s.on, paused: false })),
    setPaused: (paused) => set({ paused }),
    setPeople: (n) => {
      persist({ people: Math.max(0, Math.min(MAX_PEOPLE, Math.round(n))) })
      set((s) => ({ resetNonce: s.resetNonce + 1 }))
    },
    setCar: (car) => persist({ car }),
    setDayNight: (dayNight) => persist({ dayNight }),
    setSpeed: (speed) => persist({ speed }),
    setHour: (hour, night) => set({ hour, night }),
    setHidden: (ids) => {
      if (!sameList(get().hidden, ids)) set({ hidden: ids })
    },
    setMarks: (marks) => set({ marks }),
    callCar: () => set((s) => ({ callNonce: s.callNonce + 1, car: true })),
  }
})
