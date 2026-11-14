/**
 * Toques interactivos de las fotos: un punto vivo sobre algo de la foto (la casa, la puerta,
 * las guirnaldas) que, al pasar el cursor o al tocarlo, enciende las luces o abre la puerta.
 *
 * Las fotos van con `object-cover`, así que la parte visible cambia con la pantalla:
 * `CoverBox` calcula el rectángulo que ocupa la imagen completa dentro de su marco y los puntos
 * se ubican en porcentajes de la imagen, no de la pantalla.
 */
import { motion, type MotionValue } from 'motion/react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useFinePointer } from './useLight'

/** Rectángulo de la imagen completa (con `object-cover` y `object-position` x/y) dentro del marco. */
function useCoverRect(aspect: number, posX: number, posY: number) {
  const box = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState({ left: 0, top: 0, width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const W = el.clientWidth
      const H = el.clientHeight
      if (!W || !H) return
      // la imagen cubre el marco: su ancho es el mayor entre el del marco y el que pide el alto
      const w = Math.max(W, H * aspect)
      const h = w / aspect
      setRect({ left: (W - w) * posX, top: (H - h) * posY, width: w, height: h })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [aspect, posX, posY])
  return { box, rect }
}

/** Marco del tamaño de la foto: sus hijos se ubican en % de la imagen completa. */
export function CoverBox({ aspect, posX = 0.5, posY = 0.5, children }: { aspect: number; posX?: number; posY?: number; children: ReactNode }) {
  const { box, rect } = useCoverRect(aspect, posX, posY)
  return (
    <div ref={box} className="pointer-events-none absolute inset-0">
      <div className="absolute" style={rect}>
        {children}
      </div>
    </div>
  )
}

export interface Spot {
  /** zona sensible en % de la imagen */
  x: number
  y: number
  w: number
  h: number
  /** dónde va el punto, en % de la imagen */
  dotX: number
  dotY: number
}

/**
 * Zona sensible + punto vivo. Pasar el cursor por la zona llama `onHover`; el punto es un
 * botón (44 px de toque) que alterna el estado, con su rótulo al lado.
 */
export function Hotspot({ spot, label, hint, pressed, active, onHover, onToggle }: { spot: Spot; label: string; hint: string; pressed: boolean; active: boolean; onHover: () => void; onToggle: () => void }) {
  const fine = useFinePointer()
  if (!active) return null
  return (
    <>
      {fine && (
        <div
          aria-hidden
          className="pointer-events-auto absolute cursor-pointer"
          style={{ left: `${spot.x}%`, top: `${spot.y}%`, width: `${spot.w}%`, height: `${spot.h}%` }}
          onPointerEnter={onHover}
          onClick={onToggle}
        />
      )}
      <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${spot.dotX}%`, top: `${spot.dotY}%` }}>
        <motion.button
          type="button"
          aria-pressed={pressed}
          aria-label={label}
          onClick={onToggle}
          onPointerEnter={fine ? onHover : undefined}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="group pointer-events-auto relative grid size-11 cursor-pointer place-items-center rounded-full"
        >
          {/* anillo que late mientras no se ha usado */}
          {!pressed && <span aria-hidden className="absolute inset-1 animate-ping rounded-full bg-[#ffcf9a]/40 [animation-duration:1.8s]" />}
          <span aria-hidden className={`relative size-3.5 rounded-full ring-2 transition-[background-color,box-shadow] duration-500 ${pressed ? 'bg-[#ffd9a8] shadow-[0_0_24px_8px_rgb(255_190_120/0.75)] ring-white/70' : 'bg-white/90 ring-white/40'}`} />
          <span
            aria-hidden
            className="t-label pointer-events-none absolute top-1/2 left-full ml-2 -translate-y-1/2 whitespace-nowrap rounded-full bg-black/55 px-3 py-1.5 text-[0.68rem] text-white opacity-0 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            {hint}
          </span>
        </motion.button>
      </div>
    </>
  )
}

/** Resplandor cálido alrededor de un punto de la imagen (se suma a la foto con `screen`). */
export function Glow({ x, y, r = 40, opacity }: { x: number; y: number; r?: number; opacity: MotionValue<number> }) {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0 mix-blend-screen"
      style={{ opacity, background: `radial-gradient(circle at ${x}% ${y}%, rgb(255 176 96 / 0.9), rgb(255 140 60 / 0.25) ${r * 0.5}%, transparent ${r}%)` }}
    />
  )
}
