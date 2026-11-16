/**
 * «Abrir en escritorio»: pide un código de un solo uso (2 min) y abre la app instalada con
 * `plano3d://open?project=…&code=…`. La app canjea el código por la sesión y abre el proyecto.
 * Si la app no está instalada, el mismo código se escribe a mano después de instalarla.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { Download, Monitor, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '@/api/client'
import { Button } from '@/components/ui'
import { deepLink } from './release'

export interface OpenInDesktopProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

type CodeState = { status: 'idle' | 'loading' } | { status: 'ready'; code: string; issued: number; until: number } | { status: 'error'; message: string }

/** Segundos que le quedan al código (el reloj arranca cuando llegó, no al abrir el diálogo). */
function useCountdown(issued: number | null, until: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until === null) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [until])
  return until === null || issued === null ? 0 : Math.max(0, Math.ceil((until - Math.max(now, issued)) / 1000))
}

export function OpenInDesktop({ open, onOpenChange, projectId }: OpenInDesktopProps) {
  const [state, setState] = useState<CodeState>({ status: 'idle' })
  const left = useCountdown(state.status === 'ready' ? state.issued : null, state.status === 'ready' ? state.until : null)

  const request = useCallback(() => {
    setState({ status: 'loading' })
    api.auth
      .linkCode()
      .then((c) => {
        const issued = Date.now()
        setState({ status: 'ready', code: c.code, issued, until: issued + c.expires_in * 1000 })
      })
      .catch(() => setState({ status: 'error', message: 'No se pudo pedir el código. Revisa la conexión e inténtalo otra vez.' }))
  }, [])

  const change = (next: boolean) => {
    if (!next) setState({ status: 'idle' })
    onOpenChange(next)
  }

  // al abrirse (lo abre el botón de fuera) se pide el código
  useEffect(() => {
    if (open && state.status === 'idle') {
      const t = window.setTimeout(request, 0)
      return () => window.clearTimeout(t)
    }
  }, [open, state.status, request])

  const expired = state.status === 'ready' && left === 0
  const minutes = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`

  return (
    <Dialog.Root open={open} onOpenChange={change}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-canvas/75 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[94dvh] w-[min(94vw,34rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl border border-line-strong bg-surface p-5 shadow-lift sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-display text-2xl leading-tight">Abrir en la app de escritorio</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted">
                Con tu sesión y en este proyecto: gráficos altos, recorrido y render con Blender. Lo que cambies allá se ve aquí al instante.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-raised hover:text-fg" aria-label="Cerrar">
                <X className="size-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          {state.status === 'error' && (
            <p role="alert" className="mt-6 text-sm text-danger">
              {state.message}
            </p>
          )}

          {(state.status === 'loading' || state.status === 'idle') && <div className="mt-6 h-40 animate-pulse rounded-lg bg-raised" aria-label="Pidiendo el código" />}

          {state.status === 'ready' && (
            <>
              <a
                href={expired ? undefined : deepLink(projectId, state.code)}
                aria-disabled={expired}
                className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand px-6 font-medium text-brand-ink shadow-card transition-[filter,transform] duration-200 hover:-translate-y-0.5 hover:brightness-110 aria-disabled:pointer-events-none aria-disabled:opacity-50"
              >
                <Monitor className="size-4" aria-hidden /> Abrir Plano 3D
              </a>
              <div className="mt-6 rounded-lg border border-line bg-raised/60 p-4">
                <p className="text-sm text-muted">¿No se abrió? Instálala y, en su pantalla de entrada, escribe este código y pulsa «Usar código»:</p>
                <p className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
                  <output aria-label="Código para la app" className="font-mono text-3xl font-semibold tracking-[0.3em]">
                    {state.code}
                  </output>
                  <span className="font-mono text-xs text-subtle" aria-live="polite">
                    {expired ? 'venció' : `vence en ${minutes}`}
                  </span>
                </p>
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <Link to="/escritorio" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-fg hover:underline">
                  <Download className="size-4" aria-hidden /> Descargar para Windows
                </Link>
                <Button variant={expired ? 'primary' : 'ghost'} onClick={request} icon={<RefreshCw className="size-4" aria-hidden />}>
                  Otro código
                </Button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
