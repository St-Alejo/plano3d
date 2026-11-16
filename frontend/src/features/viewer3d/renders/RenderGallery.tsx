/**
 * Renders de Blender: las imágenes fotorrealistas que la app de escritorio hace con Cycles
 * en la GPU del usuario y sube al proyecto. Aparecen aquí al instante, sin recargar.
 */
import * as Dialog from '@radix-ui/react-dialog'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Download, Monitor, X } from 'lucide-react'
import { useState } from 'react'
import type { RenderInfo } from '@/api/types'
import { Button } from '@/components/ui'
import { useRenders, useRenderUrl } from './useRenders'

export interface RenderGalleryProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  fileBase: string
}

const QUALITY: Record<string, string> = { borrador: 'Borrador', final: 'Final', alta: 'Alta calidad' }
const HOUR: Record<string, string> = { dia: 'De día', atardecer: 'Atardecer', noche: 'De noche' }

function describe(r: RenderInfo): string {
  const bits = [QUALITY[r.quality] ?? r.quality, HOUR[r.hour] ?? r.hour, r.width && r.height ? `${r.width}×${r.height}` : '']
  return bits.filter(Boolean).join(' · ')
}

function when(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}

function Thumb({ projectId, render, active, onPick }: { projectId: string; render: RenderInfo; active: boolean; onPick: () => void }) {
  const url = useRenderUrl(projectId, render.id)
  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={active}
      aria-label={render.label}
      className={clsx('block w-full overflow-hidden rounded-md border-2 bg-raised transition-colors', active ? 'border-brand' : 'border-transparent hover:border-line-strong')}
    >
      {url ? <img src={url} alt="" className="aspect-[16/9] w-full object-cover" /> : <span className="block aspect-[16/9] w-full animate-pulse" />}
    </button>
  )
}

export function RenderGallery({ open, onOpenChange, projectId, fileBase }: RenderGalleryProps) {
  const { renders, error, fresh } = useRenders(projectId, open)
  // lo elegido vale hasta que llega uno nuevo en vivo: entonces se muestra ese
  const [pick, setPick] = useState<{ id: string; fresh: string | null } | null>(null)
  const setCurrent = (id: string) => setPick({ id, fresh })
  const list = renders ?? []
  const ordered = [...list].reverse() // lo más nuevo primero en la tira
  const picked = pick && pick.fresh === fresh && list.some((r) => r.id === pick.id) ? pick.id : null
  const shownId = picked ?? fresh ?? ordered[0]?.id
  const shown = list.find((r) => r.id === shownId)
  const url = useRenderUrl(projectId, shown?.id)
  const index = ordered.findIndex((r) => r.id === shownId)

  const step = (d: number) => {
    const next = ordered[(index + d + ordered.length) % ordered.length]
    if (next) setCurrent(next.id)
  }

  const download = () => {
    if (!url || !shown) return
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileBase}-${shown.label.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi, '-')}.${shown.media_type === 'image/png' ? 'png' : 'jpg'}`
    a.click()
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-canvas/75 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[94dvh] w-[min(96vw,1080px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl border border-line-strong bg-surface p-4 shadow-lift sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-display text-2xl leading-tight">Renders de Blender</Dialog.Title>
              <Dialog.Description className="mt-1 max-w-[62ch] text-sm text-muted">
                Imágenes fotorrealistas hechas con Cycles en la app de escritorio. Cada render nuevo aparece aquí en cuanto termina.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-raised hover:text-fg" aria-label="Cerrar">
                <X className="size-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          {error ? (
            <p role="alert" className="mt-6 text-sm text-danger">
              {error}
            </p>
          ) : renders === null ? (
            <div className="mt-5 aspect-[16/9] w-full animate-pulse rounded-lg bg-raised" aria-label="Cargando la galería" />
          ) : !shown ? (
            <div className="mt-5 grid place-items-center gap-3 rounded-lg border border-dashed border-line-strong px-6 py-14 text-center">
              <Monitor className="size-8 text-muted" aria-hidden />
              <p className="font-display text-xl">Todavía no hay renders</p>
              <p className="max-w-[52ch] text-sm text-muted">
                Abre este proyecto en la app de escritorio y usa <strong className="text-fg">Render</strong>: Blender lo pinta con luz real en tu tarjeta de video y la imagen llega aquí sola.
              </p>
            </div>
          ) : (
            <div className="mt-5">
              <figure className="relative mx-auto overflow-hidden rounded-lg bg-raised">
                {url ? (
                  <img src={url} alt={`${shown.label}: render de Blender`} className="max-h-[max(14rem,calc(94dvh-19rem))] w-full object-contain" />
                ) : (
                  <span className="block aspect-[16/9] w-full animate-pulse" />
                )}
                <figcaption className="t-label absolute bottom-3 left-3 rounded-full bg-black/55 px-3 py-1.5 text-xs text-white backdrop-blur-sm">
                  {shown.label} · {index + 1} / {ordered.length}
                  {shown.id === fresh && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-[0.65rem] text-white">Nuevo</span>}
                </figcaption>
                {ordered.length > 1 && (
                  <>
                    <button type="button" onClick={() => step(-1)} aria-label="Render anterior" className="absolute top-1/2 left-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm hover:bg-black/65">
                      <ChevronLeft className="size-5" aria-hidden />
                    </button>
                    <button type="button" onClick={() => step(1)} aria-label="Render siguiente" className="absolute top-1/2 right-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm hover:bg-black/65">
                      <ChevronRight className="size-5" aria-hidden />
                    </button>
                  </>
                )}
              </figure>
              {ordered.length > 1 && (
                <ul className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6" aria-label="Renders del proyecto">
                  {ordered.map((r) => (
                    <li key={r.id}>
                      <Thumb projectId={projectId} render={r} active={r.id === shownId} onPick={() => setCurrent(r.id)} />
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted">
                  {describe(shown)}
                  {when(shown.created_at) && <span> · {when(shown.created_at)}</span>}
                </p>
                <Button variant="primary" onClick={download} disabled={!url} icon={<Download className="size-4" aria-hidden />}>
                  Descargar
                </Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
