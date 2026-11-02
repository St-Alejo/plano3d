/**
 * Preguntas frecuentes: título fijo a la izquierda y respuestas cortas que se despliegan
 * (details/summary: funcionan con teclado y sin JavaScript).
 */
import { Plus } from 'lucide-react'

import { FAQ } from './content'
import { Stagger, StaggerItem } from './reveal'

export function Faq() {
  return (
    <section aria-labelledby="preguntas" className="frame grid gap-12 py-20 sm:py-32 lg:grid-cols-[4fr_8fr] lg:gap-20">
      <div>
        <h2 id="preguntas" className="t-h2 lg:sticky lg:top-28">
          Preguntas frecuentes.
        </h2>
      </div>
      <Stagger as="ul" aria-label="Preguntas" className="grid" gap={0.06}>
        {FAQ.map((f) => (
          <StaggerItem key={f.q} as="li" className="border-b border-(--l-rule) first:border-t">
            <details className="group">
              <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-6 py-5 transition-colors duration-300 hover:text-(--l-signal) [&::-webkit-details-marker]:hidden">
                <h3 className="display t-h3">{f.q}</h3>
                <Plus className="size-6 shrink-0 transition-transform duration-300 group-open:rotate-45" aria-hidden />
              </summary>
              <p className="max-w-2xl pb-7">{f.a}</p>
            </details>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  )
}
