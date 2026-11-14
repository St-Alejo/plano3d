/** Primitivas de UI del sistema de diseño. Pequeñas, accesibles y sin estilos sueltos. */
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import clsx from 'clsx'
import { AlertTriangle, ChevronRight, Loader2 } from 'lucide-react'
import { forwardRef, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { Link } from 'react-router'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink border-transparent shadow-card hover:-translate-y-px hover:shadow-lift hover:brightness-110 active:translate-y-0',
  secondary: 'bg-surface text-fg border-line-strong hover:border-fg/50 hover:bg-raised/50',
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
        'inline-flex shrink-0 items-center justify-center rounded-full border font-medium tracking-[-0.005em] transition-[background-color,border-color,color,filter,box-shadow,transform] duration-200 pointer-coarse:min-w-11',
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
        'inline-flex size-10 shrink-0 pointer-coarse:size-11 items-center justify-center rounded-lg border transition-colors duration-150',
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
      <label htmlFor={inputId} className="text-sm font-medium text-fg">
        {label}
      </label>
      <div className="flex items-center rounded-lg border border-line-strong bg-surface transition-[border-color,box-shadow] hover:border-fg/40 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/12">
        <input
          ref={ref}
          id={inputId}
          className="h-10 w-full min-w-0 bg-transparent px-3 pointer-coarse:h-11 text-sm text-fg outline-none placeholder:text-subtle"
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
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-danger/25 bg-danger/5 p-10 text-center">
      <AlertTriangle className="size-8 text-danger" aria-hidden />
      <h2 className="text-2xl">{title}</h2>
      {message && <p className="text-sm text-muted">{message}</p>}
      {action}
    </div>
  )
}

/** Estado vacío: con `art` (una foto de la marca) muestra la imagen en vez del ícono. */
export function EmptyState({ icon, title, message, action, art }: { icon: ReactNode; title: string; message: string; action?: ReactNode; art?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 overflow-hidden rounded-xl border border-line bg-surface px-6 pt-0 pb-16 text-center shadow-card">
      {art ? <div className="-mx-6 mb-4 aspect-[21/9] w-[calc(100%+3rem)] overflow-hidden">{art}</div> : <div className="mt-16 grid size-16 place-items-center rounded-xl bg-accent/10 text-accent">{icon}</div>}
      <h2 className="text-3xl tracking-[-0.03em]">{title}</h2>
      <p className="max-w-sm text-sm text-muted">{message}</p>
      {action}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-[11px] text-subtle">{children}</kbd>
}

/** Encabezado único de los paneles laterales: mono, 11 px, mayúsculas. */
export function PanelHeading({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={clsx('font-mono text-[11px] font-medium tracking-[0.14em] text-subtle uppercase', className)}>{children}</h2>
}

function readOpen(key: string | undefined, fallback: boolean) {
  if (!key) return fallback
  try {
    const v = localStorage.getItem(`plano3d-panel:${key}`)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

/**
 * Sección plegable de un panel: el encabezado es un botón con `aria-expanded`.
 * Con `storageKey` recuerda si quedó abierta (por visitante, en este navegador).
 */
export function PanelSection({
  title,
  ariaLabel,
  storageKey,
  defaultOpen = true,
  actions,
  children,
  className,
}: {
  title: string
  /** nombre de la región si debe ser más descriptivo que el título visible */
  ariaLabel?: string
  storageKey?: string
  defaultOpen?: boolean
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(() => readOpen(storageKey, defaultOpen))
  const id = useId()
  const toggle = () => {
    const next = !open
    setOpen(next)
    if (storageKey) {
      try {
        localStorage.setItem(`plano3d-panel:${storageKey}`, next ? '1' : '0')
      } catch {
        /* sin almacenamiento: solo dura la sesión */
      }
    }
  }
  return (
    <section aria-label={ariaLabel ?? title} className={clsx('flex flex-col', className)}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={toggle}
          className="group -mx-1 flex min-h-8 flex-1 items-center gap-1.5 rounded-sm px-1 text-left hover:bg-raised pointer-coarse:min-h-11"
        >
          <ChevronRight className={clsx('size-3.5 text-subtle transition-transform duration-150', open && 'rotate-90')} aria-hidden />
          <PanelHeading className="group-hover:text-fg">{title}</PanelHeading>
        </button>
        {actions}
      </div>
      <div id={id} hidden={!open} className="pt-2">
        {children}
      </div>
    </section>
  )
}

/** Grupo de una barra de herramientas: agrupa con nombre accesible y separa con una línea. */
export function ToolbarGroup({ label, children, divider = true }: { label: string; children: ReactNode; divider?: boolean }) {
  return (
    <div role="group" aria-label={label} className={clsx('flex shrink-0 items-center gap-0.5', divider && 'border-l border-line pl-1.5 first:border-l-0 first:pl-0')}>
      {children}
    </div>
  )
}

export interface MenuItem {
  label: string
  icon?: ReactNode
  shortcut?: string
  onSelect?: () => void
  href?: string
  danger?: boolean
  disabled?: boolean
}

/** Menú desplegable (Radix): agrupa acciones secundarias detrás de un solo botón. */
export function Menu({ trigger, items, align = 'end' }: { trigger: ReactNode; items: MenuItem[]; align?: 'start' | 'end' }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          className="z-50 min-w-52 rounded-xl border border-line bg-surface p-1.5 shadow-lift"
        >
          {items.map((it) => {
            const body = (
              <>
                <span className="flex size-4 items-center justify-center text-subtle">{it.icon}</span>
                <span className="flex-1">{it.label}</span>
                {it.shortcut && <span className="font-mono text-[11px] text-subtle">{it.shortcut}</span>}
              </>
            )
            const cls = clsx(
              'flex min-h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-raised pointer-coarse:min-h-11',
              it.danger ? 'text-danger' : 'text-fg',
            )
            return it.href ? (
              <DropdownMenu.Item key={it.label} asChild disabled={it.disabled} className={cls}>
                <Link to={it.href}>{body}</Link>
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item key={it.label} disabled={it.disabled} onSelect={it.onSelect} className={cls}>
                {body}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
