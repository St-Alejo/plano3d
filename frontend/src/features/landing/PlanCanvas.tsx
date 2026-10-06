import { useEffect, useRef } from 'react'
import type { BuildingModel } from '@/api/types'
import { drawPlan, fitFrame, INK_STYLE, type PlanStyle } from './drawPlan'

/** El plano dibujado en tinta, a la resolución del dispositivo y redibujado al cambiar de tamaño. */
export function PlanCanvas({
  model,
  style = INK_STYLE,
  className,
  label,
}: {
  model: BuildingModel
  style?: PlanStyle
  className?: string
  label: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect()
      if (width === 0 || height === 0) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawPlan(ctx, model, fitFrame(model, width, height, Math.min(width, height) * 0.12), style)
    }
    draw()
    // las fuentes web cambian las métricas del texto: se redibuja cuando terminan de cargar
    void document.fonts?.ready.then(draw)
    const obs = new ResizeObserver(draw)
    obs.observe(canvas)
    return () => obs.disconnect()
  }, [model, style])
  return <canvas ref={ref} className={className} role="img" aria-label={label} />
}
