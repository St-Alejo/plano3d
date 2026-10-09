import { beforeEach, describe, expect, it } from 'vitest'
import type { BuildingModel } from '@/api/types'
import { selectLevel, useEditor } from '@/store/editorStore'
import { EXAMPLES, parseChat } from './chatParser'
import { findOpening } from './openings'
import { opsToCommand, type PlanOp } from './planOps'

describe('parseChat: frase → operaciones', () => {
  const cases: [string, PlanOp[]][] = [
    ['sala de 4x5', [{ op: 'add_room', name: 'sala', width: 4, depth: 5, next_to: undefined }]],
    ['Crea una Sala de 4 x 5 metros', [{ op: 'add_room', name: 'Sala', width: 4, depth: 5, next_to: undefined }]],
    ['cocina de 3 por 3,5 al este de la sala', [{ op: 'add_room', name: 'cocina', width: 3, depth: 3.5, next_to: { room: 'sala', side: 'este' } }]],
    ['baño de 2x1.5 al lado de la alcoba', [{ op: 'add_room', name: 'baño', width: 2, depth: 1.5, next_to: { room: 'alcoba', side: 'este' } }]],
    ['patio de 5x3 debajo de la sala', [{ op: 'add_room', name: 'patio', width: 5, depth: 3, next_to: { room: 'sala', side: 'sur' } }]],
    ['alcoba 2 de 3x3 a la izquierda de la sala', [{ op: 'add_room', name: 'alcoba 2', width: 3, depth: 3, next_to: { room: 'sala', side: 'oeste' } }]],
    ['puerta en el muro sur de la sala', [{ op: 'add_opening', kind: 'door', room: 'sala', side: 'sur', width: undefined }]],
    ['ventana de 1,20 en el norte de alcoba', [{ op: 'add_opening', kind: 'window', room: 'alcoba', side: 'norte', width: 1.2 }]],
    ['pon una puerta en la cocina al este', [{ op: 'add_opening', kind: 'door', room: 'cocina', side: 'este', width: undefined }]],
    ['puerta entre la sala y la cocina', [{ op: 'add_opening', kind: 'door', room: 'sala', between: 'cocina', width: undefined }]],
    ['borra la ventana de la cocina', [{ op: 'delete_opening', kind: 'window', room: 'cocina', side: undefined }]],
    ['quita la puerta norte de la sala', [{ op: 'delete_opening', kind: 'door', room: 'sala', side: 'norte' }]],
    ['mueve la puerta del baño al este', [{ op: 'move_opening', kind: 'door', room: 'baño', from_side: undefined, to_side: 'este', to_room: undefined }]],
    [
      'pasa la ventana norte de la sala al sur de la cocina',
      [{ op: 'move_opening', kind: 'window', room: 'sala', from_side: 'norte', to_side: 'sur', to_room: 'cocina' }],
    ],
    ['renombra la alcoba 1 a Estudio', [{ op: 'rename_room', room: 'alcoba 1', name: 'Estudio' }]],
    ['borra la cocina', [{ op: 'delete_room', room: 'cocina' }]],
    ['pon una cama doble en la alcoba', [{ op: 'add_furniture', item: 'cama doble', room: 'alcoba' }]],
  ]
  it.each(cases)('«%s»', (msg, ops) => {
    const r = parseChat(msg)
    expect(r.unknown).toEqual([])
    expect(r.ops).toEqual(ops)
  })

  it('varias órdenes en un mensaje, con "con" y el ambiente implícito', () => {
    const r = parseChat('sala de 4x5, cocina de 3x3 al este de la sala con puerta al sur y una ventana al norte')
    expect(r.unknown).toEqual([])
    expect(r.ops.map((o) => o.op)).toEqual(['add_room', 'add_room', 'add_opening', 'add_opening'])
    expect(r.ops[2]).toMatchObject({ kind: 'door', room: 'cocina', side: 'sur' })
    expect(r.ops[3]).toMatchObject({ kind: 'window', room: 'cocina', side: 'norte' })
  })

  it('lo que no entiende queda aparte (para el respaldo con Claude)', () => {
    const r = parseChat('sala de 4x5. haz que se vea moderna')
    expect(r.ops).toHaveLength(1)
    expect(r.unknown).toEqual(['haz que se vea moderna'])
  })

  it('una puerta sin ambiente y sin contexto no se adivina', () => {
    expect(parseChat('puerta al sur').unknown).toEqual(['puerta al sur'])
  })

  it('todos los ejemplos del chat se entienden', () => {
    for (const e of EXAMPLES) expect(parseChat(e).unknown, e).toEqual([])
  })
})

const blank = (): BuildingModel => ({
  project_id: 'prj_b',
  scale: { meters_per_pixel: 0.01, source: 'vector', confidence: 1 },
  levels: [{ id: 'lvl_0', name: 'Planta 1', elevation: 0, walls: [], rooms: [] }],
})

describe('opsToCommand: del chat al plano', () => {
  beforeEach(() => {
    useEditor.getState().reset()
    useEditor.getState().load('prj_b', blank())
  })
  const say = (msg: string) => {
    const { ops, unknown } = parseChat(msg)
    expect(unknown).toEqual([])
    const st = useEditor.getState()
    const r = opsToCommand(st.model!, st.levelId, ops)
    expect(st.dispatch(r.command)).toBe(true)
    return r.summary
  }
  const level = () => selectLevel(useEditor.getState())!
  const openings = () => level().walls.flatMap((w) => w.openings)

  it('dibuja una casa por partes y todo se deshace de una vez', () => {
    const summary = say('sala de 4x5, cocina de 3x3 al este de la sala con puerta al sur, puerta entre la sala y la cocina')
    expect(summary).toEqual([
      'Dibujé Sala de 4 × 5 m',
      'Dibujé Cocina de 3 × 3 m',
      'Agregué una puerta al sur de Cocina',
      'Agregué una puerta entre Sala y Cocina',
    ])
    expect(level().rooms.map((r) => r.label).sort()).toEqual(['Cocina', 'Sala'])
    expect(level().walls).toHaveLength(7)
    expect(openings().map((o) => o.kind)).toEqual(['door', 'door'])
    useEditor.getState().undo()
    expect(level().walls).toHaveLength(0)
  })

  it('mover y borrar aberturas por su ambiente y su lado', () => {
    say('sala de 4x5 con ventana al norte y puerta al sur')
    say('mueve la ventana de la sala al este')
    const win = openings().find((o) => o.kind === 'window')!
    const wall = findOpening(level().walls, win.id)!.wall
    expect(wall.start.x).toBeCloseTo(4) // muro este: x = 4
    expect(wall.end.x).toBeCloseTo(4)
    say('borra la puerta de la sala')
    expect(openings().map((o) => o.kind)).toEqual(['window'])
  })

  it('renombrar, amueblar y borrar un ambiente sin tocar el muro compartido', () => {
    say('sala de 4x5, alcoba de 3x3 al este de la sala')
    say('renombra la alcoba a Estudio')
    expect(level().rooms.map((r) => r.label).sort()).toEqual(['Estudio', 'Sala'])
    say('pon un escritorio en el estudio')
    expect(level().furniture?.[0]?.catalog_id).toBe('escritorio')
    say('borra el estudio')
    expect(level().rooms.map((r) => r.label)).toEqual(['Sala'])
    expect(level().walls).toHaveLength(4)
  })

  it('un error explica qué falta y no aplica nada', () => {
    say('sala de 4x5')
    const st = useEditor.getState()
    expect(() => opsToCommand(st.model!, st.levelId, parseChat('puerta al sur del garaje').ops)).toThrow(/No encuentro el ambiente «garaje» \(hay: Sala\)/)
    expect(level().walls).toHaveLength(4)
  })
})
