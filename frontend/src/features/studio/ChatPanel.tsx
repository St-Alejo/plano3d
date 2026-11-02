/**
 * Mini chat del estudio: se escribe lo que se quiere dibujar o cambiar ("sala de 4x5",
 * "mueve la puerta del baño al este") y se aplica al plano como UN paso de deshacer.
 *
 * Primero entiende el intérprete local (gratis, sin red). Lo que no entiende va al
 * asistente con IA del servidor; si no está disponible, se muestran ejemplos.
 */
import { Undo2 } from 'lucide-react'
import { ChatDock } from '@/components/ChatDock'
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
    // si la lectura local no se puede aplicar (p. ej. nombra un ambiente que no existe),
    // probablemente se entendió mal: se le pasa el mensaje al asistente con IA
    let localError: string | null = null
    if (local.unknown.length === 0 && local.ops.length > 0) {
      try {
        const r = apply(local.ops)
        push({ from: 'bot', text: 'Hecho.', lines: r.summary, cmd: r.command })
        return
      } catch (e) {
        localError = e instanceof Error ? e.message : 'No se pudo aplicar'
      }
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
        // sin asistente: se muestra el motivo de la lectura local, como antes
        if (localError) return push({ from: 'bot', text: localError, error: true })
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

  return (
    <ChatDock
      open={open}
      onOpen={() => {
        setOpen(true)
        setTimeout(() => input.current?.focus(), 0)
      }}
      onClose={() => setOpen(false)}
      regionLabel="Chat del plano"
      title="Dibujar escribiendo"
      intro="Escribe lo que quieres dibujar o cambiar. Todo se deshace con Ctrl+Z."
      examples={EXAMPLES.slice(0, 6)}
      messages={msgs}
      extra={(m) =>
        m.cmd && head === m.cmd ? (
          <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs text-accent underline" onClick={() => undo(m)}>
            <Undo2 className="size-3" aria-hidden /> Deshacer
          </button>
        ) : null
      }
      busy={busy}
      text={text}
      onText={setText}
      onSend={(t) => void send(t)}
      inputRef={input}
      listRef={list}
      inputLabel="Mensaje para el plano"
      placeholder="p. ej. cocina de 3x3 al este de la sala con puerta al sur"
      wide
    />
  )
}
