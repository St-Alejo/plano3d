/**
 * Lee cualquier plano: qué entradas acepta la app, cómo lee cada una y qué tan exactas
 * salen sus medidas. Debajo, las tres marcas de cota que se ven en el editor, en sus
 * mismos colores, dibujadas sobre la hoja del plano.
 */
import { DIM_SAMPLES, FORMATS } from './content'
import { Reveal } from './reveal'
import { SectionHead } from './sections'

/** Una cota como en el editor: línea con remates y el valor encima. */
function Dim({ value, color }: { value: string; color: string }) {
  return (
    <svg viewBox="0 0 200 44" className="h-11 w-full max-w-56" aria-hidden>
      <g stroke={color} strokeWidth="2" strokeLinecap="round">
        <line x1="8" y1="32" x2="192" y2="32" />
        <line x1="8" y1="24" x2="8" y2="40" />
        <line x1="192" y1="24" x2="192" y2="40" />
        <line x1="3" y1="37" x2="13" y2="27" />
        <line x1="187" y1="37" x2="197" y2="27" />
      </g>
      <text x="100" y="22" textAnchor="middle" fill={color} fontSize="17" fontWeight="600" fontFamily="Geist, sans-serif">
        {value}
      </text>
    </svg>
  )
}

export function Formats() {
  return (
    <section aria-labelledby="formatos" className="frame grid gap-12 py-20 sm:py-32">
      <SectionHead id="formatos" title="Foto, PDF o DXF: lo lee." lead="Cada entrada se lee a su manera, y cada medida dice qué tan segura es." />
      <Reveal>
        <table className="hidden w-full border-collapse text-left md:table">
          <caption className="sr-only">Entradas que acepta la app, cómo se leen y qué tan exactas salen las medidas</caption>
          <thead>
            <tr className="border-b border-(--l-rule) text-(--l-dim)">
              <th scope="col" className="w-1/5 py-4 pr-6 font-normal">Entrada</th>
              <th scope="col" className="py-4 pr-6 font-normal">Cómo se lee</th>
              <th scope="col" className="w-1/3 py-4 font-normal">Medidas</th>
            </tr>
          </thead>
          <tbody>
            {FORMATS.map((f) => (
              <tr key={f.name} className="border-b border-(--l-rule) align-top transition-colors duration-300 hover:bg-(--l-night-2)">
                <th scope="row" className="display t-h3 py-7 pr-6 font-normal">
                  {f.name}
                </th>
                <td className="max-w-prose py-7 pr-6">{f.how}</td>
                <td className="py-7">{f.size}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="grid gap-10 md:hidden">
          {FORMATS.map((f) => (
            <div key={f.name} className="grid gap-2">
              <dt className="display t-h3">{f.name}</dt>
              <dd>{f.how}</dd>
              <dd className="text-(--l-dim)">{f.size}</dd>
            </div>
          ))}
        </dl>
      </Reveal>
      <Reveal>
        <ul aria-label="Cómo se marca cada cota" className="grid gap-8 bg-(--l-sheet) px-6 py-10 text-(--l-on-signal) sm:grid-cols-3 sm:px-10">
          {DIM_SAMPLES.map((d) => (
            <li key={d.status} className="grid gap-3">
              <Dim value={d.value} color={d.color} />
              <p>
                {/* el color lo lleva la cota dibujada; el texto va en tinta para que se lea (AA) */}
                <strong className="font-semibold">{d.label}</strong>
                : {d.text}.
              </p>
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  )
}
