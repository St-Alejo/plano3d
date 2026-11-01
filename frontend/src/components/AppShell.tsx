import { Moon, Plus, Sun } from 'lucide-react'
import { Link, NavLink, Outlet, useMatch } from 'react-router'
import clsx from 'clsx'
import { useState } from 'react'
import { useTheme } from '@/lib/theme'
import { HeaderSlotContext } from './headerSlot'

/** Marca: el mismo ícono y nombre que la landing. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="group flex min-h-11 min-w-11 shrink-0 items-center gap-2 text-[17px] font-medium tracking-[-0.03em]" aria-label="Plano 3D, inicio">
      <svg viewBox="0 0 24 24" className="size-6 transition-transform duration-500 ease-out group-hover:-rotate-8" aria-hidden>
        <rect x="2.5" y="2.5" width="19" height="19" rx="4" className="fill-brand" />
        <path d="M7 17V7h6v5h4v5Z" fill="none" className="stroke-brand-ink" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
      <span className={compact ? 'hidden md:inline' : undefined}>Plano 3D</span>
    </Link>
  )
}

export function AppShell() {
  const [theme, toggleTheme] = useTheme()
  // el editor ocupa exactamente la ventana en escritorio: cada panel hace su propio scroll
  const editor = useMatch('/p/:id')
  // en el editor, la página pone sus migas dentro de la cabecera: una barra menos sobre el lienzo
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  return (
    <HeaderSlotContext.Provider value={editor ? slot : null}>
    <div className={clsx('flex flex-col', editor ? 'min-h-full lg:h-dvh lg:overflow-hidden' : 'min-h-full')}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink"
      >
        Saltar al contenido
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className={clsx('mx-auto flex items-center justify-between gap-4 px-4', editor ? 'h-12 max-w-none' : 'h-14 max-w-7xl sm:px-6')}>
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
                  'inline-flex min-h-11 items-center rounded-full px-3.5 text-sm transition-colors sm:min-h-9',
                  isActive ? 'bg-raised text-fg' : 'text-muted hover:text-fg',
                )
              }
            >
              Proyectos
            </NavLink>
            )}
            {!editor && (
            <Link
              to="/nuevo"
              className="ml-1 inline-flex h-11 items-center gap-1.5 rounded-full bg-brand px-4 text-sm font-medium text-brand-ink shadow-sm transition-[filter,transform] duration-200 hover:-translate-y-px hover:brightness-110 sm:h-9"
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
              className="ml-1 inline-flex size-11 items-center justify-center rounded-full text-muted transition-colors hover:bg-raised hover:text-fg sm:size-9"
            >
              {theme === 'dark' ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
            </button>
          </nav>
        </div>
      </header>
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
    </HeaderSlotContext.Provider>
  )
}
