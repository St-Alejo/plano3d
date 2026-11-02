/**
 * Chat del visor 3D: se escribe el ajuste ("modo acero", "oculta el ladrillo", "ve al paso 5",
 * "¿cuántos ladrillos?") y la vista cambia. No modifica el plano.
 *
 * Primero entiende el intérprete local; lo que no entiende va al asistente con IA del
 * servidor (`scope: 'viewer'`); si no está disponible, se muestran ejemplos.
 */
import { ChatDock } from '@/components/ChatDock'
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

export function ViewerChat({
  projectId,
  run,
  context,
  className,
}: {
  projectId: string
  run: (a: ViewerAction) => ViewerReply
  context: () => string
  /** posición del chat (por defecto, abajo al centro) */
  className?: string
}) {
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

  return (
    <ChatDock
      open={open}
      onOpen={() => {
        setOpen(true)
        setTimeout(() => input.current?.focus(), 0)
      }}
      onClose={() => setOpen(false)}
      regionLabel="Chat de la vista 3D"
      title="Ajustar escribiendo"
      intro="Escribe qué quieres ver: modos de obra, pasos, elementos o cantidades."
      examples={VIEWER_EXAMPLES}
      messages={msgs}
      busy={busy}
      text={text}
      onText={setText}
      onSend={(t) => void send(t)}
      inputRef={input}
      listRef={list}
      inputLabel="Mensaje para la vista 3D"
      placeholder="p. ej. modo obra y oculta el ladrillo"
      className={className}
    />
  )
}
