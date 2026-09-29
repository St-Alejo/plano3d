/**
 * Ajuste manual de las 4 esquinas del papel sobre la foto.
 * Se arrastra con puntero (mouse/táctil) o se mueve con las flechas del teclado
 * (Shift = paso grande), así también es accesible sin mouse.
 */
import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import type { Corners } from '@/api/client'

const NAMES = ['superior izquierda', 'superior derecha', 'inferior derecha', 'inferior izquierda']


const clamp = (v: number) => Math.min(1, Math.max(0, v))

export function CornerEditor({
  src,
  corners,
  onChange,
}: {
  src: string
  corners: Corners
  onChange: (c: Corners) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const dragging = useRef<number | null>(null)

  const update = (i: number, x: number, y: number) => {
    const next = corners.map((c, j) => (j === i ? [clamp(x), clamp(y)] : c)) as Corners
    onChange(next)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (dragging.current === null || !box.current) return
    const r = box.current.getBoundingClientRect()
    update(dragging.current, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
  }

  const onKey = (i: number) => (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.02 : 0.004
    const [x, y] = corners[i]!
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const d = moves[e.key]
    if (!d) return
    e.preventDefault()
    update(i, x + d[0], y + d[1])
  }

  const poly = corners.map(([x, y]) => `${x * 100},${y * 100}`).join(' ')

  return (
    <div
      ref={box}
      className="relative mx-auto w-full touch-none select-none"
      onPointerMove={onPointerMove}
      onPointerUp={() => (dragging.current = null)}
      onPointerCancel={() => (dragging.current = null)}
    >
      <img src={src} alt="Foto del plano" className="block max-h-[60vh] w-full object-contain" draggable={false} />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full">
        <polygon points={poly} className="fill-accent/10 stroke-accent" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
      </svg>
      {corners.map(([x, y], i) => (
        <button
          key={NAMES[i]}
          type="button"
          role="slider"
          aria-label={`Esquina ${NAMES[i]}`}
          aria-valuetext={`${Math.round(x * 100)}% horizontal, ${Math.round(y * 100)}% vertical`}
          aria-valuenow={Math.round(x * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          onPointerDown={(e) => {
            dragging.current = i
            ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
          }}
          onKeyDown={onKey(i)}
          className="absolute size-11 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full active:cursor-grabbing"
          style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
        >
          <span className="absolute inset-3 rounded-full border-2 border-accent bg-canvas/70 shadow-[0_0_10px_var(--color-accent)]" />
        </button>
      ))}
    </div>
  )
}
