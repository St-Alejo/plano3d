/**
 * Crea una casa de varios pisos con un plano por piso: el primero crea el proyecto, se espera
 * a que termine de leerse y los demás se apilan encima, uno a uno y en orden.
 */
import type { FloorPlan } from '@/domain/houseFloors'

interface ProjectState {
  status: string
  revision: number
  error?: string | null
}

export interface HouseUploadDeps {
  createProject: (file: File, name: string) => Promise<{ id: string }>
  getProject: (id: string) => Promise<ProjectState>
  addLevel: (id: string, file: File, name: string, revision: number) => Promise<ProjectState>
  sleep?: (ms: number) => Promise<void>
}

export type HouseStep =
  | { kind: 'reading'; floor: string; index: number; total: number }
  | { kind: 'done'; floor: string; index: number; total: number }

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Espera a que el primer plano termine de leerse (o falle). */
async function untilReady(deps: HouseUploadDeps, id: string, timeoutMs: number): Promise<ProjectState> {
  const sleep = deps.sleep ?? wait
  const start = Date.now()
  for (let delay = 800; ; delay = Math.min(delay * 1.4, 3000)) {
    const p = await deps.getProject(id)
    if (p.status === 'ready') return p
    if (p.status === 'failed') throw new Error(p.error || 'No se pudo leer el primer plano')
    if (Date.now() - start > timeoutMs) throw new Error('El primer plano tarda demasiado en leerse')
    await sleep(delay)
  }
}

/** Sube la casa; devuelve el id del proyecto. `onStep` cuenta el avance piso por piso. */
export async function uploadHouse(
  deps: HouseUploadDeps,
  floors: readonly FloorPlan<File>[],
  name: string,
  onStep: (s: HouseStep) => void = () => {},
  timeoutMs = 180_000,
): Promise<string> {
  if (floors.length === 0) throw new Error('Agrega al menos un plano')
  const total = floors.length
  const [first, ...rest] = floors
  onStep({ kind: 'reading', floor: first!.name, index: 0, total })
  const { id } = await deps.createProject(first!.file, name)
  let project = await untilReady(deps, id, timeoutMs)
  onStep({ kind: 'done', floor: first!.name, index: 0, total })
  for (const [k, f] of rest.entries()) {
    onStep({ kind: 'reading', floor: f.name, index: k + 1, total })
    project = await deps.addLevel(id, f.file, f.name, project.revision)
    onStep({ kind: 'done', floor: f.name, index: k + 1, total })
  }
  return id
}
