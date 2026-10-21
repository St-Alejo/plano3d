/**
 * Secuencia constructiva en la escena de obra: según el tiempo `t` (pasos, con fracción) se ve
 * lo ya construido, el paso en curso aparece poco a poco y lo que falta queda oculto.
 *
 * - Ladrillo: las instancias van ordenadas de abajo hacia arriba, así que basta con mostrar las
 *   primeras `count`: las hiladas suben.
 * - Concreto: la malla crece desde su fondo, como si se llenara la formaleta.
 * - Acero: las barras de la etapa aparecen en grupo.
 */
import * as THREE from 'three'

interface Saved {
  y: number
  height: number
  count: number
}

/** Estado original de cada malla, para poder retroceder en la secuencia. */
function saved(obj: THREE.Mesh): Saved {
  if (!obj.userData.timeline) {
    obj.geometry.computeBoundingBox()
    const box = obj.geometry.boundingBox!
    obj.userData.timeline = { y: obj.position.y, height: box.max.y - box.min.y, count: obj instanceof THREE.InstancedMesh ? obj.count : 1 } satisfies Saved
  }
  return obj.userData.timeline as Saved
}

/** Fracción ya construida de un paso cuando la secuencia va en `t`. */
export function stepProgress(index: number, t: number): number {
  return Math.min(1, Math.max(0, t - index))
}

/**
 * Aplica la secuencia en `t` ∈ [0, steps.length]: el paso `i` se construye entre `t = i` y
 * `t = i + 1`. Las mallas sin `userData.step` no se tocan.
 */
export function stepTimeline(root: THREE.Object3D, steps: string[], t: number): void {
  const order = new Map(steps.map((id, i) => [id, i]))
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const step = obj.userData.step as string | undefined
    const index = step === undefined ? undefined : order.get(step)
    if (index === undefined) return
    const k = stepProgress(index, t)
    const s = saved(obj)
    obj.visible = k > 0
    if (obj instanceof THREE.InstancedMesh) {
      const bottoms = obj.userData.bottoms as number[] | undefined
      if (bottoms && bottoms.length > 0) {
        // hiladas: hasta la altura que corresponde a la fracción del paso
        const lo = bottoms[0]!
        const hi = bottoms[bottoms.length - 1]!
        const level = lo + (hi - lo) * k
        let n = 0
        while (n < bottoms.length && bottoms[n]! <= level + 1e-6 && k > 0) n++
        obj.count = k >= 1 ? s.count : n
      } else obj.count = s.count
      return
    }
    // las placas son extrusiones acostadas (su y local no es la vertical): solo aparecen
    if (obj.rotation.x !== 0 || obj.rotation.z !== 0) return
    // concreto que se llena: crece desde el fondo de la formaleta
    const fill = k >= 1 ? 1 : Math.max(0.001, k)
    obj.scale.y = fill
    obj.position.y = s.y - (s.height * (1 - fill)) / 2
  })
}
