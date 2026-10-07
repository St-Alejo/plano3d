/**
 * Builder de la escena 3D a partir del BuildingModel.
 *
 * Se arma paso a paso (`withWalls().withFloors().withGlass()`), y el resultado
 * es un THREE.Group autocontenido: el visor lo muestra y el exportador GLB lo
 * serializa tal cual. Sin React ni WebGL: se puede probar en Node.
 */
import * as THREE from 'three'
import type { BuildingModel, Level } from '@/api/types'
import { curvedWallBoxes, doorLeaf, roomShapePoints, slidingLeaves, stairSteps, wallToBoxes } from '@/domain/geometry'
import { pointAlong, wallDirection } from '@/domain/model'
import { FurnitureFactory } from './FurnitureFactory'
import { MaterialFactory } from './MaterialFactory'

export const FLOOR_THICKNESS = 0.05

export interface BuiltScene {
  root: THREE.Group
  walls: THREE.Group
  floors: THREE.Group
  glass: THREE.Group
  /** columnas, escaleras y hojas de puerta (modelo v2) */
  elements: THREE.Group
  /** muebles del catálogo (ADR-016) */
  furniture: THREE.Group
}

/** Ancho desde el cual una puerta corrediza se dibuja como vidrio. */
const GLAZED_DOOR_M = 1.5

export class SceneBuilder {
  private readonly root = new THREE.Group()
  private readonly walls = new THREE.Group()
  private readonly floors = new THREE.Group()
  private readonly glass = new THREE.Group()
  private readonly elements = new THREE.Group()
  private readonly furniture = new THREE.Group()

  constructor(
    private readonly model: BuildingModel,
    private readonly materials = new MaterialFactory(),
  ) {
    this.root.name = `building:${model.project_id}`
    this.walls.name = 'walls'
    this.floors.name = 'floors'
    this.glass.name = 'glass'
    this.elements.name = 'elements'
    this.furniture.name = 'furniture'
    this.root.add(this.floors, this.walls, this.glass, this.elements, this.furniture)
  }

  private levels(): Level[] {
    return this.model.levels
  }

  withWalls(): this {
    for (const lv of this.levels()) {
      for (const w of lv.walls) {
        const boxes = w.bulge ? curvedWallBoxes(w) : wallToBoxes(w)
        for (const [i, box] of boxes.entries()) {
          const geo = new THREE.BoxGeometry(...box.size)
          const mesh = new THREE.Mesh(geo, this.materials.wall(box.part, w.material))
          mesh.position.set(box.center[0], box.center[1] + lv.elevation, box.center[2])
          mesh.rotation.y = box.rotationY
          mesh.castShadow = true
          mesh.receiveShadow = true
          mesh.name = `${w.id}:${box.part}:${i}`
          mesh.userData = { kind: 'wall', wallId: w.id, levelId: lv.id, material: w.material }
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
        const mesh = new THREE.Mesh(geo, this.materials.floor(r.floor_material, r.label))
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

  withColumns(): this {
    for (const lv of this.levels()) {
      const h = lv.height ?? 2.6
      for (const c of lv.columns ?? []) {
        const geo = c.round
          ? new THREE.CylinderGeometry(c.width / 2, c.width / 2, h, 24)
          : new THREE.BoxGeometry(c.width, h, c.depth)
        const mesh = new THREE.Mesh(geo, this.materials.column())
        mesh.position.set(c.center.x, lv.elevation + h / 2, c.center.y)
        mesh.rotation.y = -(c.rotation ?? 0)
        mesh.castShadow = true
        mesh.name = `column:${c.id}`
        mesh.userData = { kind: 'column', columnId: c.id, levelId: lv.id }
        this.elements.add(mesh)
      }
    }
    return this
  }

  withStairs(): this {
    for (const lv of this.levels()) {
      for (const s of lv.stairs ?? []) {
        for (const [i, step] of stairSteps(s).entries()) {
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(...step.size), this.materials.stair())
          mesh.position.set(step.center[0], lv.elevation + step.center[1], step.center[2])
          mesh.rotation.y = step.rotationY
          mesh.castShadow = true
          mesh.receiveShadow = true
          mesh.name = `stair:${s.id}:${i}`
          mesh.userData = { kind: 'stair', stairId: s.id, levelId: lv.id }
          this.elements.add(mesh)
        }
      }
    }
    return this
  }

  withDoors(): this {
    for (const lv of this.levels()) {
      for (const w of lv.walls) {
        if (w.bulge) continue
        for (const o of w.openings.filter((x) => x.kind === 'door' && x.operation !== 'none')) {
          const leaves = o.operation === 'sliding' ? slidingLeaves(w, o) : [doorLeaf(w, o)]
          // una corrediza ancha es un paño de vidrio (puerta-ventana), no de madera
          const material = o.operation === 'sliding' && o.width >= GLAZED_DOOR_M ? this.materials.glass() : this.materials.door()
          for (const leaf of leaves) {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(...leaf.size), material)
            mesh.position.set(leaf.center[0], lv.elevation + leaf.center[1], leaf.center[2])
            mesh.rotation.y = leaf.rotationY
            mesh.castShadow = true
            mesh.name = `door:${o.id}`
            mesh.userData = { kind: 'door', openingId: o.id, wallId: w.id, levelId: lv.id }
            this.elements.add(mesh)
          }
        }
      }
    }
    return this
  }

  withFurniture(): this {
    const factory = new FurnitureFactory(this.materials)
    for (const lv of this.levels()) for (const f of lv.furniture ?? []) this.furniture.add(factory.create(f, lv.elevation))
    return this
  }

  build(): BuiltScene {
    return {
      root: this.root,
      walls: this.walls,
      floors: this.floors,
      glass: this.glass,
      elements: this.elements,
      furniture: this.furniture,
    }
  }
}

/** Atajo: la escena completa. */
export function buildScene(model: BuildingModel, materials?: MaterialFactory): BuiltScene {
  return new SceneBuilder(model, materials)
    .withFloors()
    .withWalls()
    .withGlass()
    .withColumns()
    .withStairs()
    .withDoors()
    .withFurniture()
    .build()
}

export function disposeScene(scene: BuiltScene): void {
  scene.root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.geometry.dispose()
  })
}
