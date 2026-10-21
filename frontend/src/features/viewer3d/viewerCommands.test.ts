import { describe, expect, it } from 'vitest'
import { sampleModel } from '@/test/fixtures'
import { asViewerActions, parseViewerChat, quantityAnswer, VIEWER_EXAMPLES, type ViewerAction } from './viewerCommands'

describe('parseViewerChat: frase → ajuste de la vista', () => {
  const cases: [string, ViewerAction[]][] = [
    ['modo obra', [{ a: 'plan_mode', id: 'obra' }]],
    ['muéstrame el despiece de acero', [{ a: 'plan_mode', id: 'acero' }]],
    ['la secuencia de obra', [{ a: 'plan_mode', id: 'secuencia' }]],
    ['quita el modo obra', [{ a: 'plan_mode', id: 'presentacion' }]],
    ['oculta el ladrillo', [{ a: 'masonry', hidden: true }]],
    ['muestra los ladrillos', [{ a: 'masonry', hidden: false }]],
    ['muestra el esqueleto', [{ a: 'plan_mode', id: 'obra' }, { a: 'masonry', hidden: true }]],
    ['usa bloque Nº5', [{ a: 'brick', id: 'bloque5' }]],
    ['con ladrillo tolete', [{ a: 'brick', id: 'tolete' }]],
    ['muestra la columneta C-3', [{ a: 'element', id: 'C-3' }]],
    ['viga de amarre 2', [{ a: 'element', id: 'VA-2' }]],
    ['ve al paso 7', [{ a: 'step', to: 7 }]],
    ['siguiente paso', [{ a: 'step', to: 'next' }]],
    ['reproduce la obra', [{ a: 'step', to: 'play' }]],
    ['¿cuántos ladrillos?', [{ a: 'ask', topic: 'ladrillo' }]],
    ['cuánto cemento necesito', [{ a: 'ask', topic: 'cemento' }]],
    ['pon el techo', [{ a: 'roof', on: true }]],
    ['quita la cubierta', [{ a: 'roof', on: false }]],
    ['corte a 1,2 m', [{ a: 'cut', on: true, at: 1.2 }]],
    ['corte a 90 cm', [{ a: 'cut', on: true, at: 0.9 }]],
    ['quita el corte', [{ a: 'cut', on: false }]],
    ['sol a las 4 de la tarde', [{ a: 'sun', on: true, hour: 16 }]],
    ['calidad baja', [{ a: 'quality', q: 'baja' }]],
    ['va muy lento', [{ a: 'quality', q: 'baja' }]],
    ['rayos x', [{ a: 'display', mode: 'xray' }]],
    ['vista desde arriba', [{ a: 'preset', name: 'top' }]],
    ['quiero caminar', [{ a: 'camera', mode: 'walk' }]],
    ['plano original al 30%', [{ a: 'overlay', value: 0.3 }]],
    ['llévame al Baño', [{ a: 'room', room: 'Baño' }]],
  ]
  it.each(cases)('«%s»', (msg, actions) => {
    const r = parseViewerChat(msg)
    expect(r.unknown).toEqual([])
    expect(r.actions).toEqual(actions)
  })

  it('varias órdenes en un mensaje, sin partir los decimales', () => {
    const r = parseViewerChat('modo obra y oculta el ladrillo, corte a 1,5 m')
    expect(r.unknown).toEqual([])
    expect(r.actions).toEqual([{ a: 'plan_mode', id: 'obra' }, { a: 'masonry', hidden: true }, { a: 'cut', on: true, at: 1.5 }])
  })

  it('lo que no entiende queda aparte (para el respaldo con Claude)', () => {
    const r = parseViewerChat('pon el techo. que se vea al atardecer en verano')
    expect(r.actions).toEqual([{ a: 'roof', on: true }])
    expect(r.unknown).toEqual(['que se vea al atardecer en verano'])
  })

  it('todos los ejemplos se entienden', () => {
    for (const e of VIEWER_EXAMPLES) expect(parseViewerChat(e).unknown, e).toEqual([])
  })
})

describe('quantityAnswer', () => {
  it('cuenta ladrillos, acero y área del modelo', () => {
    const m = sampleModel()
    expect(quantityAnswer(m, 'tolete', 'ladrillo').text).toMatch(/^Ladrillo tolete .*: [\d.]+ und \(ya con desperdicio\)\.$/)
    expect(quantityAnswer(m, 'bloque5', 'ladrillo').text).toMatch(/^Bloque Nº5/)
    expect(quantityAnswer(m, 'tolete', 'acero').text).toMatch(/kg de acero en total/)
    expect(quantityAnswer(m, 'tolete', 'area').lines.length).toBe(m.levels.flatMap((l) => l.rooms).length)
  })
})

describe('asViewerActions', () => {
  it('descarta acciones desconocidas o mal formadas', () => {
    const raw = [{ a: 'plan_mode', id: 'acero' }, { a: 'plan_mode', id: 'fantasia' }, { a: 'step', to: 0 }, { a: 'roof', on: 'si' }, { a: 'explotar' }, null, { a: 'step', to: 'next' }]
    expect(asViewerActions(raw)).toEqual([{ a: 'plan_mode', id: 'acero' }, { a: 'step', to: 'next' }])
    expect(asViewerActions('nada')).toEqual([])
  })
})
