/**
 * Escena 3D del hero. Lee el progreso del scroll en cada frame y aplica
 * `sceneAt(p)`: la foto torcida se endereza, los muros se trazan en tinta, se
 * extruyen y la cámara termina dentro del apartamento. El edificio es el mismo
 * `buildScene` del visor, con materiales "de maqueta" sobre papel.
 *
 * Puesta en escena de mesa de dibujo: el plano es una hoja con los extremos
 * enrollados sobre una mesa de piedra oscura, con un lápiz al lado. La hoja se
 * aplana a medida que se rectifica (nunca del todo: sigue siendo papel).
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

const SIGNAL = '#2f6b55'
const MARGIN = 1.7
/** piedra de la mesa (fondo de la escena) */
const STONE = '#171918'
/** largo de hoja que se enrolla en cada extremo (dentro del margen: el edificio queda plano) */
const CURL = 1.35

/** Generador pseudoaleatorio con semilla: el veteado sale igual en cada visita. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Piedra oscura con vetas claras, pintada en un canvas (sin descargar fotos). */
function useStoneTexture() {
  return useMemo(() => {
    const size = 1024
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = STONE
      ctx.fillRect(0, 0, size, size)
      const r = rng(7)
      for (let i = 0; i < 16; i++) {
        // pocas vetas finas y nítidas sobre nubes anchas y difusas
        const bright = i % 4 === 0
        ctx.strokeStyle = `rgba(236, 234, 226, ${bright ? 0.14 + r() * 0.12 : 0.025 + r() * 0.04})`
        ctx.lineWidth = bright ? 0.8 + r() * 1.2 : 14 + r() * 26
        ctx.shadowColor = 'rgba(236, 234, 226, 0.2)'
        ctx.shadowBlur = bright ? 4 : 30
        ctx.beginPath()
        const y0 = r() * size
        ctx.moveTo(-20, y0)
        // vetas casi diagonales, onduladas, que cruzan la losa
        ctx.bezierCurveTo(size * 0.3, y0 + (r() - 0.3) * 420, size * 0.65, y0 + (r() - 0.2) * 520, size + 20, y0 + (r() - 0.1) * 600)
        ctx.stroke()
      }
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(2, 2)
    texture.anisotropy = 8
    return texture
  }, [])
}

/**
 * Hoja de papel con los dos extremos enrollados. `setCurl(c)`, c ∈ [0, 1]: 0 plana, 1 enrollada.
 * La malla se deforma en sitio (la hoja está girada -90° en X: z local es la altura).
 */
class PaperSheet {
  readonly geo: THREE.PlaneGeometry
  private readonly base: Float32Array
  private readonly flat: number
  /** radio del rollo: con el largo CURL da casi una vuelta completa */
  private readonly R = CURL / (1.6 * Math.PI)
  private last = -1

  constructor(worldW: number, worldH: number) {
    this.geo = new THREE.PlaneGeometry(worldW, worldH, 120, 1)
    this.base = Float32Array.from(this.geo.attributes.position!.array)
    this.flat = worldW / 2 - CURL
    this.setCurl(1)
  }

  setCurl(curl: number): void {
    if (Math.abs(curl - this.last) < 0.002) return
    this.last = curl
    const { base, flat, R } = this
    const pos = this.geo.attributes.position!
    const r = curl > 0.001 ? R / curl : 0
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3]!
      const y = base[i * 3 + 1]!
      const d = Math.abs(x) - flat
      if (d <= 0 || !r) {
        pos.setXYZ(i, x, y, 0)
        continue
      }
      const theta = d / r
      pos.setXYZ(i, Math.sign(x) * (flat + r * Math.sin(theta)), y, r * (1 - Math.cos(theta)))
    }
    pos.needsUpdate = true
    this.geo.computeVertexNormals()
  }
}

/** Lápiz hexagonal de grafito, acostado sobre la mesa. */
function Pencil(props: { position: [number, number, number]; rotationY: number }) {
  const L = 1.7
  return (
    <group position={props.position} rotation-y={props.rotationY}>
      <group rotation-z={Math.PI / 2}>
        <mesh castShadow>
          <cylinderGeometry args={[0.05, 0.05, L, 6]} />
          <meshStandardMaterial color="#232524" roughness={0.45} metalness={0.15} />
        </mesh>
        <mesh position={[0, L / 2 + 0.09, 0]} castShadow>
          <cylinderGeometry args={[0.012, 0.05, 0.18, 6]} />
          <meshStandardMaterial color="#d8bc93" roughness={0.9} />
        </mesh>
        <mesh position={[0, L / 2 + 0.2, 0]}>
          <coneGeometry args={[0.012, 0.05, 6]} />
          <meshStandardMaterial color="#3a3a3a" roughness={0.6} />
        </mesh>
        <mesh position={[0, -L / 2 - 0.04, 0]} castShadow>
          <cylinderGeometry args={[0.052, 0.052, 0.08, 12]} />
          <meshStandardMaterial color="#b9bcb8" roughness={0.3} metalness={0.8} />
        </mesh>
      </group>
    </group>
  )
}

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
  const sheetGeo = useMemo(() => new PaperSheet(paper.worldW, paper.worldH), [paper.worldW, paper.worldH])
  const stone = useStoneTexture()
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
  useEffect(() => () => sheetGeo.geo.dispose(), [sheetGeo])
  useEffect(() => () => stone.dispose(), [stone])
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
    // la hoja llega enrollada y se aplana al rectificarse (queda un poco curva en los extremos)
    sheetGeo.setCurl(0.35 + 0.65 * st.skew)
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
      <color attach="background" args={[STONE]} />
      <ambientLight intensity={0.75} />
      <hemisphereLight args={['#ffffff', '#b8bcb6', 0.9]} />
      <directionalLight
        position={[paper.center.x - 6, 11, paper.center.z - 4]}
        intensity={2.3}
        color="#fffaf2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />
      {/* mesa de piedra: recibe la sombra de la hoja, del lápiz y de la maqueta */}
      <mesh rotation-x={-Math.PI / 2} position={[paper.center.x, -0.02, paper.center.z]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial map={stone} roughness={0.35} metalness={0.05} />
      </mesh>
      <Pencil position={[paper.center.x + paper.worldW * 0.22, 0.03, paper.center.z + paper.worldH / 2 + 0.55]} rotationY={0.32} />
      <group ref={sheet} position={[paper.center.x, 0, paper.center.z]}>
        <mesh rotation-x={-Math.PI / 2} geometry={sheetGeo.geo} receiveShadow castShadow>
          <meshStandardMaterial ref={sheetMat} map={paper.texture} roughness={0.95} side={THREE.DoubleSide} transparent />
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
