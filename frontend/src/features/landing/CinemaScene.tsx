/**
 * Escena de cine del hero: la misma casa, la misma cámara, de plano a hogar.
 *
 * - El plano es un holograma: las aristas de los muros de la casa terminada, en luz azul,
 *   dibujándose de abajo hacia arriba sobre el lote excavado.
 * - La obra es la escena del modo "secuencia" del visor, con su línea de tiempo real
 *   (`stepTimeline`): cimentación, placa, ladrillo hilada a hilada, columnetas y vigas.
 * - Los acabados entran con un barrido: un plano de corte recorre la casa y de un lado queda
 *   la obra gris y del otro la casa terminada, con texturas, muebles y pasto.
 * - Al final la cámara entra a la sala y se encienden las luces de adentro.
 *
 * Todo sale de los mismos constructores del visor (SceneBuilder y ConstructionBuilder): lo que
 * se ve en la landing es lo que hace la app con un plano.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useMotionValueEvent, type MotionValue } from 'motion/react'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import type { BuildingModel } from '@/api/types'
import { modelBounds } from '@/domain/model'
import { deriveStructure } from '@/domain/structure/derive'
import { masonryLayout } from '@/domain/structure/masonryLayout'
import { NSR10 } from '@/domain/structure/nsr10'
import { constructionSchedule, stagesOf } from '@/domain/structure/schedule'
import { ConstructionBuilder } from '@/features/viewer3d/scene/ConstructionBuilder'
import { MaterialFactory } from '@/features/viewer3d/scene/MaterialFactory'
import { buildScene, disposeScene, type BuiltScene } from '@/features/viewer3d/scene/SceneBuilder'
import { stepTimeline } from '@/features/viewer3d/scene/timeline'
import { cameraAt, sceneAt, type Pose } from './sequence'

/** cielo de atardecer ya entrado (fondo y niebla) */
const DUSK = '#10151c'
/** luz del holograma */
const HOLO = '#8cd2ff'
/** oro del barrido (mismo tono que el acento de la página) */
const GOLD = '#e3b341'
/** profundidad de la excavación, como en el modo obra del visor */
const PIT = NSR10.foundationDepth + 0.1

/** Aristas de los muros (en coordenadas de mundo), ordenadas de abajo hacia arriba. */
function hologramLines(root: THREE.Object3D, walls: THREE.Object3D): THREE.BufferGeometry {
  root.updateMatrixWorld(true)
  const segs: { y: number; p: number[] }[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  walls.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const edges = new THREE.EdgesGeometry(obj.geometry, 25)
    const pos = edges.getAttribute('position')
    for (let i = 0; i < pos.count; i += 2) {
      a.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld)
      b.fromBufferAttribute(pos, i + 1).applyMatrix4(obj.matrixWorld)
      segs.push({ y: Math.min(a.y, b.y) + Math.abs(a.y - b.y) * 0.25, p: [a.x, a.y, a.z, b.x, b.y, b.z] })
    }
    edges.dispose()
  })
  segs.sort((u, v) => u.y - v.y)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(segs.flatMap((s) => s.p), 3))
  return geo
}

/** Recorta con `plane` todos los materiales bajo `root` (cada escena tiene su fábrica de materiales). */
function clipAll(root: THREE.Object3D, plane: THREE.Plane) {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const list = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of list) {
      m.clippingPlanes = [plane]
      // el programa se recompila con el plano (puede haberse compilado ya sin él)
      m.needsUpdate = true
    }
  })
}

/** Lote excavado: terreno con un hueco del tamaño de la casa y el fondo de la zanja. */
function excavation(b: ReturnType<typeof modelBounds>, materials: MaterialFactory): THREE.Group {
  const g = new THREE.Group()
  const m = 0.7
  const [x0, x1, z0, z1] = [b.minX - m, b.maxX + m, b.minY - m, b.maxY + m]
  const R = 60
  const shape = new THREE.Shape([
    new THREE.Vector2(b.center.x - R, b.center.y - R),
    new THREE.Vector2(b.center.x + R, b.center.y - R),
    new THREE.Vector2(b.center.x + R, b.center.y + R),
    new THREE.Vector2(b.center.x - R, b.center.y + R),
  ])
  shape.holes.push(new THREE.Path([new THREE.Vector2(x0, z0), new THREE.Vector2(x0, z1), new THREE.Vector2(x1, z1), new THREE.Vector2(x1, z0)]))
  const earth = materials.earth()
  // la forma está en el plano XY: se acuesta y su "y" pasa a ser z
  const top = new THREE.Mesh(new THREE.ShapeGeometry(shape), earth)
  top.rotation.x = Math.PI / 2
  top.position.y = -0.03
  top.receiveShadow = true
  g.add(top)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), earth)
  floor.rotation.x = -Math.PI / 2
  floor.position.set((x0 + x1) / 2, -PIT, (z0 + z1) / 2)
  floor.receiveShadow = true
  g.add(floor)
  // paredes de la excavación
  const sides: [number, number, number, number][] = [
    [(x0 + x1) / 2, z0, x1 - x0, 0],
    [(x0 + x1) / 2, z1, x1 - x0, Math.PI],
    [x0, (z0 + z1) / 2, z1 - z0, Math.PI / 2],
    [x1, (z0 + z1) / 2, z1 - z0, -Math.PI / 2],
  ]
  for (const [x, z, w, ry] of sides) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, PIT), earth)
    wall.position.set(x, -PIT / 2 - 0.03, z)
    wall.rotation.y = ry
    wall.receiveShadow = true
    g.add(wall)
  }
  return g
}

interface Built {
  finished: BuiltScene
  work: BuiltScene
  steps: string[]
  /** paso (t de stepTimeline) en que termina cada tramo de obra: cimentación+placa, muros, estructura */
  marks: [number, number, number]
  holo: THREE.BufferGeometry
  /** velo tenue del holograma sobre las caras de los muros (un material para todos) */
  ghost: THREE.Group
  ghostMat: THREE.MeshBasicMaterial
  pit: THREE.Group
  ceiling: THREE.Mesh
  /** planos de corte del barrido: la obra queda a un lado, la casa terminada al otro */
  cut: { work: THREE.Plane; done: THREE.Plane }
}

/** Copias de los muros en `mat`, fijas en su posición de mundo. */
function ghostOf(walls: THREE.Object3D, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group()
  walls.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const m = new THREE.Mesh(obj.geometry, mat)
    m.matrixAutoUpdate = false
    m.matrix.copy(obj.matrixWorld)
    g.add(m)
  })
  return g
}

function useBuilt(model: BuildingModel): { built: Built; materials: MaterialFactory[] } {
  const materials = useMemo(() => [new MaterialFactory({ textures: true }), new MaterialFactory({ textures: true })], [])
  const built = useMemo<Built>(() => {
    const [fin, wrk] = materials as [MaterialFactory, MaterialFactory]
    const finished = buildScene(model, fin, { details: true, site: true })
    const s = deriveStructure(model, { brick: 'tolete' })
    const bricks = masonryLayout(model, s)
    const work = new ConstructionBuilder(model, s, wrk).withFoundations().withColumns().withBeams().withSlabs().withMasonry(bricks).withRebar().build()
    const schedule = constructionSchedule(model, s, bricks)
    const stages = stagesOf(schedule)
    const end = (ids: string[]) => Math.max(0, ...stages.filter((g) => ids.includes(g.id)).map((g) => g.to))
    const marks: [number, number, number] = [end(['cimentacion', 'placas']), end(['muros']), schedule.length]
    const holo = hologramLines(finished.root, finished.walls)
    const ghostMat = new THREE.MeshBasicMaterial({ color: HOLO, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
    const cut = { work: new THREE.Plane(new THREE.Vector3(1, 0, 0), 0), done: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0) }
    const pit = excavation(modelBounds(model), wrk)
    const bb = modelBounds(model)
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(bb.maxX - bb.minX, bb.maxY - bb.minY), new THREE.MeshStandardMaterial({ color: '#ece7dd', roughness: 0.95 }))
    ceiling.rotation.x = Math.PI / 2
    ceiling.position.set(bb.center.x, (model.levels[0]?.height ?? 2.4) - 0.01, bb.center.y)
    ceiling.visible = false
    return { finished, work, steps: schedule.map((x) => x.id), marks, holo, ghost: ghostOf(finished.walls, ghostMat), ghostMat, pit, ceiling, cut }
  }, [model, materials])
  return { built, materials }
}

/** Tramo de obra (0..3) → t de la línea de tiempo, repartido según los pasos de cada tramo. */
function buildToT(build: number, marks: [number, number, number]): number {
  const [m1, m2, m3] = marks
  if (build <= 1) return build * m1
  if (build <= 2) return m1 + (build - 1) * (m2 - m1)
  return m2 + (build - 2) * (m3 - m2)
}

function Scene({ model, progress }: { model: BuildingModel; progress: MotionValue<number> }) {
  const invalidate = useThree((s) => s.invalidate)
  const { built, materials } = useBuilt(model)
  const b = useMemo(() => modelBounds(model), [model])

  const holoMat = useRef<THREE.LineBasicMaterial>(null)
  const scan = useRef<THREE.Group>(null)
  const sun = useRef<THREE.DirectionalLight>(null)
  const lamps = useRef<THREE.Group>(null)
  const look = useMemo(() => new THREE.Vector3(), [])
  const intro = useRef(0)

  // la escena se arma una vez; useFrame la anima a través de este ref
  const parts = useRef<Built | null>(null)
  useEffect(() => {
    // los planos se asignan aquí y no al armar la escena: en modo estricto el useMemo corre dos
    // veces con las mismas fábricas de materiales, y los materiales quedarían con los planos
    // del resultado descartado
    clipAll(built.work.root, built.cut.work)
    clipAll(built.pit, built.cut.work)
    clipAll(built.finished.root, built.cut.done)
    // pasto de atardecer: el verde del visor es de mediodía y aquí compite con el dorado
    const lawn = built.finished.root.getObjectByName('site:lawn') as THREE.Mesh | undefined
    if (lawn) {
      const m = (lawn.material as THREE.MeshStandardMaterial).clone()
      m.color.multiplyScalar(0.45)
      m.clippingPlanes = [built.cut.done]
      lawn.material = m
    }
    parts.current = built
    return () => {
      if (lawn) (lawn.material as THREE.Material).dispose()
      disposeScene(built.finished)
      disposeScene(built.work)
      built.holo.dispose()
      built.ghostMat.dispose()
      built.ceiling.geometry.dispose()
      ;(built.ceiling.material as THREE.Material).dispose()
      built.pit.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose())
    }
  }, [built])
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials])
  useMotionValueEvent(progress, 'change', () => invalidate())

  // entrada: el holograma se dibuja en los primeros dos segundos aunque nadie haga scroll
  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const tick = () => {
      intro.current = Math.min(1, (performance.now() - t0) / 2200)
      invalidate()
      if (intro.current < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [invalidate])

  const keys = useMemo(() => {
    const c = b.center
    const s = Math.max(b.size, 6)
    const at = (dx: number, y: number, dz: number, ly: number): Pose => ({ pos: [c.x + dx * s, y * s, c.y + dz * s], look: [c.x, ly, c.y] })
    return [
      { p: 0, pose: at(1.2, 1.3, 1.8, 0) },
      { p: 0.18, pose: at(1.15, 0.92, 1.42, -0.4) },
      { p: 0.5, pose: at(1.45, 0.78, 1.05, 0.5) },
      { p: 0.7, pose: at(0.95, 1.2, 1.2, 0) },
      { p: 0.84, pose: at(0.45, 0.42, 1.25, 1.1) },
      // frente a la puerta de entrada, y adentro: el comedor delante y la sala al fondo
      { p: 0.93, pose: { pos: [3.6, 1.6, 9.6], look: [3.0, 1.2, 3.0] } as Pose },
      { p: 1, pose: { pos: [4.4, 1.45, 3.95], look: [0.7, 0.9, 1.75] } as Pose },
    ]
  }, [b])

  useFrame(({ camera, size }) => {
    const sc = parts.current
    if (!sc) return
    const p = progress.get()
    const st = sceneAt(p)
    const k = intro.current * intro.current * (3 - 2 * intro.current)

    // holograma: se dibuja de abajo hacia arriba y se apaga cuando sube el ladrillo
    const n = sc.holo.getAttribute('position').count
    sc.holo.setDrawRange(0, Math.floor((n * k) / 2) * 2)
    if (holoMat.current) holoMat.current.opacity = 0.9 * st.holo
    sc.ghostMat.opacity = 0.07 * st.holo * k

    // obra: la línea de tiempo real del modo secuencia
    stepTimeline(sc.work.root, sc.steps, buildToT(st.build, sc.marks))

    // barrido de acabados de izquierda a derecha, con una cortina de luz dorada en el frente
    const x = b.minX - 1.2 + (b.maxX - b.minX + 2.4) * st.sweep
    sc.cut.work.constant = -x
    sc.cut.done.constant = x
    sc.finished.root.visible = st.sweep > 0.001
    // el techo solo al entrar: desde afuera taparía la obra y el barrido
    // la puerta de entrada se abre mientras la cámara se acerca
    const entry = sc.finished.root.getObjectByName('door:p_acceso')
    const open = Math.min(1, st.interior * 2.5)
    entry?.children.forEach((pivot) => {
      const anim = pivot.userData.anim as { type: string; closed: number; open: number } | undefined
      if (anim?.type === 'rotate') pivot.rotation.y = anim.closed + (anim.open - anim.closed) * open
    })
    // cielo raso solo al entrar: desde afuera taparía la obra y el barrido
    sc.ceiling.visible = st.interior > 0.6
    sc.work.root.visible = st.sweep < 0.999
    sc.pit.visible = st.sweep < 0.999
    if (scan.current) {
      scan.current.visible = st.sweep > 0.001 && st.sweep < 0.999
      scan.current.position.x = x
    }

    // de día de obra a anochecer: el sol baja y se encienden las lámparas de adentro
    if (sun.current) sun.current.intensity = 2.4 - 1.5 * st.interior
    if (lamps.current) lamps.current.children.forEach((l) => ((l as THREE.PointLight).intensity = 2.4 * st.interior))

    const pose = cameraAt(p, keys)
    look.set(...pose.look)
    camera.position.set(...pose.pos)
    // en vertical la casa no cabe a lo ancho: la cámara se aleja (salvo ya dentro de la casa)
    const aspect = size.width / size.height
    if (aspect < 1) camera.position.sub(look).multiplyScalar(1 + 0.9 * (1 - aspect) * (1 - st.interior)).add(look)
    camera.lookAt(look)
    const persp = camera as THREE.PerspectiveCamera
    persp.fov = 32 + 24 * st.interior
    // la casa va arriba a la derecha y deja libre la esquina del texto (abajo a la izquierda);
    // en vertical solo sube. Dentro de la casa la vista queda centrada.
    const free = 1 - st.interior
    const wide = size.width > size.height
    persp.setViewOffset(size.width, size.height, wide ? -0.17 * size.width * free : 0, (wide ? 0.06 : 0.16) * size.height * free, size.width, size.height)
    persp.updateProjectionMatrix()
  })

  const rooms = model.levels[0]?.rooms ?? []
  return (
    <>
      <color attach="background" args={[DUSK]} />
      <fog attach="fog" args={[DUSK, 26, 70]} />
      <hemisphereLight args={['#9fb4d4', '#2a2118', 0.85]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        ref={sun}
        position={[b.center.x - 9, 7, b.center.y + 6]}
        intensity={2.4}
        color="#ffd6a0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      {/* lámparas cálidas, una por ambiente, que encienden al llegar a "Hogar" */}
      <group ref={lamps}>
        {rooms.map((r) => {
          const cx = r.polygon.reduce((s, q) => s + q.x, 0) / r.polygon.length
          const cz = r.polygon.reduce((s, q) => s + q.y, 0) / r.polygon.length
          return <pointLight key={r.id} position={[cx, 1.85, cz]} color="#ffc27a" intensity={0} distance={6} decay={1.6} />
        })}
      </group>

      <primitive object={built.pit} />
      <primitive object={built.work.root} />
      <primitive object={built.finished.root} />
      <primitive object={built.ceiling} />

      {/* holograma: aristas en luz y un velo muy tenue en las caras */}
      <lineSegments geometry={built.holo}>
        <lineBasicMaterial ref={holoMat} color={HOLO} transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </lineSegments>
      <primitive object={built.ghost} />

      {/* frente del barrido: un velo muy tenue con su marco de luz dorada */}
      <group ref={scan} position={[0, 0, b.center.y]} visible={false}>
        <mesh rotation-y={Math.PI / 2} position-y={1.5}>
          <planeGeometry args={[b.maxY - b.minY + 1.4, 3.2]} />
          <meshBasicMaterial color={GOLD} transparent opacity={0.06} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
        <lineSegments rotation-y={Math.PI / 2} position-y={1.5}>
          <edgesGeometry args={[new THREE.PlaneGeometry(b.maxY - b.minY + 1.4, 3.2)]} />
          <lineBasicMaterial color={GOLD} transparent opacity={0.95} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </lineSegments>
      </group>
    </>
  )
}

export default function CinemaScene({ model, progress }: { model: BuildingModel; progress: MotionValue<number> }) {
  return (
    <Canvas
      shadows
      frameloop="demand"
      dpr={[1, 1.75]}
      camera={{ fov: 32, near: 0.05, far: 200 }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.05
      }}
      aria-hidden
    >
      <Scene model={model} progress={progress} />
    </Canvas>
  )
}
