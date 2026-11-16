/**
 * «Casa por pisos»: se sueltan los planos de todos los pisos a la vez (uno por imagen o PDF),
 * se revisa el orden que se leyó de los nombres y se crea la casa piso por piso.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowDown, ArrowUp, Building2, Check, Loader2, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '@/api/client'
import { Button, TextField } from '@/components/ui'
import { houseName, orderFloors, type FloorPlan } from '@/domain/houseFloors'
import { uploadHouse, type HouseStep } from './houseUpload'

const MAX_FLOORS = 6
const ACCEPT = 'image/*,application/pdf,.dxf'

type Phase = { kind: 'pick' } | { kind: 'working'; steps: HouseStep[] } | { kind: 'error'; message: string }

function renumber(list: FloorPlan<File>[]): FloorPlan<File>[] {
  // al mover a mano, los nombres siguen la posición (salvo sótano y azotea)
  const basement = list[0]?.name === 'Sótano'
  return list.map((f, i) =>
    f.name === 'Sótano' || f.name === 'Azotea' ? f : { ...f, name: `Piso ${basement ? i : i + 1}` },
  )
}

export function HouseUpload() {
  const [open, setOpen] = useState(false)
  const [floors, setFloors] = useState<FloorPlan<File>[]>([])
  const [name, setName] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' })
  const fileInput = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const navigate = useNavigate()
  const working = phase.kind === 'working'

  const pick = (files: FileList | null) => {
    if (!files?.length) return
    const all = [...floors.map((f) => f.file), ...Array.from(files)].slice(0, MAX_FLOORS)
    setFloors(orderFloors(all))
    setPhase({ kind: 'pick' })
  }

  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= floors.length) return
    const next = [...floors]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    setFloors(renumber(next))
  }

  const create = async () => {
    const steps: HouseStep[] = []
    setPhase({ kind: 'working', steps })
    try {
      const id = await uploadHouse(
        {
          createProject: (file, n) => api.createProject(file, n),
          getProject: (pid) => api.getProject(pid),
          addLevel: (pid, file, n, rev) => api.addLevel(pid, file, n, rev),
        },
        floors,
        houseName(name, floors.length),
        (s) => setPhase({ kind: 'working', steps: (steps.push(s), [...steps]) }),
      )
      setOpen(false)
      navigate(`/p/${id}/3d`)
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : 'No se pudo crear la casa' })
    }
  }

  const status = (i: number): 'wait' | 'reading' | 'done' => {
    if (phase.kind !== 'working') return 'wait'
    const last = [...phase.steps].reverse().find((s) => s.index === i)
    return last ? (last.kind === 'done' ? 'done' : 'reading') : 'wait'
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (working) return
        setOpen(o)
        if (!o) {
          setFloors([])
          setPhase({ kind: 'pick' })
        }
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-12 items-center gap-2 rounded-full border border-line-strong bg-surface px-6 font-medium shadow-xs transition-[border-color,box-shadow] hover:border-accent/50 hover:shadow-card"
        >
          <Building2 className="size-4" aria-hidden /> Casa por pisos
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-canvas/75 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[94dvh] w-[min(94vw,36rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl border border-line-strong bg-surface p-5 shadow-lift sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-display text-2xl leading-tight">Casa por pisos</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted">
                Sube un plano por piso. El orden sale del nombre del archivo («piso-1», «planta baja», «azotea»); puedes corregirlo con las flechas.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={working}
                className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-raised hover:text-fg disabled:opacity-40"
                aria-label="Cerrar"
              >
                <X className="size-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <label htmlFor={inputId} className="sr-only">
            Planos de los pisos
          </label>
          <input
            id={inputId}
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            onChange={(e) => {
              pick(e.target.files)
              e.target.value = ''
            }}
          />

          {floors.length === 0 ? (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                pick(e.dataTransfer.files)
              }}
              className="blueprint-grid mt-6 flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong text-muted hover:border-accent hover:text-fg"
            >
              <Building2 className="size-8" aria-hidden />
              Elige o suelta los planos (hasta {MAX_FLOORS})
            </button>
          ) : (
            <ol className="mt-6 flex flex-col-reverse gap-2" aria-label="Pisos, de abajo hacia arriba">
              {floors.map((f, i) => {
                const st = status(i)
                return (
                  <li key={`${f.file.name}-${i}`} className="flex items-center gap-3 rounded-lg border border-line bg-raised/50 px-3 py-2">
                    <span className="w-20 shrink-0 font-medium">{f.name}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted" title={f.file.name}>
                      {f.file.name}
                    </span>
                    {st === 'reading' && <Loader2 className="size-4 animate-spin text-accent" aria-label="Leyendo" />}
                    {st === 'done' && <Check className="size-4 text-ok" aria-label="Listo" />}
                    {phase.kind !== 'working' && (
                      <span className="flex gap-1">
                        <button type="button" className="grid size-9 place-items-center rounded-full hover:bg-surface disabled:opacity-30" onClick={() => move(i, 1)} disabled={i === floors.length - 1} aria-label={`Subir ${f.name}`}>
                          <ArrowUp className="size-4" aria-hidden />
                        </button>
                        <button type="button" className="grid size-9 place-items-center rounded-full hover:bg-surface disabled:opacity-30" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Bajar ${f.name}`}>
                          <ArrowDown className="size-4" aria-hidden />
                        </button>
                      </span>
                    )}
                  </li>
                )
              })}
            </ol>
          )}

          {floors.length > 0 && (
            <div className="mt-5 flex flex-col gap-4">
              <TextField label="Nombre de la casa" value={name} placeholder={houseName('', floors.length)} onChange={(e) => setName(e.target.value)} disabled={working} />
              {phase.kind === 'error' && (
                <p role="alert" className="text-sm text-danger">
                  {phase.message}
                </p>
              )}
              {working && (
                <p role="status" className="text-sm text-muted">
                  {(() => {
                    const s = phase.steps.at(-1)
                    return s ? `${s.kind === 'done' ? 'Listo' : 'Leyendo'}: ${s.floor} (${s.index + 1} de ${s.total})` : 'Subiendo…'
                  })()}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-3">
                {!working && floors.length < MAX_FLOORS && (
                  <Button variant="ghost" onClick={() => fileInput.current?.click()}>
                    Agregar otro piso
                  </Button>
                )}
                <Button variant="primary" onClick={() => void create()} loading={working}>
                  {working ? 'Creando…' : `Crear casa de ${floors.length} ${floors.length === 1 ? 'piso' : 'pisos'}`}
                </Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
