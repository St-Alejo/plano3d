/**
 * Escena 3D del hero. Lee el progreso del scroll en cada frame y aplica
 * `sceneAt(p)`: la foto torcida se endereza, los muros se trazan en tinta, se
 * extruyen y la cámara termina dentro del apartamento. El edificio es el mismo
 * `buildScene` del visor, con materiales "de maqueta" sobre papel.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import type { MotionValue } from 'motion/react'
import { useMotionValueEvent } from 'motion/react'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import type { BuildingModel } from '@/api/types'
import { modelBounds } from '@/domain/model'
import { MaterialFactory } from '@/features/viewer3d/scene/MaterialFactory'
import { buildScene, disposeScene, type BuiltScene } from '@/features/viewer3d/scene/SceneBuilder'
import { drawPlan, INK_STYLE, type PlanFrame } from './drawPlan'
import { sceneAt } from './sequence'

const PAPER = '#f2eee4'
const SIGNAL = '#e2531b'
const MARGIN = 1.7

function usePaperTexture(model: BuildingModel) {
  return useMemo(() => {
    const b = modelBounds(model)
    const worldW = b.maxX - b.minX + 2 * MARGIN
    const worldH = b.maxY - b.minY + 2 * MARGIN
    const W = 2048
    const H = Math.round((W * worldH) / worldW)
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    const scale = W / worldW
    const frame: PlanFrame = { scale, ox: (MARGIN - b.minX) * scale, oy: (MARGIN - b.minY) * scale, width: W, height: H }
    if (ctx) drawPlan(ctx, model, frame, INK_STYLE)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    return { texture, worldW, worldH, center: new THREE.Vector3(b.minX + (b.maxX - b.minX) / 2, 0, b.minY + (b.maxY - b.minY) / 2) }
  }, [model])
}

/** Ejes de muros como segmentos: se "dibujan" variando el drawRange. */
function useTraceGeometry(model: BuildingModel) {
  return useMemo(() => {
    const pts: number[] = []
    for (const lv of model.levels)
      for (const w of lv.walls) pts.push(w.start.x, 0.02, w.start.y, w.end.x, 0.02, w.end.y)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return { geo, count: pts.length / 3 }
  }, [model])
}

function Scene({ model, progress }: { model: BuildingModel; progress: MotionValue<number> }) {
  const invalidate = useThree((st) => st.invalidate)
  const paper = usePaperTexture(model)
  const trace = useTraceGeometry(model)
  const materials = useMemo(() => new MaterialFactory(), [])
  const built = useMemo(() => buildScene(model, materials), [model, materials])
  const sheet = useRef<THREE.Group>(null)
  const sheetMat = useRef<THREE.MeshStandardMaterial>(null)
  const corners = useRef<THREE.Group>(null)
  const lineMat = useRef<THREE.LineBasicMaterial>(null)
  const look = useMemo(() => new THREE.Vector3(), [])

  // useFrame muta la escena a través de un ref (no el valor memorizado durante el render)
  const parts = useRef<BuiltScene | null>(null)
  useEffect(() => {
    parts.current = built
    return () => disposeScene(built)
  }, [built])
  useEffect(() => () => materials.dispose(), [materials])
  useEffect(() => () => paper.texture.dispose(), [paper])
  useEffect(() => () => trace.geo.dispose(), [trace])
  useMotionValueEvent(progress, 'change', () => invalidate())

  const b = useMemo(() => modelBounds(model), [model])
  const poses = useMemo(() => {
    const c = paper.center
    const s = b.size
    return {
      top: { pos: new THREE.Vector3(c.x, s * 2.15, c.z + 0.02), look: c.clone() },
      iso: { pos: new THREE.Vector3(c.x + s * 1.0, s * 1.12, c.z + s * 1.25), look: new THREE.Vector3(c.x, 0.4, c.z) },
      // dentro de la sala, mirando hacia la ventana grande
      eye: { pos: new THREE.Vector3(4.5, 1.55, 6.25), look: new THREE.Vector3(1.6, 1.25, 0.5) },
    }
  }, [paper.center, b.size])

  // la cámara llega como argumento de useFrame: se muta en el bucle de render de three, no en el de React
  useFrame(({ camera }) => {
    const st = sceneAt(progress.get())
    // la foto: girada y ladeada sobre su centro; se endereza al rectificar
    if (sheet.current) {
      sheet.current.rotation.set(-0.16 * st.skew, 0.2 * st.skew, 0.07 * st.skew)
      // rectificada, la hoja queda bajo los pisos (sin z-fighting con ellos)
      sheet.current.position.y = 0.25 * st.skew - 0.015
    }
    if (sheetMat.current) sheetMat.current.opacity = st.paper
    if (corners.current) {
      corners.current.visible = st.corners > 0.01
      corners.current.children.forEach((c) => c.scale.setScalar(Math.max(0.001, st.corners)))
    }
    trace.geo.setDrawRange(0, Math.floor(trace.count * st.trace / 2) * 2)
    if (lineMat.current) lineMat.current.opacity = st.trace * (1 - st.extrude)
    const h = Math.max(0.001, st.extrude)
    const sc = parts.current
    if (sc) {
      sc.walls.scale.y = h
      sc.glass.scale.y = h
      sc.elements.scale.y = h
      sc.root.visible = st.extrude > 0.005
      sc.floors.visible = st.extrude > 0.05
    }
    // cámara: interpolación por tramos entre las tres poses
    const k = st.camera
    const [a, z] = k <= 1 ? [poses.top, poses.iso] : [poses.iso, poses.eye]
    const t = k <= 1 ? k : k - 1
    camera.position.lerpVectors(a.pos, z.pos, t)
    look.lerpVectors(a.look, z.look, t)
    camera.lookAt(look)
    // a la altura de los ojos se abre el campo visual, como al entrar a un cuarto
    const persp = camera as THREE.PerspectiveCamera
    const fov = 38 + 26 * Math.max(0, k - 1)
    if (Math.abs(persp.fov - fov) > 0.01) {
      persp.fov = fov
      persp.updateProjectionMatrix()
    }
  })

  const hw = paper.worldW / 2 - MARGIN * 0.35
  const hh = paper.worldH / 2 - MARGIN * 0.35
  return (
    <>
      <color attach="background" args={[PAPER]} />
      <ambientLight intensity={0.9} />
      <hemisphereLight args={['#fffaf0', '#b9b0a0', 0.9]} />
      <directionalLight
        position={[paper.center.x - 6, 11, paper.center.z - 4]}
        intensity={2.3}
        color="#fff3e2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />
      {/* mesa de trabajo: recibe la sombra de la hoja y de la maqueta */}
      <mesh rotation-x={-Math.PI / 2} position={[paper.center.x, -0.02, paper.center.z]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#e6dfd0" roughness={1} />
      </mesh>
      <group ref={sheet} position={[paper.center.x, 0, paper.center.z]}>
        <mesh rotation-x={-Math.PI / 2} receiveShadow castShadow>
          <planeGeometry args={[paper.worldW, paper.worldH]} />
          <meshStandardMaterial ref={sheetMat} map={paper.texture} roughness={0.95} transparent />
        </mesh>
        <group ref={corners}>
          {(
            [
              [-hw, -hh],
              [hw, -hh],
              [hw, hh],
              [-hw, hh],
            ] as const
          ).map(([x, z]) => (
            <mesh key={`${x}:${z}`} position={[x, 0.03, z]} rotation-x={-Math.PI / 2}>
              <ringGeometry args={[0.22, 0.32, 32]} />
              <meshBasicMaterial color={SIGNAL} />
            </mesh>
          ))}
        </group>
      </group>
      <lineSegments geometry={trace.geo}>
        <lineBasicMaterial ref={lineMat} color={SIGNAL} transparent linewidth={2} />
      </lineSegments>
      <primitive object={built.root} />
    </>
  )
}

export default function HeroScene({ model, progress }: { model: BuildingModel; progress: MotionValue<number> }) {
  return (
    <Canvas
      shadows
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ fov: 38, near: 0.05, far: 200 }}
      gl={{ antialias: true }}
      aria-hidden
    >
      <Scene model={model} progress={progress} />
    </Canvas>
  )
}
