/**
 * Detalles tipo para el maestro: la sección de la columneta, la viga de amarre y la viga de
 * cimentación a escala, con el estribo, las barras en su sitio, las cotas y el refuerzo.
 */
import { Ruler } from 'lucide-react'
import type { Structure } from '@/domain/structure/derive'
import { rebarText } from '@/domain/structure/describe'
import { BARS, NSR10, type Reinforcement } from '@/domain/structure/nsr10'
import { BAR_TINT } from './scene/MaterialFactory'

const m = (v: number) => v.toFixed(2).replace('.', ',')

/** px por metro: una sección de 30 cm ocupa 120 px */
const K = 400
const PAD = 22
/** a la derecha va la cota del alto */
const RIGHT = 40

function Section({ title, width, height, cover, rebar }: { title: string; width: number; height: number; cover: number; rebar: Reinforcement }) {
  const w = width * K
  const h = height * K
  const c = cover * K
  const st = BARS[rebar.stirrups.no].db * K
  const r = (BARS[rebar.bars.no].db * K) / 2
  const inset = c + st + r
  const bars: [number, number][] = [
    [inset, h - inset],
    [w - inset, h - inset],
  ]
  if (rebar.bars.count > 2) bars.push([inset, inset], [w - inset, inset])
  return (
    <figure className="flex flex-col items-center gap-1">
      <svg viewBox={`${-PAD} ${-PAD} ${w + PAD + RIGHT} ${h + 2 * PAD}`} className="w-full max-w-36" role="img" aria-label={`Sección de ${title}`}>
        <rect width={w} height={h} fill="#d9d6cf" stroke="#6b6860" strokeWidth={1.5} />
        <rect x={c + st / 2} y={c + st / 2} width={w - 2 * c - st} height={h - 2 * c - st} rx={st * 2} fill="none" stroke={BAR_TINT[rebar.stirrups.no]} strokeWidth={Math.max(1.5, st)} />
        {/* gancho de 135° del estribo, en la esquina de arriba a la izquierda */}
        <path d={`M ${c + st} ${c + st} l 9 9`} stroke={BAR_TINT[rebar.stirrups.no]} strokeWidth={Math.max(1.5, st)} />
        {bars.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={Math.max(2.5, r)} fill={BAR_TINT[rebar.bars.no]} />
        ))}
        <text x={w / 2} y={-6} textAnchor="middle" fontSize={11} fill="currentColor">
          {m(width)}
        </text>
        <text x={w + 6} y={h / 2} fontSize={11} fill="currentColor" dominantBaseline="middle">
          {m(height)}
        </text>
      </svg>
      <figcaption className="text-center text-[11px] leading-snug">
        <span className="font-medium">{title}</span>
        <br />
        <span className="text-muted">{rebarText(rebar)}</span>
        <br />
        <span className="text-subtle">recubrimiento {m(cover)} m</span>
      </figcaption>
    </figure>
  )
}

export function StructureDetails({ structure }: { structure: Structure }) {
  const column = structure.columns[0]
  const beam = structure.beams[0]
  const footing = structure.footings[0]
  return (
    <details className="rounded-md border border-line px-2 py-1">
      <summary className="flex min-h-9 cursor-pointer items-center gap-2 text-xs font-medium pointer-coarse:min-h-11">
        <Ruler className="size-4 text-accent" aria-hidden /> Detalles tipo (secciones)
      </summary>
      <div className="grid grid-cols-2 gap-3 py-2 text-fg" aria-label="Detalles tipo">
        {column && <Section title="Columneta" width={column.across} height={column.along} cover={NSR10.cover.column} rebar={column.rebar} />}
        {beam?.rebar && <Section title="Viga de amarre" width={beam.width} height={beam.height} cover={NSR10.cover.beam} rebar={beam.rebar} />}
        {footing?.rebar && <Section title="Viga de cimentación" width={footing.width} height={footing.height} cover={NSR10.cover.footing} rebar={footing.rebar} />}
      </div>
    </details>
  )
}
