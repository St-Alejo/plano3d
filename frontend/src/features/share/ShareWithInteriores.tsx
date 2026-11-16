/**
 * «Continuar en Interiores 3D» (ADR-024): un código que se pega en la otra app para diseñar
 * el interior de esta misma casa, en vivo. La arquitectura se queda aquí; allá se amuebla.
 * El código vale hasta revocarlo; la lista muestra qué códigos siguen activos.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { Check, Copy, ExternalLink, Plus, Sofa, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, type Share } from '@/api/client'
import { Button } from '@/components/ui'
import { interioresUrl } from './interiores'

export interface ShareWithInterioresProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

type State = { status: 'loading' } | { status: 'ready'; shares: Share[] } | { status: 'error'; message: string }

const when = (iso: string) => new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setDone(true)
      window.setTimeout(() => setDone(false), 1800)
    })
  }
  return (
    <Button variant="ghost" onClick={copy} icon={done ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}>
      {done ? 'Copiado' : 'Copiar'}
    </Button>
  )
}

export function ShareWithInteriores({ open, onOpenChange, projectId }: ShareWithInterioresProps) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [busy, setBusy] = useState(false)

  const fail = (message: string) => setState({ status: 'error', message })

  /** Al abrir: los códigos activos; si no hay ninguno, se crea el primero. */
  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const shares = await api.shares.list(projectId)
      setState({ status: 'ready', shares: shares.length ? shares : [await api.shares.create(projectId)] })
    } catch {
      fail('No se pudo pedir el código. Revisa la conexión e inténtalo otra vez.')
    }
  }, [projectId])

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(t)
  }, [open, load])

  const create = async () => {
    setBusy(true)
    try {
      const share = await api.shares.create(projectId)
      setState((s) => ({ status: 'ready', shares: [share, ...(s.status === 'ready' ? s.shares : [])] }))
    } catch (e) {
      fail(e instanceof Error ? e.message : 'No se pudo crear otro código.')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (code: string) => {
    setBusy(true)
    try {
      await api.shares.revoke(projectId, code)
      setState((s) => (s.status === 'ready' ? { status: 'ready', shares: s.shares.filter((x) => x.code !== code) } : s))
    } catch {
      fail('No se pudo revocar el código.')
    } finally {
      setBusy(false)
    }
  }

  const current = state.status === 'ready' ? state.shares[0] : undefined
  const others = state.status === 'ready' ? state.shares.slice(1) : []

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-canvas/75 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[94dvh] w-[min(94vw,36rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl border border-line-strong bg-surface p-5 shadow-lift sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-display text-2xl leading-tight">Continuar en Interiores 3D</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted">
                Pega este código en Interiores 3D para amueblar esta casa. Los cambios se ven aquí en vivo; los muros siguen siendo de Plano 3D.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-raised hover:text-fg" aria-label="Cerrar">
                <X className="size-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          {state.status === 'error' && (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <p role="alert" className="text-sm text-danger">
                {state.message}
              </p>
              <Button onClick={() => void load()}>Reintentar</Button>
            </div>
          )}

          {state.status === 'loading' && <div className="mt-6 h-40 animate-pulse rounded-lg bg-raised" aria-label="Pidiendo el código" />}

          {current && (
            <>
              <div className="mt-6 rounded-lg border border-line bg-raised/60 p-4">
                <p className="text-sm text-muted">Código para Interiores 3D</p>
                <p className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <output aria-label="Código para compartir" className="font-mono text-3xl font-semibold tracking-[0.25em]">
                    {current.code}
                  </output>
                  <CopyButton text={current.code} />
                </p>
                <p className="mt-2 text-xs text-subtle">
                  {current.claimed_at ? `Conectado por última vez: ${when(current.claimed_at)}` : 'Todavía nadie lo ha usado'}
                </p>
              </div>
              <a
                href={interioresUrl(current.code)}
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand px-6 font-medium text-brand-ink shadow-card transition-[filter,transform] duration-200 hover:-translate-y-0.5 hover:brightness-110"
              >
                <Sofa className="size-4" aria-hidden /> Abrir Interiores 3D <ExternalLink className="size-3.5" aria-hidden />
              </a>

              <section aria-labelledby="conexiones" className="mt-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 id="conexiones" className="text-sm font-medium">
                    Conexiones activas
                  </h3>
                  <Button variant="ghost" disabled={busy} onClick={() => void create()} icon={<Plus className="size-4" aria-hidden />}>
                    Otro código
                  </Button>
                </div>
                <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
                  {[current, ...others].map((s) => (
                    <li key={s.code} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                      <span>
                        <span className="font-mono text-sm">{s.code}</span>
                        <span className="ml-3 text-xs text-subtle">{s.claimed_at ? `usado ${when(s.claimed_at)}` : `creado ${when(s.created_at)}`}</span>
                      </span>
                      <Button variant="ghost" disabled={busy} onClick={() => void revoke(s.code)} aria-label={`Revocar ${s.code}`}>
                        Revocar
                      </Button>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-subtle">Revocar corta el acceso de Interiores 3D al instante.</p>
              </section>
            </>
          )}

          {state.status === 'ready' && !current && (
            <div className="mt-6 flex items-center justify-between gap-3">
              <p className="text-sm text-muted">No hay códigos activos.</p>
              <Button disabled={busy} onClick={() => void create()} icon={<Plus className="size-4" aria-hidden />}>
                Crear código
              </Button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
