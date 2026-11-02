/**
 * El modelo terminado visto desde arriba con cámara ortográfica y el MISMO encuadre que
 * `PlanCanvas` (fitFrame con el mismo margen): en el comparador, el divisor pasa del dibujo
 * al modelo sin que nada se mueva de sitio.
 */
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import type { BuildingModel } from '@/api/types'
import { MaterialFactory } from '@/features/viewer3d/scene/MaterialFactory'
import { buildScene, disposeScene } from '@/features/viewer3d/scene/SceneBuilder'
import { fitFrame } from './drawPlan'

function Still({ model }: { model: BuildingModel }) {
  const size = useThree((s) => s.size)
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera
  const invalidate = useThree((s) => s.invalidate)
  const materials = useMemo(() => new MaterialFactory({ textures: true }), [])
  const scene = useMemo(() => buildScene(model, materials, { details: true }), [model, materials])
  useEffect(() => () => disposeScene(scene), [scene])
  useEffect(() => () => materials.dispose(), [materials])

  // encuadre idéntico al del plano dibujado: mismos píxeles por metro y mismo centro
  useEffect(() => {
    const f = fitFrame(model, size.width, size.height, Math.min(size.width, size.height) * 0.12)
    const cx = (size.width / 2 - f.ox) / f.scale
    const cz = (size.height / 2 - f.oy) / f.scale
    const hw = size.width / 2 / f.scale
    const hh = size.height / 2 / f.scale
    Object.assign(camera, { left: -hw, right: hw, top: hh, bottom: -hh, near: 0.1, far: 60, zoom: 1 })
    // mirando hacia abajo, con el norte del plano (y negativa) arriba en la pantalla
    camera.up.set(0, 0, -1)
    camera.position.set(cx, 20, cz)
    camera.lookAt(cx, 0, cz)
    camera.updateProjectionMatrix()
    invalidate()
  }, [model, size, camera, invalidate])

  return (
    <>
      <color attach="background" args={['#ebe6dc']} />
      <hemisphereLight args={['#ffffff', '#8a8072', 1.1]} />
      <directionalLight position={[-6, 14, 4]} intensity={2.2} color="#fff3e2" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={14} shadow-camera-bottom={-14} />
      <primitive object={scene.root} />
    </>
  )
}

export default function ModelStill({ model }: { model: BuildingModel }) {
  return (
    <Canvas orthographic shadows frameloop="demand" dpr={[1, 2]} gl={{ antialias: true }} aria-hidden>
      <Still model={model} />
    </Canvas>
  )
}
