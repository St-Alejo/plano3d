import { LogOut, Moon, Plus, RotateCcw, Sun } from 'lucide-react'
import { Link, NavLink, Outlet, useMatch, useNavigate } from 'react-router'
import clsx from 'clsx'
import { useState } from 'react'
import { api } from '@/api/client'
import { useTheme } from '@/lib/theme'
import { useAuth } from '@/store/authStore'
import { Menu } from './ui'
import { HeaderSlotContext } from './headerSlot'

/**
 * Isotipo: la planta de la casa (un rectángulo con un muro interior y el vano de la puerta)
 * que se levanta en volumen. Ladrillo sobre el color de fondo; hereda el tamaño por clase.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#a84b26" />
      <path d="M9 23V12.5L16 8l7 4.5V23" fill="none" stroke="#fbf9f5" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9 23h5.5v-5.5h3V23H23" fill="none" stroke="#fbf9f5" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

/** Marca: el mismo isotipo y nombre que la landing. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="group flex min-h-11 min-w-11 shrink-0 items-center gap-2.5 text-[17px] font-semibold tracking-[-0.02em]" aria-label="Plano 3D, inicio">
      <Mark className="size-7 transition-transform duration-500 ease-out group-hover:-rotate-6" />
      <span className={compact ? 'hidden md:inline' : undefined}>Plano 3D</span>
    </Link>
  )
}

/** Pie de las pantallas de la app (proyectos, nueva captura, 404): marca y enlaces. */
function AppFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="flex items-center gap-2">
          <Mark className="size-5" /> Plano 3D · del plano a la casa
        </p>
        <nav aria-label="Pie" className="flex flex-wrap gap-x-5">
          <Link to="/" className="inline-flex min-h-11 min-w-11 items-center justify-center hover:text-fg pointer-fine:min-h-8">
            Inicio
          </Link>
          <Link to="/proyectos" className="inline-flex min-h-11 min-w-11 items-center justify-center hover:text-fg pointer-fine:min-h-8">
            Mis proyectos
          </Link>
          <a href="/tutoriales/crear.webm" className="inline-flex min-h-11 min-w-11 items-center justify-center hover:text-fg pointer-fine:min-h-8">
            Tutorial
          </a>
        </nav>
      </div>
    </footer>
  )
}

/** Cuenta en la cabecera: inicial del nombre; adentro, cerrar sesión (y restaurar la demo). */
function AccountMenu() {
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  const navigate = useNavigate()
  if (!user) return null
  const items = [
    ...(user.is_demo
      ? [
          {
            label: 'Restaurar la casa demo',
            icon: <RotateCcw className="size-4" />,
            onSelect: () => {
              if (!window.confirm('¿Dejar la casa demo como nueva? Se pierden los cambios hechos en ella.')) return
              void api.auth.resetDemo().then(() => navigate('/proyectos', { replace: true }))
            },
          },
        ]
      : []),
    {
      label: 'Cerrar sesión',
      icon: <LogOut className="size-4" />,
      onSelect: () => void logout().then(() => navigate('/entrar', { replace: true })),
    },
  ]
  return (
    <Menu
      trigger={
        <button
          type="button"
          aria-label={`Cuenta de ${user.name}`}
          title={user.email}
          className="ml-1 inline-flex size-11 items-center justify-center rounded-full border border-line-strong bg-surface text-sm font-semibold text-fg uppercase transition-colors hover:border-fg/50 pointer-fine:size-9"
        >
          {user.name.trim().charAt(0) || '?'}
        </button>
      }
      items={items}
    />
  )
}

export function AppShell() {
  const [theme, toggleTheme] = useTheme()
  // el editor ocupa exactamente la ventana en escritorio: cada panel hace su propio scroll
  const editor = useMatch('/p/:id')
  // el visor 3D es a pantalla completa: su barra flotante es la única cabecera
  const viewer = useMatch('/p/:id/3d')
  // en el editor, la página pone sus migas dentro de la cabecera: una barra menos sobre el lienzo
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  return (
    <HeaderSlotContext.Provider value={editor ? slot : null}>
    <div className={clsx('flex flex-col', editor ? 'min-h-full lg:h-dvh lg:overflow-hidden' : viewer ? 'h-dvh overflow-hidden' : 'min-h-full')}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink"
      >
        Saltar al contenido
      </a>
      <header className={clsx('sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md backdrop-saturate-150', viewer && 'hidden')}>
        <div className={clsx('mx-auto flex items-center justify-between gap-4 px-4', editor ? 'h-12 max-w-none' : 'h-16 max-w-7xl sm:px-6')}>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Logo compact={!!editor} />
            {editor && <div ref={setSlot} className="flex min-w-0 flex-1 items-center gap-2" />}
          </div>
          <nav className="flex shrink-0 items-center gap-1" aria-label="Principal">
            {!editor && (
            <NavLink
              to="/proyectos"
              end
              className={({ isActive }) =>
                clsx(
                  'relative inline-flex min-h-11 items-center rounded-full px-3.5 text-sm font-medium transition-colors pointer-fine:min-h-9',
                  isActive ? 'text-fg after:absolute after:inset-x-3.5 after:bottom-1 after:h-0.5 after:rounded-full after:bg-accent' : 'text-muted hover:text-fg',
                )
              }
            >
              Proyectos
            </NavLink>
            )}
            {!editor && (
            <Link
              to="/nuevo"
              className="ml-1 inline-flex h-11 items-center gap-1.5 rounded-full bg-brand px-4 text-sm font-medium text-brand-ink shadow-card transition-[filter,transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-lift hover:brightness-110 pointer-fine:h-9"
            >
              <Plus className="size-4" aria-hidden />
              <span className="hidden sm:inline">Nuevo plano</span>
              <span className="sm:hidden">Nuevo</span>
            </Link>
            )}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro'}
              className="ml-1 inline-flex size-11 items-center justify-center rounded-full text-muted transition-colors hover:bg-raised hover:text-fg pointer-fine:size-9"
            >
              {theme === 'dark' ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
            </button>
            <AccountMenu />
          </nav>
        </div>
      </header>
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
      {!editor && !viewer && <AppFooter />}
    </div>
    </HeaderSlotContext.Provider>
  )
}
