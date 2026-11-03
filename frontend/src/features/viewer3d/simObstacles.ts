/**
 * Lo que se mueve en la simulación (personas y carros) como obstáculos por piso: lo escribe
 * el bucle de la simulación y lo lee el recorrido para no atravesar a nadie.
 */
import type { Obstacle } from '@/domain/collision'

let moving: { levelId: string; obstacle: Obstacle }[] = []

export function setSimObstacles(list: { levelId: string; obstacle: Obstacle }[]): void {
  moving = list
}

export function simObstacles(levelId: string): Obstacle[] {
  return moving.filter((m) => m.levelId === levelId).map((m) => m.obstacle)
}
