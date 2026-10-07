/** Primitivas de UI del sistema de diseño. Pequeñas, accesibles y sin estilos sueltos. */
import clsx from 'clsx'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink border-transparent shadow-sm hover:brightness-110',
  secondary: 'bg-surface text-fg border-line-strong shadow-xs hover:border-fg/40 hover:bg-raised/60',
  ghost: 'bg-transparent text-muted border-transparent hover:text-fg hover:bg-raised',
  danger: 'bg-transparent text-danger border-danger/40 hover:bg-danger/10',
}
const sizes: Record<Size, string> = {
  sm: 'h-8 pointer-coarse:h-11 px-3 text-sm gap-1.5',
  md: 'h-10 pointer-coarse:h-11 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-base gap-2',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-md border font-medium transition-[background-color,border-color,color,filter,box-shadow] duration-200 pointer-coarse:min-w-11',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  active?: boolean
  shortcut?: string
}

/** Botón de solo ícono: el `label` es obligatorio (lector de pantalla + tooltip nativo). */
export function IconButton({ label, active, shortcut, className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={clsx(
        'inline-flex size-10 shrink-0 pointer-coarse:size-11 items-center justify-center rounded-md border transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'border-transparent bg-accent text-accent-ink shadow-sm' : 'border-transparent text-muted hover:bg-raised hover:text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

type Tone = 'neutral' | 'accent' | 'warn' | 'danger' | 'ok'
const tones: Record<Tone, string> = {
  neutral: 'bg-raised text-muted',
  accent: 'bg-accent/12 text-accent',
  warn: 'bg-warn/12 text-warn',
  danger: 'bg-danger/10 text-danger',
  ok: 'bg-ok/12 text-ok',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone])}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  )
}

export const TextField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; suffix?: string }
>(function TextField({ label, hint, suffix, id, className, ...rest }, ref) {
  const inputId = id ?? `f-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-sm font-medium text-muted">
        {label}
      </label>
      <div className="flex items-center rounded-md border border-line-strong bg-surface transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15">
        <input
          ref={ref}
          id={inputId}
          className="h-10 w-full min-w-0 bg-transparent px-3 text-sm text-fg outline-none placeholder:text-subtle"
          {...rest}
        />
        {suffix && <span className="pr-3 font-mono text-xs text-subtle">{suffix}</span>}
      </div>
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </div>
  )
})

export function Spinner({ label = 'Cargando' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-muted">
      <Loader2 className="size-4 animate-spin text-accent" aria-hidden />
      {label}
    </div>
  )
}

export function ErrorState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-danger/25 bg-danger/5 p-8 text-center">
      <AlertTriangle className="size-8 text-danger" aria-hidden />
      <h2 className="text-lg">{title}</h2>
      {message && <p className="text-sm text-muted">{message}</p>}
      {action}
    </div>
  )
}

export function EmptyState({ icon, title, message, action }: { icon: ReactNode; title: string; message: string; action?: ReactNode }) {
  return (
    <div className="blueprint-grid flex flex-col items-center gap-4 rounded-2xl border border-dashed border-line-strong bg-surface/60 px-6 py-20 text-center">
      <div className="grid size-16 place-items-center rounded-2xl bg-accent/10 text-accent">{icon}</div>
      <h2 className="text-2xl tracking-[-0.03em]">{title}</h2>
      <p className="max-w-sm text-sm text-muted">{message}</p>
      {action}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-[11px] text-subtle">{children}</kbd>
}
