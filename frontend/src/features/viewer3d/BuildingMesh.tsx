import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { BuildingModel } from '@/api/types'
import { kindOf } from './doors'
import { MaterialFactory } from './scene/MaterialFactory'
import { useWalk } from './walkStore'
import { prefersReducedMotion } from './motion'
import { disposeScene, type BuiltScene } from './scene/SceneBuilder'
import { presentacion, type ModeOptions, type ViewModeStrategy } from './modes'

const GROW_SECONDS = 1.4

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

const HIGHLIGHT = new THREE.Color('#2f80ed')

/**
 * Resalta un elemento de obra: las mallas con ese `elementId` toman el material de resaltado
 * y, en los ladrillos instanciados, las piezas de ese paño se tiñen de azul.
 */
function highlightStructure(root: THREE.Object3D, id: string | null | undefined, highlight: THREE.Material) {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || obj.userData.kind !== 'structure') return
    if (obj instanceof THREE.InstancedMesh) {
      const panels = obj.userData.panelIds as string[] | undefined
      const colors = obj.instanceColor
      if (!panels || !colors) return
      const base = (obj.userData.baseColors ??= Float32Array.from(colors.array)) as Float32Array
      colors.array.set(base)
      if (id) panels.forEach((p, i) => p === id && HIGHLIGHT.toArray(colors.array, i * 3))
      colors.needsUpdate = true
      return
    }
    obj.userData.baseMaterial ??= obj.material
    obj.material = id && obj.userData.elementId === id ? highlight : (obj.userData.baseMaterial as THREE.Material)
  })
}

export interface Pick {
  kind: 'wall' | 'room' | 'furniture'
  id: string
}

/**
 * El edificio. Se reconstruye cuando cambia el modelo (el store es inmutable,
 * así que basta comparar referencias). Los muros "crecen" desde el suelo.
 */
export function BuildingMesh({
  model,
  strategy = presentacion,
  roof = false,
  textures = true,
  grow = true,
  highlightWallId,
  highlightElementId,
  brick,
  hideMasonry,
  onPick,
  onElement,
  onScene,
  onPoint,
}: {
  model: BuildingModel
  /** modo del plano: qué escena se arma (presentación, obra...) */
  strategy?: ViewModeStrategy
  /** cubierta sobre el último piso */
  roof?: boolean
  /** calidad alta: fotos PBR y detalles; sin ellas, la escena liviana de color liso */
  textures?: boolean
  grow?: boolean
  highlightWallId?: string | null
  /** modo obra: elemento resaltado (columneta, viga, paño...) */
  highlightElementId?: string | null
  brick?: ModeOptions['brick']
  hideMasonry?: boolean
  onPick?: (p: Pick) => void
  /** modo obra: se tocó un elemento estructural o un ladrillo (recibe el id del elemento o paño) */
  onElement?: (id: string) => void
  onScene?: (s: BuiltScene) => void
  /** modo medir: recibe el punto de la superficie tocada, en lugar de seleccionar */
  onPoint?: (p: [number, number, number]) => void
}) {
  // fotos PBR (public/texturas): se cargan en segundo plano, el material se ve liso mientras tanto
  const materials = useMemo(() => new MaterialFactory({ textures, base: import.meta.env.BASE_URL }), [textures])
  const scene = useMemo(
    () => strategy.build(model, materials, { roof, realism: textures, brick, hideMasonry }),
    [model, materials, strategy, roof, textures, brick, hideMasonry],
  )
  const progress = useRef(grow && !prefersReducedMotion() ? 0 : 1)
  const grownFor = useRef<string | null>(null)
  // useFrame anima a través de un ref: la escena memorizada no se muta durante el render
  const animated = useRef<THREE.Object3D[]>([])
  useEffect(() => {
    animated.current = [scene.walls, scene.glass, scene.furniture, scene.details]
  }, [scene])

  // solo se anima la primera vez que aparece cada proyecto, no en cada edición
  useEffect(() => {
    if (grownFor.current !== model.project_id) {
      grownFor.current = model.project_id
      progress.current = grow && !prefersReducedMotion() ? 0 : 1
    }
  }, [model.project_id, grow])

  useEffect(() => {
    onScene?.(scene)
    return () => disposeScene(scene)
  }, [scene, onScene])

  useEffect(() => () => materials.dispose(), [materials])

  useEffect(() => {
    scene.walls.children.forEach((obj) => {
      // en obra, `walls` son ladrillos y mortero: tienen su propio material
      if (!(obj instanceof THREE.Mesh) || obj.userData.kind !== 'wall') return
      const part = (obj.name.split(':')[1] ?? 'solid') as 'solid' | 'sill' | 'lintel'
      obj.material = obj.userData.wallId === highlightWallId ? materials.highlight() : materials.wall(part, obj.userData.material)
    })
  }, [scene, highlightWallId, materials])

  useEffect(() => highlightStructure(scene.root, highlightElementId, materials.highlight()), [scene, highlightElementId, materials])

  useFrame((_, dt) => {
    const done = progress.current >= 1
    if (!done) progress.current = Math.min(1, progress.current + dt / GROW_SECONDS)
    const s = done ? 1 : Math.max(0.001, easeOutCubic(progress.current))
    // mutar objetos de Three.js dentro de useFrame es el patrón recomendado por R3F (fuera del render de React)
    // eslint-disable-next-line react-hooks/immutability
    for (const obj of animated.current) obj.scale.y = s
  })

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (onPoint) {
      e.stopPropagation()
      onPoint([e.point.x, e.point.y, e.point.z])
      return
    }
    // tocar una puerta la abre o la cierra (en orbitar y en recorrer; con el mouse capturado se usa E)
    const hit = kindOf(e.object)
    if (hit?.kind === 'door' && !document.pointerLockElement) {
      e.stopPropagation()
      useWalk.getState().toggleDoor(String(hit.data.openingId))
      return
    }
    const data = e.object.userData as { kind?: string; wallId?: string; roomId?: string; furnitureId?: string; elementId?: string; panelIds?: string[] }
    if (data.kind === 'structure' && onElement) {
      const id = data.elementId ?? (e.instanceId != null ? data.panelIds?.[e.instanceId] : undefined)
      if (id) {
        e.stopPropagation()
        onElement(id)
      }
      return
    }
    if (!onPick) return
    e.stopPropagation()
    if (data.kind === 'furniture' && data.furnitureId) onPick({ kind: 'furniture', id: data.furnitureId })
    else if (data.kind === 'wall' && data.wallId) onPick({ kind: 'wall', id: data.wallId })
    else if (data.kind === 'room' && data.roomId) onPick({ kind: 'room', id: data.roomId })
  }

  return <primitive object={scene.root} onClick={handleClick} />
}
