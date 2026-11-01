import { createContext, useContext } from 'react'

/**
 * Hueco de la cabecera del AppShell en el editor: la página del proyecto pone ahí sus
 * migas (Proyectos / nombre / estado) en vez de apilar otra barra sobre el lienzo.
 * Es `null` fuera del editor o mientras la cabecera no se ha montado.
 */
export const HeaderSlotContext = createContext<HTMLElement | null>(null)

export const useHeaderSlot = () => useContext(HeaderSlotContext)
