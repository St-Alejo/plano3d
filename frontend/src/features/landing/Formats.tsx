/**
 * Lee cualquier plano: qué entradas acepta la app, cómo lee cada una y qué tan exactas
 * salen sus medidas, en una tabla editorial. Debajo, las tres marcas de cota que se ven en el
 * editor, en sus mismos colores, dibujadas sobre la hoja del plano.
 */
import { DIM_SAMPLES, FORMATS } from './content'
import { Reveal, Stagger, StaggerItem } from './reveal'
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
      <text x="100" y="22" textAnchor="middle" fill={color} fontSize="17" fontWeight="500" fontFamily="JetBrains Mono, monospace">
        {value}
      </text>
    </svg>
  )
}

export function Formats() {
  return (
    <section aria-labelledby="formatos" className="frame grid gap-16 py-24 sm:py-36">
      <SectionHead id="formatos" index={3} label="Formatos" title="Foto, PDF o DXF: lo lee." lead="Cada entrada se lee a su manera, y cada medida dice qué tan segura es." />
      <Reveal>
        <table className="hidden w-full border-collapse text-left md:table">
          <caption className="sr-only">Entradas que acepta la app, cómo se leen y qué tan exactas salen las medidas</caption>
          <thead>
            <tr className="border-b border-(--l-fg)">
              <th scope="col" className="t-label w-1/4 py-4 pr-6 font-normal">Entrada</th>
              <th scope="col" className="t-label py-4 pr-6 font-normal">Cómo se lee</th>
              <th scope="col" className="t-label w-1/3 py-4 font-normal">Medidas</th>
            </tr>
          </thead>
          <tbody>
            {FORMATS.map((f, i) => (
              <tr key={f.name} className="group border-b border-(--l-rule) align-top transition-colors duration-300 hover:bg-(--l-card)">
                {/* el número va en CSS: el nombre de la fila queda limpio para lectores y pruebas */}
                <th
                  scope="row"
                  data-n={String(i + 1).padStart(2, '0')}
                  className="py-8 pr-6 font-normal before:mr-4 before:font-mono before:text-xs before:tracking-[0.14em] before:text-(--l-text-accent) before:content-[attr(data-n)]"
                >
                  <span className="display t-h3 transition-transform duration-300 group-hover:translate-x-1 inline-block">{f.name}</span>
                </th>
                <td className="max-w-prose py-8 pr-6 text-(--l-dim)">{f.how}</td>
                <td className="py-8">{f.size}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="grid gap-10 md:hidden">
          {FORMATS.map((f) => (
            <div key={f.name} className="grid gap-2 border-t border-(--l-rule) pt-6">
              <dt className="display t-h3">{f.name}</dt>
              <dd className="text-(--l-dim)">{f.how}</dd>
              <dd>{f.size}</dd>
            </div>
          ))}
        </dl>
      </Reveal>
      <Stagger as="ul" aria-label="Cómo se marca cada cota" className="grid gap-4 sm:grid-cols-3" gap={0.08}>
        {DIM_SAMPLES.map((d) => (
          <StaggerItem key={d.status} as="li" className="grid gap-4 rounded-xl bg-(--l-sheet) p-6 ring-1 ring-(--l-rule) sm:p-8">
            <Dim value={d.value} color={d.color} />
            <p>
              {/* el color lo lleva la cota dibujada; el texto va en tinta para que se lea (AA) */}
              <strong className="font-semibold">{d.label}</strong>
              <span className="text-(--l-dim)">: {d.text}.</span>
            </p>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  )
}
