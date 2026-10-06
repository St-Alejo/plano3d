import { AppWindow, DoorOpen, MousePointer2, PenLine, Ruler, Scaling } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Tool } from '@/store/editorStore'

export const TOOLS: { id: Tool; label: string; key: string; icon: ReactNode; hint: string; touchHint: string }[] = [
  { id: 'select', label: 'Seleccionar', key: 'V', icon: <MousePointer2 className="size-5" aria-hidden />, hint: 'Clic para seleccionar, arrastra el fondo para moverte, rueda para zoom.', touchHint: 'Toca para seleccionar, arrastra para moverte y pellizca con dos dedos para acercar.' },
  { id: 'wall', label: 'Dibujar muro', key: 'W', icon: <PenLine className="size-5" aria-hidden />, hint: 'Arrastra para dibujar un muro. Se imanta a extremos y a 0°/90°.', touchHint: 'Desliza el dedo para dibujar un muro. Se imanta a extremos y a 0°/90°.' },
  { id: 'door', label: 'Agregar puerta', key: 'D', icon: <DoorOpen className="size-5" aria-hidden />, hint: 'Haz clic sobre un muro para agregar una puerta.', touchHint: 'Toca un muro para agregar una puerta.' },
  { id: 'window', label: 'Agregar ventana', key: 'N', icon: <AppWindow className="size-5" aria-hidden />, hint: 'Haz clic sobre un muro para agregar una ventana.', touchHint: 'Toca un muro para agregar una ventana.' },
  { id: 'measure', label: 'Medir', key: 'M', icon: <Ruler className="size-5" aria-hidden />, hint: 'Clic en puntos sucesivos: 2 puntos miden una distancia; 3 o más, un área. Esc para empezar de nuevo.', touchHint: 'Toca puntos sucesivos: 2 puntos miden una distancia; 3 o más, un área.' },
  { id: 'calibrate', label: 'Calibrar escala', key: 'C', icon: <Scaling className="size-5" aria-hidden />, hint: 'Traza una línea sobre una medida conocida (p. ej. una cota) e ingresa los metros reales.', touchHint: 'Desliza el dedo sobre una medida conocida (p. ej. una cota) e ingresa los metros reales.' },
]
