/**
 * Preguntas frecuentes: título fijo a la izquierda y respuestas cortas que se despliegan
 * (details/summary: funcionan con teclado y sin JavaScript), separadas por líneas finas.
 */
import { Plus } from 'lucide-react'

import { FAQ } from './content'
import { SectionHead } from './sections'
import { Stagger, StaggerItem } from './reveal'

export function Faq() {
  return (
    <section aria-labelledby="preguntas" className="frame grid gap-14 py-24 sm:py-36 lg:grid-cols-[5fr_7fr] lg:gap-20">
      <div>
        <SectionHead id="preguntas" index={6} label="Preguntas" title="Preguntas frecuentes." className="lg:sticky lg:top-28" />
      </div>
      <Stagger as="ul" aria-label="Preguntas" className="grid border-t border-(--l-fg)" gap={0.06}>
        {FAQ.map((f) => (
          <StaggerItem key={f.q} as="li" className="border-b border-(--l-rule)">
            <details className="group">
              <summary className="flex min-h-18 cursor-pointer list-none items-center justify-between gap-6 py-6 transition-colors duration-300 hover:text-(--l-text-accent) [&::-webkit-details-marker]:hidden">
                <h3 className="display t-h3">{f.q}</h3>
                <span className="grid size-11 shrink-0 place-items-center rounded-full border border-(--l-rule) transition-[transform,background-color,color] duration-300 group-open:rotate-45 group-open:bg-(--l-accent) group-open:text-(--l-on-accent)">
                  <Plus className="size-5" aria-hidden />
                </span>
              </summary>
              <p className="max-w-2xl pb-8 text-(--l-dim)">{f.a}</p>
            </details>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  )
}
