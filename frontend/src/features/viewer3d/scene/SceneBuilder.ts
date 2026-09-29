/**
 * Builder de la escena 3D a partir del BuildingModel.
 *
 * Se arma paso a paso (`withWalls().withFloors().withGlass()`), y el resultado
 * es un THREE.Group autocontenido: el visor lo muestra y el exportador GLB lo
 * serializa tal cual. Sin React ni WebGL: se puede probar en Node.
 */
import * as THREE from 'three'
import type { BuildingModel, Level } from '@/api/types'
import { wallToBoxes, roomShapePoints } from '@/domain/geometry'
import { pointAlong, wallDirection } from '@/domain/model'
import { MaterialFactory } from './MaterialFactory'

export const FLOOR_THICKNESS = 0.05

export interface BuiltScene {
  root: THREE.Group
  walls: THREE.Group
  floors: THREE.Group
  glass: THREE.Group
}

export class SceneBuilder {
  private readonly root = new THREE.Group()
  private readonly walls = new THREE.Group()
  private readonly floors = new THREE.Group()
  private readonly glass = new THREE.Group()

  constructor(
    private readonly model: BuildingModel,
    private readonly materials = new MaterialFactory(),
  ) {
    this.root.name = `building:${model.project_id}`
    this.walls.name = 'walls'
    this.floors.name = 'floors'
    this.glass.name = 'glass'
    this.root.add(this.floors, this.walls, this.glass)
  }

  private levels(): Level[] {
    return this.model.levels
  }

  withWalls(): this {
    for (const lv of this.levels()) {
      for (const w of lv.walls) {
        for (const [i, box] of wallToBoxes(w).entries()) {
          const geo = new THREE.BoxGeometry(...box.size)
          const mesh = new THREE.Mesh(geo, this.materials.wall(box.part))
          mesh.position.set(box.center[0], box.center[1] + lv.elevation, box.center[2])
          mesh.rotation.y = box.rotationY
          mesh.castShadow = true
          mesh.receiveShadow = true
          mesh.name = `${w.id}:${box.part}:${i}`
          mesh.userData = { kind: 'wall', wallId: w.id, levelId: lv.id }
          this.walls.add(mesh)
        }
      }
    }
    return this
  }

  withFloors(): this {
    for (const lv of this.levels()) {
      for (const r of lv.rooms) {
        const shape = new THREE.Shape(roomShapePoints(r).map(([x, y]) => new THREE.Vector2(x, y)))
        const geo = new THREE.ExtrudeGeometry(shape, { depth: FLOOR_THICKNESS, bevelEnabled: false })
        const mesh = new THREE.Mesh(geo, this.materials.floorFor(r.label))
        // la forma vive en XY: se acuesta sobre el piso y queda con su cara superior en y=0
        mesh.rotation.x = -Math.PI / 2
        mesh.position.y = lv.elevation - FLOOR_THICKNESS
        mesh.receiveShadow = true
        mesh.name = `room:${r.id}`
        mesh.userData = { kind: 'room', roomId: r.id, levelId: lv.id, label: r.label }
        this.floors.add(mesh)
      }
    }
    return this
  }

  withGlass(): this {
    for (const lv of this.levels()) {
      for (const w of lv.walls) {
        const dir = wallDirection(w)
        for (const o of w.openings.filter((x) => x.kind === 'window')) {
          const mid = pointAlong(w, o.offset + o.width / 2)
          const geo = new THREE.BoxGeometry(o.width, o.height, 0.02)
          const mesh = new THREE.Mesh(geo, this.materials.glass())
          mesh.position.set(mid.x, lv.elevation + o.sill + o.height / 2, mid.y)
          mesh.rotation.y = -Math.atan2(dir.y, dir.x)
          mesh.name = `glass:${o.id}`
          this.glass.add(mesh)
        }
      }
    }
    return this
  }

  build(): BuiltScene {
    return { root: this.root, walls: this.walls, floors: this.floors, glass: this.glass }
  }
}

/** Atajo: la escena completa. */
export function buildScene(model: BuildingModel, materials?: MaterialFactory): BuiltScene {
  return new SceneBuilder(model, materials).withFloors().withWalls().withGlass().build()
}

export function disposeScene(scene: BuiltScene): void {
  scene.root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.geometry.dispose()
  })
}
