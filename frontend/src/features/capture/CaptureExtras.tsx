/**
 * Ayudas de captura para planos grandes (fase 3):
 * - avisos de calidad de la foto (movida, reflejo, poca resolución) apenas se elige;
 * - más fotos de la misma hoja (A1/A0 tomada por partes, de izquierda a derecha).
 */
import { AlertTriangle, ImagePlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import { Button } from '@/components/ui'
import { isImage, validateFile } from './validateFile'

/** Avisos de calidad de la foto principal (no bloquean: se puede subir igual). */
export function CaptureWarnings({ file }: { file: File }) {
  const [warnings, setWarnings] = useState<string[]>([])
  useEffect(() => {
    if (!isImage(file)) return
    let alive = true
    api
      .checkCapture(file)
      .then((r) => alive && setWarnings(r.warnings ?? []))
      .catch(() => alive && setWarnings([]))
    return () => {
      alive = false
      setWarnings([])
    }
  }, [file])
  if (warnings.length === 0) return null
  return (
    <ul role="status" aria-label="Avisos sobre la foto" className="flex flex-col gap-1 border-l-2 border-warn pl-3 text-sm">
      {warnings.map((w) => (
        <li key={w} className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          {w}
        </li>
      ))}
    </ul>
  )
}

/** Lista de fotos adicionales de la misma hoja. */
export function ExtraShots({ value, onChange }: { value: File[]; onChange: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const add = (list: FileList | null) => {
    const files = [...(list ?? [])]
    const bad = files.map((f) => (isImage(f) ? validateFile(f) : 'Solo fotos (JPG, PNG o WEBP)')).find(Boolean)
    setError(bad ?? null)
    if (!bad) onChange([...value, ...files])
  }
  return (
    <section aria-label="Plano grande en varias fotos" className="flex flex-col gap-2 text-sm">
      <p className="text-subtle">
        ¿El plano es grande (pliego A1 o A0)? Tómalo por partes, de izquierda a derecha, solapando cada
        foto entre un tercio y la mitad con la anterior: se unen en una sola imagen y las cotas se leen mejor.
      </p>
      {value.length > 0 && (
        <ol className="flex flex-col gap-1">
          {value.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 font-mono text-xs">
              <span>
                parte {i + 2}: {f.name}
              </span>
              <button
                type="button"
                aria-label={`Quitar ${f.name}`}
                className="text-subtle hover:text-ink"
                onClick={() => onChange(value.filter((_, k) => k !== i))}
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      )}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => add(e.target.files)} />
      <div>
        <Button size="sm" variant="secondary" icon={<ImagePlus className="size-4" aria-hidden />} onClick={() => input.current?.click()}>
          Agregar otra parte de la hoja
        </Button>
      </div>
      {error && <p className="text-danger">{error}</p>}
    </section>
  )
}
