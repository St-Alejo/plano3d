import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { BuildingModel } from '@/api/types'
import { MaterialFactory } from './scene/MaterialFactory'
import { prefersReducedMotion } from './motion'
import { buildScene, disposeScene, type BuiltScene } from './scene/SceneBuilder'

const GROW_SECONDS = 1.4

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

export interface Pick {
  kind: 'wall' | 'room'
  id: string
}

/**
 * El edificio. Se reconstruye cuando cambia el modelo (el store es inmutable,
 * así que basta comparar referencias). Los muros "crecen" desde el suelo.
 */
export function BuildingMesh({
  model,
  grow = true,
  highlightWallId,
  onPick,
  onScene,
}: {
  model: BuildingModel
  grow?: boolean
  highlightWallId?: string | null
  onPick?: (p: Pick) => void
  onScene?: (s: BuiltScene) => void
}) {
  const materials = useMemo(() => new MaterialFactory(), [])
  const scene = useMemo(() => buildScene(model, materials), [model, materials])
  const progress = useRef(grow && !prefersReducedMotion() ? 0 : 1)
  const grownFor = useRef<string | null>(null)
  // useFrame anima a través de un ref: la escena memorizada no se muta durante el render
  const animated = useRef<THREE.Object3D[]>([])
  useEffect(() => {
    animated.current = [scene.walls, scene.glass]
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
      if (!(obj instanceof THREE.Mesh)) return
      const part = (obj.name.split(':')[1] ?? 'solid') as 'solid' | 'sill' | 'lintel'
      obj.material = obj.userData.wallId === highlightWallId ? materials.highlight() : materials.wall(part)
    })
  }, [scene, highlightWallId, materials])

  useFrame((_, dt) => {
    const done = progress.current >= 1
    if (!done) progress.current = Math.min(1, progress.current + dt / GROW_SECONDS)
    const s = done ? 1 : Math.max(0.001, easeOutCubic(progress.current))
    // mutar objetos de Three.js dentro de useFrame es el patrón recomendado por R3F (fuera del render de React)
    // eslint-disable-next-line react-hooks/immutability
    for (const obj of animated.current) obj.scale.y = s
  })

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!onPick) return
    e.stopPropagation()
    const data = e.object.userData as { kind?: string; wallId?: string; roomId?: string }
    if (data.kind === 'wall' && data.wallId) onPick({ kind: 'wall', id: data.wallId })
    else if (data.kind === 'room' && data.roomId) onPick({ kind: 'room', id: data.roomId })
  }

  return <primitive object={scene.root} onClick={handleClick} />
}
