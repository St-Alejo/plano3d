/**
 * Marco común de los chats (estudio y visor 3D): una píldora cuando está cerrado y un panel
 * con mensajes, ejemplos y campo de texto cuando está abierto. Cada chat pone su lógica;
 * aquí solo vive cómo se ve y dónde aparece, para que los dos se comporten igual.
 */
import clsx from 'clsx'
import { MessageSquare, SendHorizontal, Sparkles, X } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'

export interface ChatMessage {
  id: number
  from: 'user' | 'bot'
  text: string
  lines?: string[]
  error?: boolean
  ai?: boolean
}

export function ChatDock<M extends ChatMessage>({
  open,
  onOpen,
  onClose,
  regionLabel,
  title,
  intro,
  examples,
  messages,
  extra,
  busy,
  text,
  onText,
  onSend,
  inputRef,
  listRef,
  inputLabel,
  placeholder,
  wide = false,
  className,
}: {
  open: boolean
  onOpen: () => void
  onClose: () => void
  regionLabel: string
  title: string
  intro: string
  examples: string[]
  messages: M[]
  /** algo más bajo un mensaje (p. ej. "Deshacer") */
  extra?: (m: M) => ReactNode
  busy: boolean
  text: string
  onText: (t: string) => void
  onSend: (t: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  listRef: RefObject<HTMLOListElement | null>
  inputLabel: string
  placeholder: string
  /** el chat del plano necesita más ancho que el de la vista */
  wide?: boolean
  /** posición: por defecto abajo al centro del lienzo */
  className?: string
}) {
  const place = className ?? 'absolute bottom-4 left-1/2 z-20 -translate-x-1/2'
  if (!open)
    return (
      <button
        type="button"
        onClick={onOpen}
        className={clsx(
          place,
          'pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full border border-line-strong bg-surface/90 px-4 text-sm shadow-lg backdrop-blur hover:border-accent',
        )}
      >
        <MessageSquare className="size-4 text-brand" aria-hidden /> {title}
      </button>
    )

  return (
    <section
      aria-label={regionLabel}
      className={clsx(
        place,
        'pointer-events-auto flex flex-col overflow-hidden rounded-lg border border-line-strong bg-surface/97 shadow-xl backdrop-blur',
        wide ? 'max-h-[min(60vh,520px)] w-[min(520px,calc(100vw-24px))]' : 'max-h-[min(50vh,460px)] w-[min(420px,calc(100vw-24px))]',
      )}
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <MessageSquare className="size-4 text-brand" aria-hidden />
        <h2 className="flex-1 text-sm font-medium">{title}</h2>
        <button
          type="button"
          aria-label="Cerrar chat"
          className="inline-flex items-center justify-center rounded-sm p-1 text-muted hover:bg-raised hover:text-fg pointer-coarse:size-11"
          onClick={onClose}
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <ol ref={listRef} aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 text-sm">
        {messages.length === 0 && (
          <li className="text-muted">
            {intro}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {examples.map((e) => (
                <button
                  key={e}
                  type="button"
                  className="rounded-full border border-line px-2.5 py-1 text-xs text-fg hover:border-accent pointer-coarse:min-h-11"
                  onClick={() => onSend(e)}
                >
                  {e}
                </button>
              ))}
            </div>
          </li>
        )}
        {messages.map((m) => (
          <li key={m.id} className={m.from === 'user' ? 'self-end rounded-lg bg-brand/12 px-3 py-1.5' : clsx('self-start', m.error && 'text-danger')}>
            {m.ai && <Sparkles className="mr-1 inline size-3.5 text-brand" aria-label="respuesta de la IA" />}
            {m.text}
            {m.lines && (
              <ul className="mt-1 list-disc pl-5 text-xs text-muted">
                {m.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
            {extra?.(m)}
          </li>
        ))}
        {busy && <li className="self-start text-muted">Pensando…</li>}
      </ol>
      <form
        className="flex items-center gap-2 border-t border-line p-2"
        onSubmit={(e) => {
          e.preventDefault()
          onSend(text)
        }}
      >
        <input
          ref={inputRef}
          aria-label={inputLabel}
          value={text}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          placeholder={placeholder}
          maxLength={1000}
          className="h-9 min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 text-sm pointer-coarse:h-11"
        />
        <button
          type="submit"
          aria-label="Enviar"
          disabled={busy || !text.trim()}
          className="inline-flex size-9 items-center justify-center rounded-md bg-accent text-accent-ink disabled:opacity-40 pointer-coarse:size-11"
        >
          <SendHorizontal className="size-4" aria-hidden />
        </button>
      </form>
    </section>
  )
}
