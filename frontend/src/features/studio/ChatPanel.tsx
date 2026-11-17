/**
 * Mini chat del estudio: se escribe lo que se quiere dibujar o cambiar ("sala de 4x5",
 * "mueve la puerta del baño al este") y se aplica al plano como UN paso de deshacer.
 *
 * Primero entiende el intérprete local (gratis, sin red). Lo que no entiende va al
 * asistente con IA del servidor; si no está disponible, se muestran ejemplos.
 *
 * «Otro piso igual al que ya está» no es un comando del editor: lo hace el servidor
 * (copia el piso encima del último) y después se recarga el proyecto.
 */
import { Undo2 } from 'lucide-react'
import { ChatDock } from '@/components/ChatDock'
import { useEffect, useRef, useState } from 'react'
import { ApiError, api } from '@/api/client'
import { EXAMPLES, parseChat } from '@/domain/chatParser'
import { CommandError, type Command } from '@/domain/commands'
import { asChatOps, describeLevel, isLevelOp, opsToCommand, type ChatOp, type LevelOp, type PlanOp } from '@/domain/planOps'
import { recentConversation } from '@/domain/chatHistory'
import { selectIsDirty, selectLevel, useEditor } from '@/store/editorStore'

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

export function ChatPanel({ projectId, defaultOpen = false, onReload }: { projectId: string; defaultOpen?: boolean; onReload?: () => void }) {
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

  /** Copia pisos en el servidor (encima del último) y recarga el proyecto. */
  const duplicate = async (ops: LevelOp[]): Promise<string[]> => {
    const st = useEditor.getState()
    if (!st.model) throw new CommandError('El plano todavía no está cargado')
    if (selectIsDirty(st)) throw new CommandError('Guarda los cambios (Ctrl+S) antes de agregar un piso')
    let revision = st.revision
    const lines: string[] = []
    for (const op of ops) {
      const src = op.level ? st.model.levels[op.level - 1] : st.model.levels.find((l) => l.id === st.levelId)
      if (!src) throw new CommandError(`El proyecto no tiene piso ${op.level}; tiene ${st.model.levels.length}`)
      for (let i = 0; i < (op.count ?? 1); i++) {
        const project = await api.duplicateLevel(projectId, src.id, undefined, revision)
        revision = project.revision
        lines.push(`Agregué ${project.model?.levels.at(-1)?.name ?? 'un piso'}, igual a ${src.name}`)
      }
    }
    onReload?.()
    return lines
  }

  /**
   * Resumen para la IA: los pisos del proyecto (para «duplica el piso 2»), el piso que se ve y lo
   * último que se habló (para «ponle una ventana a esa alcoba»).
   */
  const context = (level: string): string => {
    const st = useEditor.getState()
    const floors = (st.model?.levels ?? []).map((l, i) => `${i + 1}. ${l.name}${l.id === st.levelId ? ' (el que se ve)' : ''}`)
    const parts = [floors.length > 1 ? `Pisos: ${floors.join('; ')}` : '', level, recentConversation(msgs)]
    return parts.filter(Boolean).join('\n')
  }

  /** Aplica lo que entendió el chat; los pisos van al servidor y el resto al editor. */
  const run = async (ops: ChatOp[]): Promise<{ lines: string[]; cmd?: Command }> => {
    const levels = ops.filter(isLevelOp)
    const plan = ops.filter((o): o is PlanOp => !isLevelOp(o))
    if (levels.length === 0) {
      const r = apply(plan)
      return { lines: r.summary, cmd: r.command }
    }
    // el piso se copia tal como está guardado: primero los cambios del plano no van juntos
    if (plan.length > 0) throw new CommandError('Pide el piso nuevo en un mensaje aparte de los cambios del plano')
    return { lines: await duplicate(levels) }
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
      const remote = local.ops.some(isLevelOp)
      if (remote) setBusy(true)
      try {
        const r = await run(local.ops)
        push({ from: 'bot', text: 'Hecho.', lines: r.lines, cmd: r.cmd })
        return
      } catch (e) {
        const why = e instanceof Error ? e.message : 'No se pudo aplicar'
        // un piso que el servidor no pudo copiar no se le pregunta a la IA: se explica el motivo
        if (remote) return push({ from: 'bot', text: why, error: true })
        localError = why
      } finally {
        if (remote) setBusy(false)
      }
    }
    // respaldo: el mensaje completo al asistente con IA
    setBusy(true)
    try {
      const lv = selectLevel(useEditor.getState())
      const res = await api.assistant(projectId, msg, context(lv ? describeLevel(lv) : ''))
      const ops = asChatOps(res.ops)
      if (ops.length === 0) {
        push({ from: 'bot', text: res.reply || 'No encontré qué cambiar en el plano.', ai: true })
        return
      }
      const r = await run(ops)
      push({ from: 'bot', text: res.reply || 'Hecho.', lines: r.lines, cmd: r.cmd, ai: true })
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
