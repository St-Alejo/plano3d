import { Html, Line, OrbitControls, useTexture } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import type { BuildingModel, Point } from '@/api/types'
import { modelBounds } from '@/domain/model'
import { sunDirection, type SunPosition } from '@/domain/sun'
import { BuildingMesh, type Pick } from './BuildingMesh'
import { prefersReducedMotion } from './motion'
import { WalkControls, type WalkInput } from './WalkControls'
import type { BuiltScene } from './scene/SceneBuilder'
import { applyDisplayMode, cameraPreset, distance3, type CameraPreset, type DisplayMode } from './scene/viewTools'

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
  /** estudio solar: posición del sol (null = luz fija del visor) */
  sun?: SunPosition | null
  /** corte horizontal a esta altura en metros (null = sin corte) */
  section?: number | null
  /** encuadre pedido; `nonce` permite repetir el mismo encuadre */
  preset?: { name: CameraPreset; nonce: number } | null
  display?: DisplayMode
  /** medir en 3D: puntos marcados y callback al tocar una superficie */
  measure?: { points: [number, number, number][]; onPoint: (p: [number, number, number]) => void } | null
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
function OrbitRig({ model, flyTo, preset }: { model: BuildingModel; flyTo?: Point | null; preset?: { name: CameraPreset; nonce: number } | null }) {
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
    if (!preset) return
    const p = cameraPreset(preset.name, bounds)
    const pos = new THREE.Vector3(...p.position)
    const look = new THREE.Vector3(...p.target)
    if (prefersReducedMotion()) {
      camera.position.copy(pos)
      controls.current?.target.copy(look)
      controls.current?.update()
    } else target.current = { pos, look }
  }, [preset, bounds, camera])

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

function Lights({ model, ground, sun }: { model: BuildingModel; ground: string; sun?: SunPosition | null }) {
  const { center, size } = useMemo(() => modelBounds(model), [model])
  // con estudio solar, la luz principal sale de la dirección real del sol
  const dir = sun ? sunDirection(sun) : null
  const day = !sun || sun.altitude > 0
  const sunPos: [number, number, number] = dir
    ? [center.x + dir[0] * size * 2.2, Math.max(0.5, dir[1] * size * 2.2), center.y + dir[2] * size * 2.2]
    : [center.x + size * 0.35, size * 2.2, center.y + size * 0.25]
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
        position={sunPos}
        intensity={day ? 2.0 : 0.05}
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

/** Corte de sección: plano horizontal que recorta todo lo que está por encima de `height`. */
function SectionClip({ height }: { height: number | null }) {
  const plane = useMemo(() => (height == null ? null : new THREE.Plane(new THREE.Vector3(0, -1, 0), height)), [height])
  // el renderer se ajusta dentro del bucle de render de three (no durante el render de React)
  useFrame(({ gl }) => {
    const current = gl.clippingPlanes[0] ?? null
    if (current !== plane) gl.clippingPlanes = plane ? [plane] : []
  })
  return null
}

/** Línea y distancia entre los puntos marcados con la herramienta medir. */
function MeasureMarks({ points }: { points: [number, number, number][] }) {
  if (points.length === 0) return null
  const [a, b] = points
  return (
    <group>
      {points.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.06, 16, 16]} />
          <meshBasicMaterial color="#e2531b" depthTest={false} />
        </mesh>
      ))}
      {a && b && (
        <>
          <Line points={[a, b]} color="#e2531b" lineWidth={2} depthTest={false} />
          <Html position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.15, (a[2] + b[2]) / 2]} center>
            <span role="status" className="rounded-sm bg-canvas/90 px-1.5 py-0.5 font-mono text-xs whitespace-nowrap text-fg">
              {distance3(a, b).toFixed(2)} m
            </span>
          </Html>
        </>
      )}
    </group>
  )
}

/** Color de fondo del visor coherente con el tema (claro: papel; oscuro: carbón). */
function useThemeSky(): string {
  const read = () => (document.documentElement.dataset.theme === 'light' ? '#e9e9e3' : '#151816')
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
  sun,
  section = null,
  preset,
  display = 'material',
  measure,
}: Viewer3DProps) {
  const [built, setBuilt] = useState<BuiltScene | null>(null)
  // estable: BuildingMesh libera la escena anterior cuando cambia este callback
  const handleScene = useCallback(
    (s: BuiltScene) => {
      setBuilt(s)
      onScene?.(s)
    },
    [onScene],
  )
  useEffect(() => {
    if (built) applyDisplayMode(built.root, display)
  }, [built, display])
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
        <Lights model={model} ground={sky === '#151816' ? '#202421' : '#d5d6cd'} sun={sun} />
        <SectionClip height={section} />
        <BuildingMesh
          model={model}
          grow={grow}
          highlightWallId={highlightWallId}
          onPick={onPick}
          onScene={handleScene}
          onPoint={measure?.onPoint}
        />
        {measure && <MeasureMarks points={measure.points} />}
        {overlayUrl && overlayOpacity > 0 && (
          <Suspense fallback={null}>
            <PlanOverlay model={model} url={overlayUrl} opacity={overlayOpacity} />
          </Suspense>
        )}
        {mode === 'orbit' ? (
          <OrbitRig model={model} flyTo={flyTo} preset={preset} />
        ) : (
          <WalkControls model={model} start={start} input={walkInput ?? fallbackInput} touch={touch} />
        )}
      </Canvas>
    </div>
  )
}
