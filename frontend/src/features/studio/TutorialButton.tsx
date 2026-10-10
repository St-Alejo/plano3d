/**
 * Botón "Ver tutorial": abre un video corto grabado de la app real (e2e/tutorials,
 * `npm run tutorials`). Hay dos: editar un plano y crear uno desde cero.
 */
import * as Dialog from '@radix-ui/react-dialog'
import * as Tabs from '@radix-ui/react-tabs'
import { CirclePlay, X } from 'lucide-react'
import { useState } from 'react'
import clsx from 'clsx'

export type TutorialKind = 'editar' | 'crear' | 'recorrer'

const TUTORIALS: Record<TutorialKind, { title: string; src: string; summary: string }> = {
  editar: {
    title: 'Editar un plano',
    src: '/tutoriales/editar.webm',
    summary: 'Arrastra puertas y ventanas a otro muro, borra con Supr, agrega con las herramientas y afina en el panel. Ctrl+Z deshace.',
  },
  crear: {
    title: 'Crear desde cero',
    src: '/tutoriales/crear.webm',
    summary: 'Escribe en el chat «sala de 4x5, cocina de 3x3 al este de la sala…» o dibuja ambientes con la herramienta H.',
  },
  recorrer: {
    title: 'Recorrer en 3D',
    src: '/tutoriales/recorrer.webm',
    summary: 'Camina con W A S D o el joystick, abre puertas con E o el botón, sube escaleras caminando o con Q/Z, y usa el minimapa.',
  },
}

const SEEN_KEY = 'plano3d-tutorial-visto'

/** ¿Ya vio algún tutorial esta persona? (solo una comodidad: si falla el almacenamiento, se asume que no) */
function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}
function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* almacenamiento no disponible */
  }
}

export function TutorialButton({ initial = 'editar', compact = false, label = 'Ver tutorial' }: { initial?: TutorialKind; compact?: boolean; label?: string }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<TutorialKind>(initial)
  // la primera vez el botón llama la atención con un pulso suave
  const [fresh, setFresh] = useState(() => !seen())

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setTab(initial)
          markSeen()
          setFresh(false)
        }
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={clsx(
            'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-line-strong text-sm hover:border-accent',
            compact ? 'size-10 pointer-coarse:size-11' : 'h-10 px-3 pointer-coarse:h-11',
            fresh && 'animate-pulse border-brand text-brand',
          )}
        >
          <CirclePlay className="size-4" aria-hidden />
          {!compact && <span>{label}</span>}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-canvas/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(94vw,880px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line-strong bg-surface p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <Dialog.Title className="font-display text-lg font-semibold">Tutorial en video</Dialog.Title>
            <Dialog.Close aria-label="Cerrar" className="rounded p-1.5 text-muted hover:bg-raised hover:text-fg">
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>
          <Tabs.Root value={tab} onValueChange={(v) => setTab(v as TutorialKind)}>
            <Tabs.List aria-label="Tutoriales" className="mb-3 grid grid-cols-3 rounded-md border border-line p-0.5">
              {(Object.keys(TUTORIALS) as TutorialKind[]).map((k) => (
                <Tabs.Trigger key={k} value={k} className="h-9 rounded-sm text-xs sm:text-sm text-muted data-[state=active]:bg-raised data-[state=active]:text-fg">
                  {TUTORIALS[k].title}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            {(Object.keys(TUTORIALS) as TutorialKind[]).map((k) => (
              <Tabs.Content key={k} value={k}>
                <video
                  key={k}
                  src={TUTORIALS[k].src}
                  aria-label={`Video: ${TUTORIALS[k].title}`}
                  className="aspect-video w-full rounded-lg border border-line bg-black"
                  autoPlay
                  muted
                  loop
                  controls
                  playsInline
                />
                <Dialog.Description className="mt-2 text-sm text-muted">{TUTORIALS[k].summary}</Dialog.Description>
              </Tabs.Content>
            ))}
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
