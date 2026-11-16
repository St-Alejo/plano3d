import { ArrowRight, DoorOpen, WifiOff } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { ApiError } from '@/api/client'
import { Logo } from '@/components/AppShell'
import { Photo } from '@/components/Photo'
import { Button, TextField } from '@/components/ui'
import { useAuth } from '@/store/authStore'
import { safeNext, useAuthBootstrap } from './session'

type Mode = 'login' | 'register'

const COPY: Record<Mode, { title: string; lead: string; submit: string; swap: string; swapLink: string; swapTo: string }> = {
  login: {
    title: 'Entra a tus planos',
    lead: 'La misma cuenta abre tus proyectos en la web y en la app de escritorio.',
    submit: 'Entrar',
    swap: '¿Aún no tienes cuenta?',
    swapLink: 'Crear una',
    swapTo: '/registro',
  },
  register: {
    title: 'Crea tu cuenta',
    lead: 'Tus planos quedan guardados y los abres desde cualquier equipo.',
    submit: 'Crear cuenta',
    swap: '¿Ya tienes cuenta?',
    swapLink: 'Entrar',
    swapTo: '/entrar',
  },
}

function message(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return 'No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.'
    if (e.status === 429) return 'Demasiados intentos seguidos. Espera un minuto.'
    return e.message
  }
  return 'Algo salió mal. Inténtalo de nuevo.'
}

/** Entrada y registro: a la izquierda el formulario, a la derecha la puerta que se abre. */
export function AuthPage({ mode }: { mode: Mode }) {
  const status = useAuthBootstrap()
  const { demoEnabled, offline, login, register, demo } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const next = safeNext(params.get('next'))
  const [busy, setBusy] = useState<'form' | 'demo' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const copy = COPY[mode]

  if (status === 'signedIn' || status === 'open') return <Navigate to={next} replace />

  const run = async (kind: 'form' | 'demo', action: () => Promise<void>) => {
    setBusy(kind)
    setError(null)
    try {
      await action()
      void navigate(next, { replace: true })
    } catch (e) {
      setError(message(e))
      setBusy(null)
    }
  }

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const email = String(data.get('email') ?? '')
    const password = String(data.get('password') ?? '')
    void run('form', () => (mode === 'login' ? login(email, password) : register(email, String(data.get('name') ?? ''), password)))
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="flex flex-col px-4 py-6 sm:px-10 lg:px-16">
        <Logo />
        <main id="main" className="flex flex-1 flex-col justify-center py-10">
          <div className="mx-auto flex w-full max-w-md flex-col gap-8">
            <div className="flex flex-col gap-3">
              <h1 className="text-5xl leading-[0.95] font-[380] tracking-[-0.04em] sm:text-6xl">{copy.title}</h1>
              <p className="text-muted">{copy.lead}</p>
            </div>

            {offline && (
              <p role="status" className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/8 p-3 text-sm text-fg">
                <WifiOff className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                El servidor no respondió. Puede estar despertando: espera unos segundos y vuelve a intentar.
              </p>
            )}

            {demoEnabled && (
              <section aria-labelledby="demo-title" className="flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent/6 p-5">
                <div className="flex items-start gap-3">
                  <DoorOpen className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
                  <div>
                    <h2 id="demo-title" className="text-lg leading-snug font-medium tracking-[-0.01em]">
                      Prueba con la cuenta demo
                    </h2>
                    <p className="text-sm text-muted">Una casa de tres pisos con muebles y fachada, lista para editar y recorrer en 3D.</p>
                  </div>
                </div>
                <Button
                  variant="primary"
                  size="lg"
                  loading={busy === 'demo'}
                  disabled={busy !== null}
                  onClick={() => void run('demo', demo)}
                  className="w-full"
                >
                  Entrar con la cuenta demo
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
              </section>
            )}

            <form onSubmit={submit} className="flex flex-col gap-4" aria-label={copy.title}>
              {demoEnabled && (
                <p className="flex items-center gap-3 text-xs font-medium tracking-[0.12em] text-subtle uppercase">
                  <span aria-hidden className="h-px flex-1 bg-line" />o con tu correo
                  <span aria-hidden className="h-px flex-1 bg-line" />
                </p>
              )}
              {mode === 'register' && <TextField label="Nombre" name="name" autoComplete="name" required maxLength={80} />}
              <TextField label="Correo" name="email" type="email" autoComplete="email" required inputMode="email" />
              <TextField
                label="Contraseña"
                name="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={mode === 'register' ? 8 : undefined}
                hint={mode === 'register' ? 'Mínimo 8 caracteres.' : undefined}
              />
              {error && (
                <p role="alert" className="rounded-lg border border-danger/25 bg-danger/5 p-3 text-sm text-danger">
                  {error}
                </p>
              )}
              <Button type="submit" variant={demoEnabled ? 'secondary' : 'primary'} size="lg" loading={busy === 'form'} disabled={busy !== null}>
                {copy.submit}
              </Button>
            </form>

            <p className="text-sm text-muted">
              {copy.swap}{' '}
              <Link
                to={`${copy.swapTo}${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}
                className="inline-flex min-h-11 items-center font-medium text-accent underline-offset-4 hover:underline pointer-fine:min-h-0"
              >
                {copy.swapLink}
              </Link>
            </p>
          </div>
        </main>
      </div>
      <div className="relative hidden overflow-hidden bg-paper lg:block">
        <Photo name="interior-umbral" sizes="55vw" priority className="absolute inset-0 size-full object-cover" />
      </div>
    </div>
  )
}
