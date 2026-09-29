import { useRef, useState, type PointerEvent } from 'react'

const RADIUS = 48

/** Joystick táctil: emite un vector -1..1 (y positivo = adelante). */
export function Joystick({ onChange }: { onChange: (x: number, y: number) => void }) {
  const base = useRef<HTMLDivElement>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })

  const move = (e: PointerEvent) => {
    if (!base.current || e.buttons === 0) return
    const r = base.current.getBoundingClientRect()
    let dx = e.clientX - (r.left + r.width / 2)
    let dy = e.clientY - (r.top + r.height / 2)
    const d = Math.hypot(dx, dy)
    if (d > RADIUS) {
      dx = (dx / d) * RADIUS
      dy = (dy / d) * RADIUS
    }
    setKnob({ x: dx, y: dy })
    onChange(dx / RADIUS, -dy / RADIUS)
  }
  const release = () => {
    setKnob({ x: 0, y: 0 })
    onChange(0, 0)
  }

  return (
    <div
      ref={base}
      role="application"
      aria-label="Joystick para caminar"
      className="relative size-32 touch-none rounded-full border border-line-strong bg-canvas/60 backdrop-blur"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId)
        move(e)
      }}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div
        className="absolute top-1/2 left-1/2 size-12 rounded-full border-2 border-accent bg-accent/20"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
    </div>
  )
}
