import { OrbitControls, useTexture } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import type { BuildingModel, Point } from '@/api/types'
import { modelBounds } from '@/domain/model'
import { BuildingMesh, type Pick } from './BuildingMesh'
import { prefersReducedMotion } from './motion'
import { WalkControls, type WalkInput } from './WalkControls'
import type { BuiltScene } from './scene/SceneBuilder'

export type ViewMode = 'orbit' | 'walk'

export interface Viewer3DProps {
  model: BuildingModel
  mode?: ViewMode
  /** imagen del plano original proyectada en el piso (control antes/después) */
  overlayUrl?: string
  overlayOpacity?: number
  flyTo?: Point | null
  walkStart?: Point
  walkInput?: React.RefObject<WalkInput>
  touch?: boolean
  grow?: boolean
  highlightWallId?: string | null
  onPick?: (p: Pick) => void
  onScene?: (s: BuiltScene) => void
  className?: string
  label?: string
}

function PlanOverlay({ model, url, opacity }: { model: BuildingModel; url: string; opacity: number }) {
  const texture = useTexture(url, (t) => {
    t.colorSpace = THREE.SRGBColorSpace
  })
  const img = model.source_image
  if (!img) return null
  const w = img.width_px * model.scale.meters_per_pixel
  const h = img.height_px * model.scale.meters_per_pixel
  return (
    <mesh rotation-x={-Math.PI / 2} position={[w / 2, 0.012, h / 2]} renderOrder={2}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={texture} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

/** Encuadra la cámara al modelo y anima los "vuelos" a un ambiente. */
function OrbitRig({ model, flyTo }: { model: BuildingModel; flyTo?: Point | null }) {
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null)
  const { camera } = useThree()
  const bounds = useMemo(() => modelBounds(model), [model])
  const target = useRef<{ pos: THREE.Vector3; look: THREE.Vector3 } | null>(null)
  const framed = useRef<string | null>(null)

  useEffect(() => {
    if (framed.current === model.project_id) return
    framed.current = model.project_id
    const { center, size } = bounds
    camera.position.set(center.x + size * 0.6, size * 0.9, center.y + size * 1.1)
    controls.current?.target.set(center.x, 0, center.y)
    controls.current?.update()
  }, [bounds, camera, model.project_id])

  useEffect(() => {
    if (!flyTo) return
    const look = new THREE.Vector3(flyTo.x, 0.8, flyTo.y)
    const pos = new THREE.Vector3(flyTo.x + 2.5, 4.5, flyTo.y + 3.5)
    if (prefersReducedMotion()) {
      camera.position.copy(pos)
      controls.current?.target.copy(look)
    } else target.current = { pos, look }
  }, [flyTo, camera])

  useFrame((_, dt) => {
    const t = target.current
    const c = controls.current
    if (!t || !c) return
    const k = 1 - Math.exp(-dt * 4)
    camera.position.lerp(t.pos, k)
    c.target.lerp(t.look, k)
    c.update()
    if (camera.position.distanceTo(t.pos) < 0.02) target.current = null
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      maxPolarAngle={Math.PI / 2 - 0.05}
      minDistance={1.5}
      maxDistance={bounds.size * 4}
    />
  )
}

function Lights({ model, ground }: { model: BuildingModel; ground: string }) {
  const { center, size } = useMemo(() => modelBounds(model), [model])
  const light = useRef<THREE.DirectionalLight>(null)
  useEffect(() => {
    const l = light.current
    if (!l) return
    l.target.position.set(center.x, 0, center.y)
    l.target.updateMatrixWorld()
    const cam = l.shadow.camera
    cam.left = cam.bottom = -size
    cam.right = cam.top = size
    cam.updateProjectionMatrix()
  }, [center, size])
  return (
    <>
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#eaf4ff', '#3a3f4a', 1.4]} />
      <directionalLight
        ref={light}
        position={[center.x + size * 0.35, size * 2.2, center.y + size * 0.25]}
        intensity={2.0}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
      />
      <mesh rotation-x={-Math.PI / 2} position={[center.x, -0.06, center.y]} receiveShadow>
        <planeGeometry args={[size * 6, size * 6]} />
        <meshStandardMaterial color={ground} roughness={1} />
      </mesh>
    </>
  )
}

/** Color de fondo del visor coherente con el tema (oscuro: noche de plano; claro: papel). */
function useThemeSky(): string {
  const read = () => (document.documentElement.dataset.theme === 'light' ? '#dfe3d6' : '#070f22')
  const [sky, setSky] = useState(read)
  useEffect(() => {
    const obs = new MutationObserver(() => setSky(read()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return sky
}

export function Viewer3D({
  model,
  mode = 'orbit',
  overlayUrl,
  overlayOpacity = 0,
  flyTo,
  walkStart,
  walkInput,
  touch = false,
  grow = true,
  highlightWallId,
  onPick,
  onScene,
  className,
  label = 'Vista 3D del edificio',
}: Viewer3DProps) {
  const fallbackInput = useRef<WalkInput>({ x: 0, y: 0 })
  const start = walkStart ?? modelBounds(model).center
  const sky = useThemeSky()
  return (
    <div className={className} role="img" aria-label={label}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ fov: 55, near: 0.05, far: 500, position: [10, 10, 10] }}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
      >
        <color attach="background" args={[sky]} />
        <fog attach="fog" args={[sky, 30, 120]} />
        <Lights model={model} ground={sky === '#070f22' ? '#132640' : '#c9cebf'} />
        <BuildingMesh model={model} grow={grow} highlightWallId={highlightWallId} onPick={onPick} onScene={onScene} />
        {overlayUrl && overlayOpacity > 0 && (
          <Suspense fallback={null}>
            <PlanOverlay model={model} url={overlayUrl} opacity={overlayOpacity} />
          </Suspense>
        )}
        {mode === 'orbit' ? (
          <OrbitRig model={model} flyTo={flyTo} />
        ) : (
          <WalkControls model={model} start={start} input={walkInput ?? fallbackInput} touch={touch} />
        )}
      </Canvas>
    </div>
  )
}
