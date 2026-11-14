/**
 * "Fotos realistas": captura el modelo 3D desde cuatro tomas, las manda al servidor y
 * muestra las cinco fotos que devuelve la IA (calle, atardecer, otro costado, noche y
 * por dentro), con descarga de cada una o de todas.
 */
import * as Dialog from '@radix-ui/react-dialog'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Download, ImageOff, RotateCcw, Sparkles, X } from 'lucide-react'
import { useEffect, useState, type RefObject } from 'react'
import { api, ApiError } from '@/api/client'
import type { BuildingModel, Photo, PhotosStatus } from '@/api/types'
import { Button } from '@/components/ui'
import type { CaptureFn } from '../Viewer3D'
import { PHOTO_VIEWS, photoShots } from './shots'

type Phase = { kind: 'idle' } | { kind: 'working'; step: 'capturando' | 'generando' } | { kind: 'done' } | { kind: 'error'; message: string }

const usd = (v: number) => `US$${v.toFixed(2).replace('.', ',')}`

export interface PhotoStudioProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  fileBase: string
  facade: string
  model: BuildingModel
  captureRef: RefObject<CaptureFn | null>
  /** deja la escena lista para capturar (materiales, sin cortes ni pisos aislados) */
  prepare: () => Promise<void>
}

export function PhotoStudio({ open, onOpenChange, projectId, fileBase, facade, model, captureRef, prepare }: PhotoStudioProps) {
  const [status, setStatus] = useState<PhotosStatus | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [photos, setPhotos] = useState<Photo[]>([])
  const [failed, setFailed] = useState(0)
  const [current, setCurrent] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const busy = phase.kind === 'working'

  useEffect(() => {
    if (!open) return
    let alive = true
    api
      .photosStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setStatus({ available: false, remaining_usd: 0, cost_per_photo: 0 }))
    return () => {
      alive = false
    }
  }, [open])

  // reloj del "generando…": la IA tarda ~15 s y conviene que se vea que avanza
  useEffect(() => {
    if (!busy) return
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [busy])

  const shots = photoShots(model)
  const estimate = (status?.cost_per_photo ?? 0.02) * shots.length

  const generate = async () => {
    const capture = captureRef.current
    if (!capture) {
      setPhase({ kind: 'error', message: 'La vista 3D todavía no está lista; espera un momento' })
      return
    }
    setElapsed(0)
    setPhase({ kind: 'working', step: 'capturando' })
    try {
      await prepare()
      // la calle se captura una vez y sirve para la foto de día y la de noche
      const cache = new Map<string, Blob>()
      const images: { view: string; image: Blob }[] = []
      for (const { view, shot } of shots) {
        const key = JSON.stringify(shot)
        const blob = cache.get(key) ?? (await capture(shot))
        cache.set(key, blob)
        images.push({ view, image: blob })
      }
      setPhase({ kind: 'working', step: 'generando' })
      const res = await api.generatePhotos(projectId, images, facade)
      setPhotos(res.photos)
      setFailed(res.failed)
      setCurrent(0)
      setStatus((s) => (s ? { ...s, remaining_usd: res.remaining_usd } : s))
      setPhase({ kind: 'done' })
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof ApiError || e instanceof Error ? e.message : 'No se pudieron generar las fotos' })
    }
  }

  const download = (p: Photo) => {
    const a = document.createElement('a')
    a.href = p.image
    a.download = `${fileBase}_${p.view}.jpg`
    a.click()
  }
  const downloadAll = async () => {
    for (const p of photos) {
      download(p)
      // algunos navegadores frenan descargas seguidas sin una pausa corta
      await new Promise((r) => setTimeout(r, 250))
    }
  }

  const unavailable = status !== null && !status.available
  const shown = photos[current]

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-canvas/75 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[94dvh] w-[min(96vw,980px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl border border-line-strong bg-surface p-4 shadow-lift sm:p-6"
          onEscapeKeyDown={(e) => busy && e.preventDefault()}
          onPointerDownOutside={(e) => busy && e.preventDefault()}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-display text-2xl leading-tight">Fotos realistas de tu casa</Dialog.Title>
              <Dialog.Description className="mt-1 max-w-[60ch] text-sm text-muted">
                Tomamos tu modelo 3D desde {shots.length === 5 ? 'cinco' : shots.length} ángulos y la IA lo convierte en fotos: misma casa, mismos pisos y ventanas, con materiales y luz reales.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" disabled={busy} className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-raised hover:text-fg disabled:opacity-40" aria-label="Cerrar">
                <X className="size-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          {phase.kind === 'done' && shown ? (
            <div className="mt-5">
              <figure className="relative mx-auto max-w-[calc((94dvh-18rem)*1.5)] overflow-hidden rounded-lg bg-raised">
                <img src={shown.image} alt={`${shown.label}: foto generada con IA a partir del modelo 3D`} className="aspect-[3/2] w-full object-cover" />
                <figcaption className="t-label absolute bottom-3 left-3 rounded-full bg-black/55 px-3 py-1.5 text-xs text-white backdrop-blur-sm">
                  {shown.label} · {current + 1} / {photos.length}
                </figcaption>
                {photos.length > 1 && (
                  <>
                    <button type="button" onClick={() => setCurrent((i) => (i - 1 + photos.length) % photos.length)} aria-label="Foto anterior" className="absolute top-1/2 left-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm hover:bg-black/65">
                      <ChevronLeft className="size-5" aria-hidden />
                    </button>
                    <button type="button" onClick={() => setCurrent((i) => (i + 1) % photos.length)} aria-label="Foto siguiente" className="absolute top-1/2 right-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm hover:bg-black/65">
                      <ChevronRight className="size-5" aria-hidden />
                    </button>
                  </>
                )}
              </figure>
              <ul className="mt-3 grid grid-cols-5 gap-2" aria-label="Fotos generadas">
                {photos.map((p, i) => (
                  <li key={p.view}>
                    <button
                      type="button"
                      onClick={() => setCurrent(i)}
                      aria-current={i === current}
                      aria-label={p.label}
                      className={clsx('block w-full overflow-hidden rounded-md border-2 transition-colors', i === current ? 'border-brand' : 'border-transparent hover:border-line-strong')}
                    >
                      <img src={p.image} alt="" className="aspect-[3/2] w-full object-cover" />
                    </button>
                  </li>
                ))}
              </ul>
              {failed > 0 && (
                <p role="status" className="mt-3 text-sm text-muted">
                  {failed === 1 ? 'Una vista no salió' : `${failed} vistas no salieron`}; puedes volver a intentarlo.
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted">{status && `Quedan ${usd(status.remaining_usd)} del tope para fotos con IA`}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" onClick={() => void generate()} disabled={unavailable} icon={<RotateCcw className="size-4" aria-hidden />}>
                    Generar otras
                  </Button>
                  <Button onClick={() => download(shown)} icon={<Download className="size-4" aria-hidden />}>
                    Descargar esta
                  </Button>
                  <Button variant="primary" onClick={() => void downloadAll()} icon={<Download className="size-4" aria-hidden />}>
                    Descargar las {photos.length}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-5">
              <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Vistas que se van a generar">
                {PHOTO_VIEWS.filter((v) => shots.some((s) => s.view === v.view)).map((v, i) => (
                  <li key={v.view} className={clsx('relative flex aspect-[3/2] items-end overflow-hidden rounded-md border border-line bg-raised p-2', busy && 'animate-pulse')}>
                    <span className="t-label text-[0.68rem] text-muted">
                      <span className="font-mono">{String(i + 1).padStart(2, '0')}</span> {v.label}
                    </span>
                  </li>
                ))}
              </ol>
              <div aria-live="polite" className="mt-4 min-h-6 text-sm">
                {phase.kind === 'working' && (
                  <p className="text-muted">
                    {phase.step === 'capturando' ? 'Tomando las vistas del modelo…' : `La IA está creando las fotos… ${elapsed} s (suele tardar entre 15 y 40 s)`}
                  </p>
                )}
                {phase.kind === 'error' && (
                  <p role="alert" className="flex items-center gap-2 text-danger">
                    <ImageOff className="size-4 shrink-0" aria-hidden />
                    {phase.message}
                  </p>
                )}
                {unavailable && phase.kind !== 'working' && (
                  <p className="text-muted">{status.cost_per_photo === 0 ? 'Las fotos con IA no están configuradas en este servidor.' : 'Se acabó el presupuesto para fotos con IA.'}</p>
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted">
                  {status?.available ? `Costo aproximado ${usd(estimate)} · quedan ${usd(status.remaining_usd)} del tope` : ' '}
                </p>
                <Button variant="primary" size="lg" onClick={() => void generate()} loading={busy} disabled={unavailable || status === null} icon={<Sparkles className="size-4" aria-hidden />}>
                  {phase.kind === 'error' ? 'Intentar de nuevo' : `Generar ${shots.length} fotos`}
                </Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
