/**
 * Estudio: el editor a pantalla completa. El lienzo ocupa toda la ventana y los paneles
 * (capas/catálogo a la izquierda, propiedades a la derecha) flotan encima como cajones
 * plegables, así el plano tiene el máximo espacio y todo sigue a un clic.
 */
import { ArrowLeft, Maximize, Minimize, PanelLeft, PanelRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import clsx from 'clsx'
import { IconButton } from '@/components/ui'
import { fullscreenSupported, toggleFullscreen, useIsFullscreen } from '@/lib/fullscreen'
import type { ViewMode } from '@/store/editorStore'

export interface StudioLayoutProps {
  projectId: string
  title: string
  toolbar: ReactNode
  editor: ReactNode
  viewer: ReactNode
  left: ReactNode
  right: ReactNode
  /** cajones extra (p. ej. el chat) que se pintan sobre el lienzo */
  overlay?: ReactNode
  banner?: ReactNode
  statusBar?: ReactNode
  viewMode: ViewMode
  leftOpen: boolean
  rightOpen: boolean
  onToggleLeft: () => void
  onToggleRight: () => void
}

export function StudioLayout(p: StudioLayoutProps) {
  const full = useIsFullscreen()
  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-canvas" data-testid="studio">
      <header className="flex shrink-0 items-center gap-1 border-b border-line bg-surface pl-2">
        <Link
          to={`/p/${p.projectId}`}
          aria-label="Salir del estudio"
          title="Salir del estudio"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-md pointer-coarse:size-11 text-muted hover:bg-raised hover:text-fg"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <h1 className="hidden max-w-48 truncate px-1 font-display text-sm font-semibold md:block">{p.title}</h1>
        <IconButton label="Panel de capas y catálogo" active={p.leftOpen} onClick={p.onToggleLeft}>
          <PanelLeft className="size-5" aria-hidden />
        </IconButton>
        <div className="min-w-0 flex-1 [&>[role=toolbar]]:border-b-0">{p.toolbar}</div>
        <IconButton label="Panel de propiedades" active={p.rightOpen} onClick={p.onToggleRight}>
          <PanelRight className="size-5" aria-hidden />
        </IconButton>
        {fullscreenSupported() && (
          <IconButton label={full ? 'Salir de pantalla completa' : 'Pantalla completa'} shortcut="F" onClick={() => void toggleFullscreen()}>
            {full ? <Minimize className="size-5" aria-hidden /> : <Maximize className="size-5" aria-hidden />}
          </IconButton>
        )}
      </header>
      {p.banner}
      <main className="relative min-h-0 flex-1">
        {/* en escritorio el lienzo deja libre lo que tapan los paneles: así "Encuadrar" usa el área visible */}
        <div
          className={clsx(
            'grid size-full transition-[padding] duration-200',
            p.viewMode === 'split' ? 'grid-cols-2' : 'grid-cols-1',
            p.leftOpen && 'lg:pl-[284px]',
            p.rightOpen && 'lg:pr-[344px]',
          )}
        >
          {p.viewMode !== '3d' && (
            <section aria-label="Editor 2D" className="min-h-0 border-r border-line">
              {p.editor}
            </section>
          )}
          {p.viewMode !== '2d' && (
            <section aria-label="Vista 3D" className="min-h-0">
              {p.viewer}
            </section>
          )}
        </div>
        {p.leftOpen && (
          <aside
            aria-label="Capas y objetos"
            className="absolute top-3 bottom-3 left-3 z-10 w-[min(260px,calc(100vw-24px))] overflow-y-auto rounded-lg border border-line bg-surface/95 p-3 shadow-lg backdrop-blur"
          >
            {p.left}
          </aside>
        )}
        {p.rightOpen && (
          <div className="absolute top-3 right-3 bottom-3 z-10 flex w-[min(320px,calc(100vw-24px))] flex-col overflow-hidden rounded-lg border border-line bg-surface/95 shadow-lg backdrop-blur">
            {p.right}
          </div>
        )}
        {p.overlay}
      </main>
      {p.statusBar}
    </div>
  )
}
