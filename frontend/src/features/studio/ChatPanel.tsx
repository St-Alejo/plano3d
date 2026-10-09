/**
 * Mini chat del estudio: se escribe lo que se quiere dibujar o cambiar ("sala de 4x5",
 * "mueve la puerta del baño al este") y se aplica al plano como UN paso de deshacer.
 *
 * Primero entiende el intérprete local (gratis, sin red). Lo que no entiende va al
 * asistente con IA del servidor; si no está disponible, se muestran ejemplos.
 */
import { MessageSquare, SendHorizontal, Sparkles, Undo2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ApiError, api } from '@/api/client'
import { EXAMPLES, parseChat } from '@/domain/chatParser'
import { CommandError, type Command } from '@/domain/commands'
import { asPlanOps, describeLevel, opsToCommand, type PlanOp } from '@/domain/planOps'
import { selectLevel, useEditor } from '@/store/editorStore'

interface Msg {
  id: number
  from: 'user' | 'bot'
  text: string
  lines?: string[]
  error?: boolean
  /** comando aplicado por este mensaje (para el botón Deshacer) */
  cmd?: Command
  ai?: boolean
}

let seq = 0

export function ChatPanel({ projectId, defaultOpen = false }: { projectId: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const head = useEditor((s) => s.head)
  const list = useRef<HTMLOListElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs])

  const push = (m: Omit<Msg, 'id'>) => setMsgs((prev) => [...prev, { ...m, id: ++seq }])

  /** Aplica operaciones; devuelve el resumen o lanza el error explicado. */
  const apply = (ops: PlanOp[]) => {
    const st = useEditor.getState()
    if (!st.model) throw new CommandError('El plano todavía no está cargado')
    const r = opsToCommand(st.model, st.levelId, ops)
    if (!st.dispatch(r.command)) throw new CommandError(useEditor.getState().error ?? 'No se pudo aplicar')
    useEditor.getState().clearError()
    // deja seleccionado el último ambiente mencionado para verlo en el plano y el inspector
    const last = [...ops].reverse().find((o) => 'room' in o || o.op === 'add_room')
    const name = last ? (last.op === 'add_room' ? last.name : last.op === 'rename_room' ? last.name : last.room) : null
    const lv = selectLevel(useEditor.getState())
    const room = name && lv?.rooms.find((x) => x.label.toLowerCase() === name.trim().toLowerCase())
    if (room) useEditor.getState().select({ kind: 'room', id: room.id })
    useEditor.getState().requestFit()
    return r
  }

  const send = async (message: string) => {
    const msg = message.trim()
    if (!msg || busy) return
    setText('')
    push({ from: 'user', text: msg })
    const local = parseChat(msg)
    if (local.unknown.length === 0 && local.ops.length > 0) {
      try {
        const r = apply(local.ops)
        push({ from: 'bot', text: 'Hecho.', lines: r.summary, cmd: r.command })
      } catch (e) {
        push({ from: 'bot', text: e instanceof Error ? e.message : 'No se pudo aplicar', error: true })
      }
      return
    }
    // respaldo: el mensaje completo al asistente con IA
    setBusy(true)
    try {
      const lv = selectLevel(useEditor.getState())
      const res = await api.assistant(projectId, msg, lv ? describeLevel(lv) : '')
      const ops = asPlanOps(res.ops)
      if (ops.length === 0) {
        push({ from: 'bot', text: res.reply || 'No encontré qué cambiar en el plano.', ai: true })
        return
      }
      const r = apply(ops)
      push({ from: 'bot', text: res.reply || 'Hecho.', lines: r.summary, cmd: r.command, ai: true })
    } catch (e) {
      if (e instanceof ApiError && (e.status === 503 || e.status === 0)) {
        const what = local.unknown.length ? `«${local.unknown.join('», «')}»` : 'eso'
        push({ from: 'bot', text: `No entendí ${what}. Prueba con frases como:`, lines: EXAMPLES.slice(0, 4), error: true })
      } else push({ from: 'bot', text: e instanceof Error ? e.message : 'No se pudo aplicar', error: true, ai: true })
    } finally {
      setBusy(false)
      input.current?.focus()
    }
  }

  const undo = (m: Msg) => {
    if (useEditor.getState().head !== m.cmd) return
    useEditor.getState().undo()
    push({ from: 'bot', text: 'Deshice el último cambio del chat.' })
  }

  if (!open)
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setTimeout(() => input.current?.focus(), 0)
        }}
        className="absolute bottom-4 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-line-strong bg-surface px-4 py-2.5 text-sm shadow-lg hover:border-accent"
      >
        <MessageSquare className="size-4 text-brand" aria-hidden /> Dibujar escribiendo
      </button>
    )

  return (
    <section
      aria-label="Chat del plano"
      className="absolute bottom-4 left-1/2 z-20 flex max-h-[min(60vh,520px)] w-[min(520px,calc(100vw-24px))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-line-strong bg-surface/97 shadow-xl backdrop-blur"
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <MessageSquare className="size-4 text-brand" aria-hidden />
        <h2 className="flex-1 text-sm font-medium">Dibujar escribiendo</h2>
        <button type="button" aria-label="Cerrar chat" className="inline-flex items-center justify-center rounded p-1 pointer-coarse:size-11 text-muted hover:bg-raised hover:text-fg" onClick={() => setOpen(false)}>
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <ol ref={list} aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 text-sm">
        {msgs.length === 0 && (
          <li className="text-muted">
            Escribe lo que quieres dibujar o cambiar. Todo se deshace con Ctrl+Z.
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXAMPLES.slice(0, 6).map((e) => (
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
            {m.cmd && head === m.cmd && (
              <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs text-accent underline" onClick={() => undo(m)}>
                <Undo2 className="size-3" aria-hidden /> Deshacer
              </button>
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
          aria-label="Mensaje para el plano"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          placeholder="p. ej. cocina de 3x3 al este de la sala con puerta al sur"
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
