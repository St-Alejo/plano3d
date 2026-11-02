/**
 * Selector de pisos en la escena 3D: ocultar los niveles de encima del piso elegido y
 * resaltar un piso con una caja de líneas. Trabaja sobre `userData.levelId`, que el
 * SceneBuilder pone en muros, pisos, aberturas, escaleras, cubierta y muebles.
 */
import * as THREE from 'three'

const HIDDEN_FLAG = 'levelFocusHidden'
const HIGHLIGHT = 'level-highlight'

/** Oculta lo que pertenece a `hidden`; vuelve a mostrar solo lo que esta función ocultó antes. */
export function applyLevelFocus(root: THREE.Object3D, hidden: ReadonlySet<string>): number {
  let count = 0
  root.traverse((o) => {
    const id = o.userData.levelId as string | undefined
    if (id && hidden.has(id)) {
      if (o.visible) {
        o.visible = false
        o.userData[HIDDEN_FLAG] = true
      }
      count++
    } else if (o.userData[HIDDEN_FLAG]) {
      o.visible = true
      delete o.userData[HIDDEN_FLAG]
    }
  })
  return count
}

/** Caja envolvente (en el mundo) de lo visible de un nivel. */
export function levelBounds(root: THREE.Object3D, levelId: string): THREE.Box3 {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3()
  root.traverse((o) => {
    if (o.userData.levelId === levelId && (o as THREE.Mesh).isMesh && o.visible) box.expandByObject(o)
  })
  return box
}

/** Dibuja (o quita, con `null`) la caja de resaltado de un piso. */
export function highlightLevel(root: THREE.Object3D, levelId: string | null, color: THREE.ColorRepresentation = '#2f6b55'): THREE.Box3Helper | null {
  const old = root.getObjectByName(HIGHLIGHT)
  if (old) {
    old.removeFromParent()
    const helper = old as THREE.Box3Helper
    helper.geometry.dispose()
    ;(helper.material as THREE.Material).dispose()
  }
  if (!levelId) return null
  const box = levelBounds(root, levelId)
  if (box.isEmpty()) return null
  const helper = new THREE.Box3Helper(box.expandByScalar(0.05), color)
  helper.name = HIGHLIGHT
  // no se exporta ni se toca con el ratón: es solo una guía
  helper.userData = { kind: 'guide' }
  helper.raycast = () => undefined
  root.add(helper)
  return helper
}
