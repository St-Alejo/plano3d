/** Cantidades de obra del apartamento de muestra, con el mismo cálculo del modo obra. */
import { BRICKS, type BrickId } from '@/domain/structure/bricks'
import { deriveStructure } from '@/domain/structure/derive'
import { masonryLayout } from '@/domain/structure/masonryLayout'
import { buyAmount, quantities, quantityTotals, type QuantityLine } from '@/domain/structure/quantities'
import { sampleApartment } from './sampleApartment'

/** Totales de la obra completa del apartamento de muestra con la pieza elegida. */
export function sampleTotals(brick: BrickId): QuantityLine[] {
  const model = sampleApartment()
  const structure = deriveStructure(model, { brick })
  return quantityTotals(quantities(model, structure, masonryLayout(model, structure)))
}

const sum = (rows: QuantityLine[], test: (l: QuantityLine) => boolean) => rows.filter(test).reduce((a, l) => a + l.amount, 0)

/** Las cuatro cifras que se compran primero. */
export function headline(rows: QuantityLine[], brick: BrickId) {
  const pieces = rows.find((l) => l.item === BRICKS[brick].name)
  return [
    { key: 'piezas', label: 'piezas', value: pieces ? buyAmount(pieces) : 0, decimals: 0 },
    { key: 'cemento', label: 'bultos de cemento', value: Math.ceil(sum(rows, (l) => l.unit === 'bultos') - 1e-9), decimals: 0 },
    { key: 'concreto', label: 'm³ de concreto', value: sum(rows, (l) => l.unit === 'm³' && l.item.startsWith('Concreto')), decimals: 1 },
    { key: 'acero', label: 'kg de acero', value: sum(rows, (l) => l.unit === 'kg' && l.item.startsWith('Acero')), decimals: 0 },
  ]
}
