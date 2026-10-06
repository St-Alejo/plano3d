import { Moon, Plus, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useMatch } from 'react-router'
import clsx from 'clsx'

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('theme') ?? 'dark'
    } catch {
      return 'dark'
    }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('theme', theme)
    } catch {
      /* almacenamiento no disponible */
    }
  }, [theme])
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}

export function Logo() {
  return (
    <Link to="/" className="flex min-h-11 items-center gap-2" aria-label="Plano 3D, inicio">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="5" className="fill-raised" />
        <path d="M7 23V9h18v14H7Zm0-7h10V9" fill="none" className="stroke-brand" strokeWidth="2.4" strokeLinejoin="round" />
      </svg>
      <span className="flex items-baseline gap-1">
        <span className="font-serif text-2xl leading-none">Plano</span>
        <span className="font-mono text-xs font-medium text-brand">3D</span>
      </span>
    </Link>
  )
}

export function AppShell() {
  const [theme, toggleTheme] = useTheme()
  // el editor ocupa exactamente la ventana en escritorio: cada panel hace su propio scroll
  const editor = useMatch('/p/:id')
  return (
    <div className={clsx('flex flex-col', editor ? 'min-h-full lg:h-dvh lg:overflow-hidden' : 'min-h-full')}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink">
        Saltar al contenido
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4">
          <Logo />
          <nav className="flex items-center gap-1" aria-label="Principal">
            <NavLink
              to="/proyectos"
              end
              className={({ isActive }) =>
                clsx('inline-flex min-h-11 items-center rounded-md px-3 text-sm sm:min-h-9', isActive ? 'text-fg' : 'text-muted hover:text-fg')
              }
            >
              Proyectos
            </NavLink>
            <Link
              to="/nuevo"
              className="ml-1 inline-flex h-11 items-center gap-1.5 sm:h-9 rounded-md bg-brand px-3 text-sm font-medium text-brand-ink hover:brightness-110"
            >
              <Plus className="size-4" aria-hidden />
              <span className="hidden sm:inline">Nuevo plano</span>
              <span className="sm:hidden">Nuevo</span>
            </Link>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro'}
              className="ml-1 inline-flex size-11 items-center justify-center rounded-md sm:size-9 text-muted hover:bg-raised hover:text-fg"
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
  )
}
