/**
 * Builder de la escena de obra (modo maestro): cimentación, columnetas, vigas, dinteles,
 * placas y el ladrillo pieza por pieza, a partir de la estructura derivada (ADR-017).
 * Hermano de SceneBuilder: devuelve el mismo BuiltScene, así el visor, el corte, los
 * encuadres y la exportación funcionan igual.
 *
 * Cada malla estructural lleva `userData = { kind: 'structure', elementId }` para que el
 * visor muestre su ficha al tocarla; en las mallas instanciadas (ladrillos, barras, estribos)
 * `userData.instanceIds` dice a qué paño o elemento pertenece cada instancia. Todo lleva
 * además `userData.step`, el paso de la secuencia constructiva en que se construye.
 */
import * as THREE from 'three'
import type { BuildingModel, Point } from '@/api/types'
import { roomShapePoints } from '@/domain/geometry'
import { distance, pointAlong, wallDirection } from '@/domain/model'
import { brickOf, type LinearElement, type Structure, type TieColumn } from '@/domain/structure/derive'
import type { Brick } from '@/domain/structure/masonryLayout'
import { BARS, NSR10, type BarNo, type Reinforcement } from '@/domain/structure/nsr10'
import { stirrupPositions } from '@/domain/structure/rebar'
import { upperSlabFootprint } from '@/domain/structure/quantities'
import { STEP } from '@/domain/structure/schedule'
import type { BuiltScene } from './SceneBuilder'
import { BAR_TINT, CONCRETE_TINT, MaterialFactory } from './MaterialFactory'
import { worldUv } from './uv'

/** Variación de color de las piezas: ningún ladrillo de arcilla sale igual a otro. */
const BRICK_TONES = ['#a4532f', '#9b4c2b', '#ad5d36', '#94482a', '#b0633a', '#a0502f']

/** Número pseudoaleatorio estable por pieza (misma casa, mismos tonos en cada render). */
const brickJoint = (s: Structure) => brickOf(s).joint

function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/** Una barra o estribo a dibujar: matriz de la instancia, diámetro, elemento y paso de obra. */
interface SteelPiece {
  matrix: THREE.Matrix4
  no: BarNo
  elementId: string
  step: string
}

/** Paso de la secuencia en que se funde cada elemento lineal. */
function linearStep(e: LinearElement): string {
  if (e.kind === 'footing') return STEP.cimentacion
  if (e.kind === 'plinth') return STEP.sobrecimiento
  return STEP.vigas(e.levelId)
}

/** Estribo cerrado de a × d (ejes de la barra) en el plano XY, como tubo del diámetro de la barra. */
function stirrupGeometry(a: number, d: number, db: number): THREE.TubeGeometry {
  const pts = [new THREE.Vector3(-a / 2, -d / 2, 0), new THREE.Vector3(a / 2, -d / 2, 0), new THREE.Vector3(a / 2, d / 2, 0), new THREE.Vector3(-a / 2, d / 2, 0)]
  const path = new THREE.CurvePath<THREE.Vector3>()
  pts.forEach((p, i) => path.add(new THREE.LineCurve3(p, pts[(i + 1) % 4]!)))
  return new THREE.TubeGeometry(path, 16, db / 2, 4, true)
}

/** Esquinas de la sección (a lo ancho, en altura) donde van las barras: 2 abajo, o 4. */
function barCorners(width: number, height: number, cover: number, r: Reinforcement): [number, number][] {
  const inset = cover + BARS[r.stirrups.no].db + BARS[r.bars.no].db / 2
  const x = width / 2 - inset
  const bottom: [number, number][] = [
    [-x, inset],
    [x, inset],
  ]
  if (r.bars.count <= 2) return bottom
  return [...bottom, [-x, height - inset], [x, height - inset]]
}

export class ConstructionBuilder {
  private readonly root = new THREE.Group()
  private readonly masonry = new THREE.Group()
  private readonly floors = new THREE.Group()
  private readonly structure = new THREE.Group()
  private readonly empty = () => new THREE.Group()

  constructor(
    private readonly model: BuildingModel,
    private readonly s: Structure,
    private readonly materials = new MaterialFactory(),
    /** concreto translúcido para ver el acero por dentro */
    private readonly ghost = false,
  ) {
    this.root.name = `obra:${model.project_id}`
    this.masonry.name = 'masonry'
    this.floors.name = 'floors'
    this.structure.name = 'structure'
    this.root.add(this.floors, this.masonry, this.structure)
  }

  private box(size: [number, number, number], at: [number, number, number], rotationY: number, material: THREE.Material, name: string, userData: Record<string, unknown>): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
    mesh.position.set(...at)
    mesh.rotation.y = rotationY
    mesh.name = name
    mesh.userData = userData
    // a rayos X el concreto no tapa el sol: la sombra la dan las barras
    mesh.castShadow = !this.ghost
    mesh.receiveShadow = true
    worldUv(mesh)
    return mesh
  }

  private concrete(kind: keyof typeof CONCRETE_TINT): THREE.Material {
    return this.ghost ? this.materials.ghostConcrete(kind) : this.materials.concrete(kind)
  }

  private linear(e: LinearElement, material: THREE.Material, height = e.height, bottom = e.bottom, width = e.width): THREE.Mesh {
    const len = distance(e.start, e.end)
    const mid: Point = { x: (e.start.x + e.end.x) / 2, y: (e.start.y + e.end.y) / 2 }
    const angle = Math.atan2(e.end.y - e.start.y, e.end.x - e.start.x)
    return this.box([len, height, width], [mid.x, bottom + height / 2, mid.y], -angle, material, e.id, { kind: 'structure', elementId: e.id, elementKind: e.kind, levelId: e.levelId, step: linearStep(e) })
  }

  /** Solado, viga de cimentación y sobrecimiento bajo los muros confinados. */
  withFoundations(): this {
    for (const f of this.s.footings) {
      this.structure.add(this.linear(f, this.concrete('footing')))
      // solado de 5 cm, 5 cm más ancho a cada lado
      const lean = this.linear(f, this.concrete('lean'), NSR10.leanConcrete, f.bottom - NSR10.leanConcrete, f.width + 0.1)
      lean.name = `${f.id}:solado`
      lean.userData.step = STEP.solado
      this.structure.add(lean)
    }
    for (const p of this.s.plinths) this.structure.add(this.linear(p, this.concrete('plinth')))
    return this
  }

  withColumns(): this {
    for (const c of this.s.columns) this.structure.add(this.column(c))
    return this
  }

  private column(c: TieColumn): THREE.Mesh {
    return this.box([c.along, c.height, c.across], [c.center.x, c.bottom + c.height / 2, c.center.y], -c.angle, this.concrete('column'), c.id, {
      kind: 'structure',
      elementId: c.id,
      elementKind: 'column',
      levelId: c.levelId,
      step: STEP.columnas(c.levelId),
    })
  }

  /** Vigas de amarre y dinteles. */
  withBeams(): this {
    for (const b of this.s.beams) this.structure.add(this.linear(b, this.concrete('beam')))
    for (const l of this.s.lintels) this.structure.add(this.linear(l, this.concrete('lintel')))
    return this
  }

  /** Placa de contrapiso en el primer piso y losa de entrepiso (con el hueco de la escalera) arriba. */
  withSlabs(): this {
    const levels = [...this.model.levels].sort((a, b) => a.elevation - b.elevation)
    levels.forEach((lv, i) => {
      if (i === 0) {
        for (const r of lv.rooms) {
          const shape = new THREE.Shape(roomShapePoints(r).map(([x, y]) => new THREE.Vector2(x, y)))
          const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: NSR10.groundSlab, bevelEnabled: false }), this.materials.concrete('slab'))
          mesh.rotation.x = -Math.PI / 2
          mesh.position.y = lv.elevation - NSR10.groundSlab
          mesh.receiveShadow = true
          mesh.name = `placa:${r.id}`
          mesh.userData = { kind: 'structure', elementId: `placa:${lv.id}`, elementKind: 'slab', levelId: lv.id, roomId: r.id, step: STEP.placa }
          this.floors.add(mesh)
        }
        return
      }
      const slab = upperSlabFootprint(lv, levels[i - 1])
      if (!slab) return
      const { x0, x1, y0, y1, well } = slab
      const shape = new THREE.Shape([new THREE.Vector2(x0, -y0), new THREE.Vector2(x1, -y0), new THREE.Vector2(x1, -y1), new THREE.Vector2(x0, -y1)])
      if (well) shape.holes.push(new THREE.Path([new THREE.Vector2(well.minX, -well.minY), new THREE.Vector2(well.minX, -well.maxY), new THREE.Vector2(well.maxX, -well.maxY), new THREE.Vector2(well.maxX, -well.minY)]))
      const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: NSR10.upperSlab, bevelEnabled: false }), this.materials.concrete('slab'))
      mesh.rotation.x = -Math.PI / 2
      mesh.position.y = lv.elevation - NSR10.upperSlab
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.name = `losa:${lv.id}`
      mesh.userData = { kind: 'structure', elementId: `losa:${lv.id}`, elementKind: 'slab', levelId: lv.id, step: STEP.losa(lv.id) }
      this.floors.add(mesh)
    })
    return this
  }

  /**
   * Ladrillo pieza por pieza: un InstancedMesh por muro (pocas llamadas de dibujo aunque sean
   * miles de piezas) y otro de mortero, cada pieza del tamaño del ladrillo más su junta y algo
   * más delgada: el mortero se ve hundido en las juntas y no tapa los vanos.
   */
  withMasonry(bricks: Brick[]): this {
    const walls = new Map(this.model.levels.flatMap((l) => l.walls.map((w) => [w.id, w] as const)))
    const byWall = new Map<string, Brick[]>()
    for (const b of bricks) byWall.set(b.wallId, [...(byWall.get(b.wallId) ?? []), b])
    const unit = new THREE.BoxGeometry(1, 1, 1)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const color = new THREE.Color()
    const joint = brickJoint(this.s)
    let n = 0
    for (const [wallId, unsorted] of byWall) {
      // de abajo hacia arriba: la secuencia muestra las primeras `count` instancias (hiladas que suben)
      const list = [...unsorted].sort((a, b) => a.bottom - b.bottom)
      const w = walls.get(wallId)
      if (!w) continue
      const dir = wallDirection(w)
      const rot = -Math.atan2(dir.y, dir.x)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot)
      const mesh = new THREE.InstancedMesh(unit, this.materials.brick(), list.length)
      const mortar = new THREE.InstancedMesh(unit, this.materials.mortar(), list.length)
      mesh.name = `ladrillo:${wallId}`
      mortar.name = `mortero:${wallId}`
      list.forEach((b, i) => {
        const p = pointAlong(w, b.along)
        const at = new THREE.Vector3(p.x, b.bottom + b.height / 2, p.y)
        mesh.setMatrixAt(i, m.compose(at, q, new THREE.Vector3(b.length, b.height, w.thickness)))
        mesh.setColorAt(i, color.set(BRICK_TONES[Math.floor(hash(n++) * BRICK_TONES.length)]!))
        mortar.setMatrixAt(i, m.compose(at, q, new THREE.Vector3(b.length + joint, b.height + joint, Math.max(0.02, w.thickness - 0.02))))
      })
      const instanceIds = list.map((b) => b.panelId)
      for (const im of [mesh, mortar]) {
        im.userData = { kind: 'structure', elementKind: 'masonry', wallId, instanceIds, step: STEP.muros(list[0]!.levelId), bottoms: list.map((b) => b.bottom) }
        im.receiveShadow = true
        im.computeBoundingSphere()
        this.masonry.add(im)
      }
      mesh.castShadow = true
    }
    return this
  }

  /**
   * Acero de refuerzo con su diámetro real: barras longitudinales en las esquinas de la sección
   * y estribos cerrados a la separación del despiece (densos junto a los nudos). Todas las
   * barras son un InstancedMesh; los estribos, uno por tamaño de estribo.
   */
  withRebar(): this {
    const bars: SteelPiece[] = []
    const rings = new Map<string, { a: number; d: number; db: number; pieces: SteelPiece[] }>()
    const ring = (a: number, d: number, no: BarNo, matrix: THREE.Matrix4, elementId: string, step: string) => {
      const key = `${a.toFixed(3)}x${d.toFixed(3)}:${no}`
      if (!rings.has(key)) rings.set(key, { a, d, db: BARS[no].db, pieces: [] })
      rings.get(key)!.pieces.push({ matrix, no, elementId, step })
    }
    const up = new THREE.Vector3(0, 1, 0)
    const one = new THREE.Vector3(1, 1, 1)
    const none = new THREE.Quaternion()
    // la barra es un cilindro vertical; acostada sigue el eje x del elemento
    const lying = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
    // el anillo del estribo está en XY: parado perpendicular al eje x, o acostado sobre XZ
    const standing = new THREE.Quaternion().setFromAxisAngle(up, Math.PI / 2)
    const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
    const place = (frame: THREE.Matrix4, at: THREE.Vector3, rot: THREE.Quaternion, scale = one) => frame.clone().multiply(new THREE.Matrix4().compose(at, rot, scale))

    for (const e of [...this.s.footings, ...this.s.beams, ...this.s.lintels]) {
      if (!e.rebar) continue
      const step = e.kind === 'footing' ? STEP.aceroCimentacion : STEP.aceroVigas(e.levelId)
      const cover = e.kind === 'footing' ? NSR10.cover.footing : NSR10.cover.beam
      const run = distance(e.start, e.end) - 2 * cover
      const angle = Math.atan2(e.end.y - e.start.y, e.end.x - e.start.x)
      // marco del elemento: x a lo largo, y hacia arriba desde su fondo, z a lo ancho
      const frame = new THREE.Matrix4().compose(new THREE.Vector3((e.start.x + e.end.x) / 2, e.bottom, (e.start.y + e.end.y) / 2), new THREE.Quaternion().setFromAxisAngle(up, -angle), one)
      const db = BARS[e.rebar.bars.no].db
      for (const [z, y] of barCorners(e.width, e.height, cover, e.rebar))
        bars.push({ matrix: place(frame, new THREE.Vector3(0, y, z), lying, new THREE.Vector3(db, run, db)), no: e.rebar.bars.no, elementId: e.id, step })
      for (const x of stirrupPositions(run, e.rebar.stirrups))
        ring(e.width - 2 * cover, e.height - 2 * cover, e.rebar.stirrups.no, place(frame, new THREE.Vector3(-run / 2 + x, e.height / 2, 0), standing), e.id, step)
    }

    for (const c of this.s.columns) {
      const cover = NSR10.cover.column
      const r = c.rebar
      // como en el despiece: la barra sube hasta rematar dentro de la viga de amarre
      const run = c.height + NSR10.beamHeight - cover
      const frame = new THREE.Matrix4().compose(new THREE.Vector3(c.center.x, c.bottom, c.center.y), new THREE.Quaternion().setFromAxisAngle(up, -c.angle), one)
      const inset = cover + BARS[r.stirrups.no].db + BARS[r.bars.no].db / 2
      const db = BARS[r.bars.no].db
      for (const [x, z] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const)
        bars.push({ matrix: place(frame, new THREE.Vector3(x * (c.along / 2 - inset), run / 2, z * (c.across / 2 - inset)), none, new THREE.Vector3(db, run, db)), no: r.bars.no, elementId: c.id, step: STEP.aceroColumnas(c.levelId) })
      for (const y of stirrupPositions(c.height, r.stirrups)) ring(c.along - 2 * cover, c.across - 2 * cover, r.stirrups.no, place(frame, new THREE.Vector3(0, y, 0), flat), c.id, STEP.aceroColumnas(c.levelId))
    }

    const steel = new THREE.Group()
    steel.name = 'acero'
    const color = new THREE.Color()
    // una malla por paso de obra: la secuencia muestra el acero de cada etapa por separado
    const add = (geometry: THREE.BufferGeometry, all: SteelPiece[], name: string) => {
      const steps = new Map<string, SteelPiece[]>()
      for (const p of all) steps.set(p.step, [...(steps.get(p.step) ?? []), p])
      for (const [step, pieces] of steps) addStep(geometry, pieces, `${name}@${step}`, step)
    }
    const addStep = (geometry: THREE.BufferGeometry, pieces: SteelPiece[], name: string, step: string) => {
      const mesh = new THREE.InstancedMesh(geometry, this.materials.steel(), pieces.length)
      pieces.forEach((p, i) => {
        mesh.setMatrixAt(i, p.matrix)
        mesh.setColorAt(i, color.set(BAR_TINT[p.no]))
      })
      mesh.name = name
      mesh.userData = { kind: 'structure', elementKind: 'rebar', instanceIds: pieces.map((p) => p.elementId), step }
      mesh.computeBoundingSphere()
      mesh.castShadow = true
      steel.add(mesh)
    }
    add(new THREE.CylinderGeometry(0.5, 0.5, 1, 6), bars, 'barras')
    for (const [key, r] of rings) add(stirrupGeometry(r.a, r.d, r.db), r.pieces, `estribos:${key}`)
    this.structure.add(steel)
    return this
  }

  build(): BuiltScene {
    return {
      root: this.root,
      walls: this.masonry,
      floors: this.floors,
      glass: this.empty(),
      elements: this.structure,
      furniture: this.empty(),
      details: this.empty(),
      site: this.empty(),
    }
  }
}
