/**
 * Builder de la escena 3D a partir del BuildingModel.
 *
 * Se arma paso a paso (`withWalls().withFloors().withGlass()`), y el resultado
 * es un THREE.Group autocontenido: el visor lo muestra y el exportador GLB lo
 * serializa tal cual. Sin React ni WebGL: se puede probar en Node.
 */
import * as THREE from 'three'
import type { BuildingModel, Level } from '@/api/types'
import { curvedWallBoxes, roomShapePoints, slidingTracks, stairLandings, stairSteps, stairWell, swingLeaves, wallToBoxes } from '@/domain/geometry'
import { pointAlong, wallDirection } from '@/domain/model'
import { FurnitureFactory } from './FurnitureFactory'
import { MaterialFactory } from './MaterialFactory'
import { worldUv } from './uv'

export const FLOOR_THICKNESS = 0.05
/** grosor de la losa entre pisos */
export const SLAB_THICKNESS = 0.12

export interface BuiltScene {
  root: THREE.Group
  walls: THREE.Group
  floors: THREE.Group
  glass: THREE.Group
  /** columnas, escaleras y hojas de puerta (modelo v2) */
  elements: THREE.Group
  /** muebles del catálogo (ADR-016) */
  furniture: THREE.Group
  /** guardaescobas, marcos, alféizares y cubierta */
  details: THREE.Group
  /** terreno y andén: se ven en el visor pero no se exportan */
  site: THREE.Group
}

export interface SceneOptions {
  /** guardaescobas, marcos de puertas y ventanas, alféizares */
  details?: boolean
  /** terreno con pasto y andén perimetral */
  site?: boolean
  /** cubierta de teja a dos aguas sobre el último piso */
  roof?: boolean
}

/** Alto del guardaescobas y cuánto sobresale del muro. */
const SKIRTING_H = 0.08
const SKIRTING_OUT = 0.012
/** Perfil de los marcos de ventana (aluminio) y de puerta (madera). */
const WINDOW_FRAME = 0.05
const DOOR_FRAME = 0.06
/** Cubierta: pendiente y alero. */
const ROOF_PITCH = (22 * Math.PI) / 180
const ROOF_EAVE = 0.6
const ROOF_THICKNESS = 0.06
/** Ancho del andén perimetral. */
const SIDEWALK = 0.8

/** Caja envolvente en planta de los muros de un nivel. */
function levelBox(lv: Level): { x0: number; x1: number; y0: number; y1: number } | null {
  if (lv.walls.length === 0) return null
  const xs = lv.walls.flatMap((w) => [w.start.x, w.end.x])
  const ys = lv.walls.flatMap((w) => [w.start.y, w.end.y])
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
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
  private readonly details = new THREE.Group()
  private readonly site = new THREE.Group()

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
    this.details.name = 'details'
    this.site.name = 'site'
    this.root.add(this.floors, this.walls, this.glass, this.elements, this.furniture, this.details, this.site)
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
          worldUv(mesh)
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
          mesh.userData = { kind: 'window', openingId: o.id, wallId: w.id, levelId: lv.id }
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
        if (!c.round) worldUv(mesh)
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
          worldUv(mesh)
          this.elements.add(mesh)
        }
      }
      // descansos entre tramos (escaleras en L y en U)
      for (const [i, l] of stairLandings(lv.stairs ?? []).entries()) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(...l.box.size), this.materials.stair())
        mesh.position.set(l.box.center[0], lv.elevation + l.box.center[1], l.box.center[2])
        mesh.rotation.y = l.box.rotationY
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.name = `landing:${lv.id}:${i}`
        mesh.userData = { kind: 'stair', stairId: lv.stairs?.[0]?.id, levelId: lv.id }
        worldUv(mesh)
        this.elements.add(mesh)
      }
    }
    return this
  }

  /**
   * Losa de cada piso superior: cubre la envolvente del nivel con el hueco de la escalera
   * que llega desde abajo. Así al subir no se ve el vacío y hay dónde pararse fuera de
   * los ambientes detectados (pasillos).
   */
  withSlabs(): this {
    const levels = [...this.levels()].sort((a, b) => a.elevation - b.elevation)
    levels.forEach((lv, i) => {
      if (i === 0 || lv.walls.length === 0) return
      const xs = lv.walls.flatMap((w) => [w.start.x, w.end.x])
      const ys = lv.walls.flatMap((w) => [w.start.y, w.end.y])
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
      // la losa se dibuja en XY con y negada (como los pisos) y se acuesta
      const shape = new THREE.Shape([new THREE.Vector2(x0, -y0), new THREE.Vector2(x1, -y0), new THREE.Vector2(x1, -y1), new THREE.Vector2(x0, -y1)])
      const below = levels[i - 1]!
      const well = stairWell(below.stairs ?? [])
      if (well) shape.holes.push(new THREE.Path([new THREE.Vector2(well.minX, -well.minY), new THREE.Vector2(well.minX, -well.maxY), new THREE.Vector2(well.maxX, -well.maxY), new THREE.Vector2(well.maxX, -well.minY)]))
      const geo = new THREE.ExtrudeGeometry(shape, { depth: SLAB_THICKNESS, bevelEnabled: false })
      const mesh = new THREE.Mesh(geo, this.materials.column())
      mesh.rotation.x = -Math.PI / 2
      mesh.position.y = lv.elevation - FLOOR_THICKNESS - SLAB_THICKNESS
      mesh.receiveShadow = true
      mesh.name = `slab:${lv.id}`
      mesh.userData = { kind: 'slab', levelId: lv.id }
      this.floors.add(mesh)
    })
    return this
  }

  /**
   * Puertas animables: cada hoja cuelga de un pivote (`userData.anim`) que el recorrido
   * interpola entre cerrada (0) y abierta (1). Batiente: gira sobre la bisagra; doble
   * batiente: dos hojas; corrediza: la hoja se desliza a lo largo del muro.
   */
  withDoors(): this {
    for (const lv of this.levels()) {
      for (const w of lv.walls) {
        if (w.bulge) continue
        for (const o of w.openings.filter((x) => x.kind === 'door' && x.operation !== 'none')) {
          const info = { kind: 'door', openingId: o.id, wallId: w.id, levelId: lv.id }
          const door = new THREE.Group()
          door.name = `door:${o.id}`
          door.userData = info
          if (o.operation === 'sliding') {
            // una corrediza ancha es un paño de vidrio (puerta-ventana), no de madera
            const material = o.width >= GLAZED_DOOR_M ? this.materials.glass() : this.materials.door()
            for (const t of slidingTracks(w, o)) {
              const pivot = new THREE.Group()
              pivot.position.set(t.closed.center[0], lv.elevation, t.closed.center[2])
              pivot.rotation.y = t.closed.rotationY
              pivot.userData = { ...info, anim: { type: 'slide', closed: [t.closed.center[0], t.closed.center[2]], open: t.open } }
              const mesh = new THREE.Mesh(new THREE.BoxGeometry(...t.closed.size), material)
              mesh.position.y = t.closed.center[1]
              worldUv(mesh)
              mesh.castShadow = true
              mesh.userData = info
              pivot.add(mesh)
              door.add(pivot)
            }
          } else {
            for (const leaf of swingLeaves(w, o)) {
              const pivot = new THREE.Group()
              pivot.position.set(leaf.hinge.x, lv.elevation, leaf.hinge.y)
              pivot.rotation.y = leaf.closed
              pivot.userData = { ...info, anim: { type: 'rotate', closed: leaf.closed, open: leaf.open } }
              const mesh = new THREE.Mesh(new THREE.BoxGeometry(leaf.width, leaf.height, 0.04), this.materials.door())
              // la hoja sale de la bisagra hacia el otro lado del vano
              mesh.position.set(leaf.width / 2, leaf.height / 2, 0)
              worldUv(mesh)
              mesh.castShadow = true
              mesh.userData = info
              pivot.add(mesh)
              door.add(pivot)
            }
          }
          this.elements.add(door)
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

  private detail(geo: THREE.BufferGeometry, material: THREE.Material, name: string, userData: Record<string, unknown>): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, material)
    mesh.name = name
    mesh.userData = { kind: 'detail', ...userData }
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }

  /**
   * Guardaescobas: una franja baja un poco más ancha que el muro en cada tramo que
   * arranca del piso (macizos y antepechos). Afuera se lee como sobrecimiento.
   */
  withSkirting(): this {
    for (const lv of this.levels()) {
      for (const w of lv.walls) {
        if (w.bulge) continue
        for (const [i, box] of wallToBoxes(w).entries()) {
          if (box.center[1] - box.size[1] / 2 > 1e-3) continue
          const geo = new THREE.BoxGeometry(box.size[0], Math.min(SKIRTING_H, box.size[1]), box.size[2] + 2 * SKIRTING_OUT)
          const mesh = this.detail(geo, this.materials.skirting(), `skirting:${w.id}:${i}`, { wallId: w.id, levelId: lv.id })
          mesh.position.set(box.center[0], lv.elevation + SKIRTING_H / 2, box.center[2])
          mesh.rotation.y = box.rotationY
          worldUv(mesh)
          this.details.add(mesh)
        }
      }
    }
    return this
  }

  /** Marcos: perfilería de aluminio y alféizar en ventanas; marco de madera en puertas. */
  withFrames(): this {
    for (const lv of this.levels()) {
      for (const w of lv.walls) {
        if (w.bulge) continue
        const dir = wallDirection(w)
        for (const o of w.openings) {
          const mid = pointAlong(w, o.offset + o.width / 2)
          const g = new THREE.Group()
          g.name = `frame:${o.id}`
          g.position.set(mid.x, lv.elevation + o.sill, mid.y)
          g.rotation.y = -Math.atan2(dir.y, dir.x)
          const piece = (size: [number, number, number], at: [number, number, number], material: THREE.Material, i: number) => {
            const mesh = this.detail(new THREE.BoxGeometry(...size), material, `frame:${o.id}:${i}`, { openingId: o.id, wallId: w.id, levelId: lv.id })
            mesh.position.set(...at)
            worldUv(mesh)
            g.add(mesh)
          }
          if (o.kind === 'window') {
            const f = WINDOW_FRAME
            const d = Math.min(0.08, w.thickness)
            const m = this.materials.frame()
            piece([o.width, f, d], [0, o.height - f / 2, 0], m, 0)
            piece([o.width, f, d], [0, f / 2, 0], m, 1)
            piece([f, o.height, d], [-o.width / 2 + f / 2, o.height / 2, 0], m, 2)
            piece([f, o.height, d], [o.width / 2 - f / 2, o.height / 2, 0], m, 3)
            // alféizar: sobresale un poco a ambos lados del muro
            if (o.sill > 0.05) piece([o.width + 0.1, 0.03, w.thickness + 0.08], [0, -0.015, 0], this.materials.sill(), 4)
          } else {
            const f = DOOR_FRAME
            const d = w.thickness + 0.03
            const m = this.materials.doorFrame()
            piece([o.width, f, d], [0, o.height - f / 2, 0], m, 0)
            piece([f, o.height, d], [-o.width / 2 + f / 2, o.height / 2, 0], m, 1)
            piece([f, o.height, d], [o.width / 2 - f / 2, o.height / 2, 0], m, 2)
          }
          this.details.add(g)
        }
      }
    }
    return this
  }

  /**
   * Cubierta de teja a dos aguas sobre la envolvente del último piso: la cumbrera corre
   * por el lado largo, los faldones bajan con 22° y vuelan un alero de 0,6 m; los
   * hastiales (triángulos de muro) cierran los extremos.
   */
  withRoof(): this {
    const top = [...this.levels()].sort((a, b) => b.elevation - a.elevation)[0]
    const box = top && levelBox(top)
    if (!top || !box) return this
    const wallTop = top.elevation + Math.max(...top.walls.map((w) => w.height))
    const alongX = box.x1 - box.x0 >= box.y1 - box.y0
    const long = alongX ? box.x1 - box.x0 : box.y1 - box.y0
    const short = alongX ? box.y1 - box.y0 : box.x1 - box.x0
    const tan = Math.tan(ROOF_PITCH)
    const rise = (short / 2) * tan
    const span = short / 2 + ROOF_EAVE
    const roof = new THREE.Group()
    roof.name = `roof:${top.id}`
    roof.position.set((box.x0 + box.x1) / 2, wallTop, (box.y0 + box.y1) / 2)
    roof.rotation.y = alongX ? 0 : Math.PI / 2
    for (const side of [1, -1]) {
      const geo = new THREE.BoxGeometry(long + 2 * ROOF_EAVE, ROOF_THICKNESS, span / Math.cos(ROOF_PITCH))
      const mesh = this.detail(geo, this.materials.roof(), `roof:${top.id}:${side}`, { kind: 'roof', levelId: top.id })
      mesh.position.set(0, rise - (span / 2) * tan + ROOF_THICKNESS / 2, (side * span) / 2)
      mesh.rotation.x = side * ROOF_PITCH
      worldUv(mesh)
      roof.add(mesh)
    }
    // hastiales: triángulos del grosor de un muro en los extremos de la cumbrera
    const tri = new THREE.Shape([new THREE.Vector2(-short / 2, 0), new THREE.Vector2(short / 2, 0), new THREE.Vector2(0, rise)])
    const t = top.walls[0]?.thickness ?? 0.15
    for (const end of [1, -1]) {
      const geo = new THREE.ExtrudeGeometry(tri, { depth: t, bevelEnabled: false })
      geo.translate(0, 0, -t / 2)
      const mesh = this.detail(geo, this.materials.wall('solid', top.walls[0]?.material), `gable:${top.id}:${end}`, { kind: 'roof', levelId: top.id })
      mesh.position.set((end * long) / 2, 0, 0)
      mesh.rotation.y = Math.PI / 2
      worldUv(mesh)
      roof.add(mesh)
    }
    this.details.add(roof)
    return this
  }

  /** Terreno con pasto alrededor de la casa y andén de concreto pegado a la fachada. */
  withSite(): this {
    const ground = [...this.levels()].sort((a, b) => a.elevation - b.elevation)[0]
    const box = ground && levelBox(ground)
    if (!ground || !box) return this
    const t = Math.max(...ground.walls.map((w) => w.thickness)) / 2
    const [x0, x1, y0, y1] = [box.x0 - t, box.x1 + t, box.y0 - t, box.y1 + t]
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    const lawnSize = Math.max(x1 - x0, y1 - y0) + 40
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(lawnSize, lawnSize), this.materials.lawn())
    lawn.name = 'site:lawn'
    lawn.userData = { kind: 'site' }
    lawn.rotation.x = -Math.PI / 2
    lawn.position.set(cx, ground.elevation - 0.05, cy)
    lawn.receiveShadow = true
    worldUv(lawn)
    this.site.add(lawn)
    const h = 0.04
    const y = ground.elevation - 0.05 + h / 2
    const strips: [number, number, number, number][] = [
      [cx, y0 - SIDEWALK / 2, x1 - x0 + 2 * SIDEWALK, SIDEWALK],
      [cx, y1 + SIDEWALK / 2, x1 - x0 + 2 * SIDEWALK, SIDEWALK],
      [x0 - SIDEWALK / 2, cy, SIDEWALK, y1 - y0],
      [x1 + SIDEWALK / 2, cy, SIDEWALK, y1 - y0],
    ]
    strips.forEach(([x, z, sx, sz], i) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), this.materials.sill())
      mesh.name = `site:sidewalk:${i}`
      mesh.userData = { kind: 'site' }
      mesh.position.set(x, y, z)
      mesh.receiveShadow = true
      worldUv(mesh)
      this.site.add(mesh)
    })
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
      details: this.details,
      site: this.site,
    }
  }
}

/** Atajo: la escena completa; los detalles, el terreno y la cubierta son opcionales. */
export function buildScene(model: BuildingModel, materials?: MaterialFactory, opts: SceneOptions = {}): BuiltScene {
  const b = new SceneBuilder(model, materials)
    .withFloors()
    .withSlabs()
    .withWalls()
    .withGlass()
    .withColumns()
    .withStairs()
    .withDoors()
    .withFurniture()
  if (opts.details) b.withSkirting().withFrames()
  if (opts.roof) b.withRoof()
  if (opts.site) b.withSite()
  return b.build()
}

/** Copia de la escena para exportar (GLB/OBJ): sin el terreno, que solo es ambientación. */
export function exportRoot(scene: BuiltScene): THREE.Object3D {
  const copy = scene.root.clone()
  copy.getObjectByName('site')?.removeFromParent()
  return copy
}

export function disposeScene(scene: BuiltScene): void {
  scene.root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.geometry.dispose()
  })
}
