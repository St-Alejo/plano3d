/**
 * Pipeline en vivo: cada etapa del backend llega por WebSocket (Observer) y se
 * muestra como un paso con su tiempo y métricas. Cuando una etapa trae un modelo
 * parcial, el visor 3D lo va construyendo: es la visualización literal del pipeline.
 */
import clsx from 'clsx'
import { Check, Circle, Loader2, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useReducer } from 'react'
import { subscribeProgress } from '@/api/progress'
import { METRIC_LABELS, STAGES, initialProgress, progressReducer } from './progressState'

const Viewer3D = lazy(() => import('@/features/viewer3d/Viewer3D').then((m) => ({ default: m.Viewer3D })))

export function ProcessingView({ projectId, onFinished }: { projectId: string; onFinished: () => void }) {
  const [state, push] = useReducer(progressReducer, initialProgress)

  useEffect(
    () => subscribeProgress(projectId, { onEvent: push, onDone: () => setTimeout(onFinished, 900) }),
    [projectId, onFinished],
  )

  const completed = STAGES.filter((s) => state.stages[s.key]?.status === 'completed').length
  const pct = Math.round((completed / STAGES.length) * 100)

  return (
    <div className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[360px_1fr]">
      <section aria-labelledby="pipeline-title" className="flex flex-col gap-4">
        <div>
          <p className="font-mono text-xs font-medium tracking-[0.04em] text-accent uppercase">Procesamiento</p>
          <h1 id="pipeline-title" className="mt-3 text-4xl leading-[0.95] tracking-[-0.04em]">
            Reconociendo el plano
          </h1>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progreso del análisis">
          <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
        <ol className="flex flex-col" aria-live="polite">
          {STAGES.map((s, i) => {
            const st = state.stages[s.key]
            const status = st?.status ?? 'pending'
            return (
              <li key={s.key} className={clsx('grid grid-cols-[32px_1fr] gap-3 border-t border-line py-2.5', status === 'pending' && 'opacity-50')}>
                <span
                  className={clsx(
                    'mt-0.5 flex size-7 items-center justify-center rounded-full border font-mono text-xs',
                    status === 'completed' && 'border-accent bg-accent text-accent-ink',
                    status === 'started' && 'border-accent text-accent',
                    status === 'failed' && 'border-danger text-danger',
                    status === 'pending' && 'border-line-strong text-subtle',
                  )}
                  aria-hidden
                >
                  {status === 'completed' ? <Check className="size-4" /> : status === 'started' ? <Loader2 className="size-4 animate-spin" /> : status === 'failed' ? <X className="size-4" /> : i + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{s.title}</span>
                    {st?.ms != null && <span className="font-mono text-xs text-subtle">{st.ms < 1000 ? `${st.ms.toFixed(0)} ms` : `${(st.ms / 1000).toFixed(1)} s`}</span>}
                  </div>
                  <span className="sr-only">{status === 'completed' ? 'completada' : status === 'started' ? 'en curso' : status === 'failed' ? 'falló' : 'pendiente'}</span>
                  {st?.metrics && Object.keys(st.metrics).length > 0 && (
                    <p className="mt-0.5 font-mono text-xs text-muted">
                      {Object.entries(st.metrics)
                        .filter(([k]) => METRIC_LABELS[k])
                        .map(([k, v]) => METRIC_LABELS[k]!(v))
                        .join(' · ')}
                    </p>
                  )}
                  {status === 'failed' && st?.message && <p className="mt-0.5 text-xs text-danger">{st.message}</p>}
                </div>
              </li>
            )
          })}
        </ol>
        {state.done === 'ok' && <p className="text-sm text-ok">Listo. Abriendo el editor…</p>}
        {state.done === 'failed' && <p role="alert" className="text-sm text-danger">El análisis falló: {state.error}</p>}
      </section>

      <section aria-label="Vista previa en vivo" className="corner-ticks blueprint-grid relative min-h-[320px] border border-line">
        {state.preview ? (
          <Suspense fallback={null}>
            <Viewer3D model={state.preview} className="absolute inset-0" label="Vista previa del modelo mientras se detecta" />
          </Suspense>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-subtle">
            <Circle className="size-8 animate-pulse text-accent-dim" aria-hidden />
            Los muros aparecerán aquí a medida que se detecten.
          </div>
        )}
      </section>
    </div>
  )
}
