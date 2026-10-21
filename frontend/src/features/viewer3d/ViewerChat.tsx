/**
 * Chat del visor 3D: se escribe el ajuste ("modo acero", "oculta el ladrillo", "ve al paso 5",
 * "¿cuántos ladrillos?") y la vista cambia. No modifica el plano.
 *
 * Primero entiende el intérprete local; lo que no entiende va al asistente con IA del
 * servidor (`scope: 'viewer'`); si no está disponible, se muestran ejemplos.
 */
import { MessageSquare, SendHorizontal, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ApiError, api } from '@/api/client'
import { asViewerActions, parseViewerChat, VIEWER_EXAMPLES, type ViewerAction } from './viewerCommands'

/** Lo que responde la página al aplicar una acción: una frase y, si es una pregunta, el detalle. */
export type ViewerReply = string | { text: string; lines: string[] }

interface Msg {
  id: number
  from: 'user' | 'bot'
  text: string
  lines?: string[]
  error?: boolean
  ai?: boolean
}

let seq = 0

export function ViewerChat({ projectId, run, context }: { projectId: string; run: (a: ViewerAction) => ViewerReply; context: () => string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const list = useRef<HTMLOListElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs])

  const push = (m: Omit<Msg, 'id'>) => setMsgs((prev) => [...prev, { ...m, id: ++seq }])

  /** Aplica las acciones en orden; una pregunta responde con su detalle. */
  const apply = (actions: ViewerAction[], ai = false, reply?: string) => {
    const done: string[] = []
    for (const a of actions) {
      const r = run(a)
      if (typeof r === 'string') done.push(r)
      else push({ from: 'bot', text: r.text, lines: r.lines.length ? r.lines : undefined, ai })
    }
    if (done.length) push({ from: 'bot', text: reply || (done.length === 1 ? done[0]! : 'Hecho.'), lines: done.length > 1 || reply ? done : undefined, ai })
  }

  const send = async (message: string) => {
    const msg = message.trim()
    if (!msg || busy) return
    setText('')
    push({ from: 'user', text: msg })
    const local = parseViewerChat(msg)
    if (local.unknown.length === 0 && local.actions.length > 0) {
      try {
        apply(local.actions)
      } catch (e) {
        push({ from: 'bot', text: e instanceof Error ? e.message : 'No se pudo aplicar', error: true })
      }
      return
    }
    setBusy(true)
    try {
      const res = await api.assistant(projectId, msg, context(), 'viewer')
      const actions = asViewerActions(res.ops)
      if (actions.length === 0) push({ from: 'bot', text: res.reply || 'No encontré qué ajustar en la vista.', ai: true })
      else apply(actions, true, res.reply)
    } catch (e) {
      if (e instanceof ApiError && (e.status === 503 || e.status === 0)) {
        const what = local.unknown.length ? `«${local.unknown.join('», «')}»` : 'eso'
        push({ from: 'bot', text: `No entendí ${what}. Prueba con frases como:`, lines: VIEWER_EXAMPLES.slice(0, 5), error: true })
      } else push({ from: 'bot', text: e instanceof Error ? e.message : 'No se pudo aplicar', error: true, ai: true })
    } finally {
      setBusy(false)
      input.current?.focus()
    }
  }

  if (!open)
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setTimeout(() => input.current?.focus(), 0)
        }}
        className="pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full border border-line-strong bg-canvas/85 px-4 text-sm shadow-lg backdrop-blur hover:border-accent"
      >
        <MessageSquare className="size-4 text-brand" aria-hidden /> Ajustar escribiendo
      </button>
    )

  return (
    <section
      aria-label="Chat de la vista 3D"
      className="pointer-events-auto flex max-h-[min(50vh,460px)] w-[min(380px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-line-strong bg-surface/97 shadow-xl backdrop-blur"
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <MessageSquare className="size-4 text-brand" aria-hidden />
        <h2 className="flex-1 text-sm font-medium">Ajustar escribiendo</h2>
        <button type="button" aria-label="Cerrar chat" className="inline-flex items-center justify-center rounded p-1 pointer-coarse:size-11 text-muted hover:bg-raised hover:text-fg" onClick={() => setOpen(false)}>
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <ol ref={list} aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 text-sm">
        {msgs.length === 0 && (
          <li className="text-muted">
            Escribe qué quieres ver: modos de obra, pasos, elementos o cantidades.
            <div className="mt-2 flex flex-wrap gap-1.5">
              {VIEWER_EXAMPLES.map((e) => (
                <button key={e} type="button" className="rounded-full border border-line px-2.5 py-1 text-xs pointer-coarse:min-h-11 text-fg hover:border-accent" onClick={() => void send(e)}>
                  {e}
                </button>
              ))}
            </div>
          </li>
        )}
        {msgs.map((m) => (
          <li key={m.id} className={m.from === 'user' ? 'self-end rounded-lg bg-brand/12 px-3 py-1.5' : `self-start ${m.error ? 'text-danger' : ''}`}>
            {m.ai && <Sparkles className="mr-1 inline size-3.5 text-brand" aria-label="respuesta de la IA" />}
            {m.text}
            {m.lines && (
              <ul className="mt-1 list-disc pl-5 text-xs text-muted">
                {m.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
        {busy && <li className="self-start text-muted">Pensando…</li>}
      </ol>
      <form
        className="flex items-center gap-2 border-t border-line p-2"
        onSubmit={(e) => {
          e.preventDefault()
          void send(text)
        }}
      >
        <input
          ref={input}
          aria-label="Mensaje para la vista 3D"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          placeholder="p. ej. modo obra y oculta el ladrillo"
          maxLength={1000}
          className="h-9 min-w-0 flex-1 rounded-md pointer-coarse:h-11 border border-line bg-canvas px-3 text-sm"
        />
        <button
          type="submit"
          aria-label="Enviar"
          disabled={busy || !text.trim()}
          className="inline-flex size-9 pointer-coarse:size-11 items-center justify-center rounded-md bg-accent text-accent-ink disabled:opacity-40"
        >
          <SendHorizontal className="size-4" aria-hidden />
        </button>
      </form>
    </section>
  )
}
