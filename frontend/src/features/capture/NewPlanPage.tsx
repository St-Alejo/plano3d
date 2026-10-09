import { Camera, Crop, FileUp, ScanLine, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { api, type Corners } from '@/api/client'
import { Button, TextField } from '@/components/ui'
import { CornerEditor } from './CornerEditor'
import { StartBlank } from './StartBlank'
import { DEFAULT_CORNERS } from './corners'
import { CaptureWarnings, ExtraShots } from './CaptureExtras'
import { ACCEPT, MAX_MB, isDxf, isImage, validateFile } from './validateFile'

const STEPS = ['Elegir el plano', 'Revisar y nombrar', 'Convertir a 3D'] as const

/** Indicador de pasos de la captura, numerado como las figuras de la lámina. */
function CaptureSteps({ current }: { current: number }) {
  return (
    <ol aria-label="Pasos" className="mb-8 flex gap-2 text-sm">
      {STEPS.map((label, i) => (
        <li
          key={label}
          aria-current={i === current ? 'step' : undefined}
          className={`flex-1 border-t-2 pt-2.5 transition-colors duration-300 ${i < current ? 'border-accent-dim text-muted' : i === current ? 'border-brand font-medium text-fg' : 'border-line-strong text-subtle'}`}
        >
          <span className="mr-1.5 font-mono text-xs">{String(i + 1).padStart(2, '0')}</span>
          <span className="hidden sm:inline">{label}</span>
        </li>
      ))}
    </ol>
  )
}

const nameFromFile = (f: File) => f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 80)

export function NewPlanPage() {
  const navigate = useNavigate()
  // un archivo soltado en la landing llega en el estado de la navegación
  const handed = (useLocation().state as { file?: unknown } | null)?.file
  const [initial] = useState(() => {
    if (!(handed instanceof File)) return null
    return { file: handed, error: validateFile(handed) }
  })
  const cameraInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(initial && !initial.error ? initial.file : null)
  const [name, setName] = useState(initial && !initial.error ? nameFromFile(initial.file) : '')
  const [manual, setManual] = useState(false)
  const [corners, setCorners] = useState<Corners>(DEFAULT_CORNERS)
  const [extra, setExtra] = useState<File[]>([])
  const [error, setError] = useState<string | null>(initial?.error ?? null)
  const [sending, setSending] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const suggested = useRef<File | null>(null)

  /** Al abrir el ajuste manual, las esquinas arrancan donde el backend detectó la hoja. */
  const toggleManual = async () => {
    if (manual || !file) return setManual(false)
    setManual(true)
    if (suggested.current === file) return
    suggested.current = file
    setDetecting(true)
    try {
      const detected = await api.suggestCorners(file)
      if (detected) setCorners(detected)
    } catch {
      /* sin sugerencia: quedan las esquinas por defecto */
    } finally {
      setDetecting(false)
    }
  }

  const preview = useMemo(
    () => (file && isImage(file) ? URL.createObjectURL(file) : null),
    [file],
  )
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  const pick = (f: File | undefined) => {
    if (!f) return
    const err = validateFile(f)
    setError(err)
    if (err) return
    setFile(f)
    setName((n) => n || nameFromFile(f))
    setManual(false)
    setCorners(DEFAULT_CORNERS)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    pick(e.dataTransfer.files[0])
  }

  const submit = async () => {
    if (!file) return
    setSending(true)
    setError(null)
    try {
      setProgress(0)
      const res = await api.createProject(
        file,
        name.trim() || 'Plano sin nombre',
        manual && extra.length === 0 ? corners : undefined,
        setProgress,
        isImage(file) ? extra : [],
      )
      navigate(`/p/${res.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo subir el plano')
      setSending(false)
      setProgress(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <p className="font-mono text-xs font-medium tracking-[0.04em] text-accent uppercase">Captura</p>
      <h1 className="mt-3 mb-8 text-5xl leading-[0.95] tracking-[-0.045em]">Nuevo plano</h1>
      <CaptureSteps current={sending ? 2 : file ? 1 : 0} />

      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        data-testid="file-input"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => pick(e.target.files?.[0])}
      />

      {!file && (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`blueprint-grid flex flex-col items-center gap-6 rounded-2xl border-2 border-dashed bg-surface/70 px-6 py-16 text-center transition-[border-color,background-color] duration-300 ${
            dragOver ? 'border-accent bg-accent/5' : 'border-line-strong hover:border-accent-dim'
          }`}
        >
          <span className="grid size-16 place-items-center rounded-2xl bg-accent/10">
            <ScanLine className="size-8 text-accent" aria-hidden />
          </span>
          <div>
            <h2 className="text-xl tracking-[-0.02em]">Fotografía el plano desde arriba</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">
              Que se vea la hoja completa, con buena luz y sin reflejos. La perspectiva se corrige sola.
            </p>
          </div>
          <div className="flex w-full max-w-sm flex-col gap-3 sm:flex-row">
            <Button variant="primary" size="lg" className="sm:flex-1" icon={<Camera className="size-5" aria-hidden />} onClick={() => cameraInput.current?.click()}>
              Tomar foto
            </Button>
            <Button size="lg" className="sm:flex-1" icon={<FileUp className="size-5" aria-hidden />} onClick={() => fileInput.current?.click()}>
              Subir archivo
            </Button>
          </div>
          <p className="text-xs text-subtle">JPG, PNG, WEBP, PDF o DXF · hasta {MAX_MB} MB · o arrástralo aquí</p>
        </div>
      )}

      {!file && <StartBlank />}

      {file && (
        <div className="flex flex-col gap-6">
          <div className="rounded-2xl border border-line bg-surface p-3 shadow-xs">
            {preview && manual && <CornerEditor src={preview} corners={corners} onChange={setCorners} />}
            {preview && !manual && <img src={preview} alt="Vista previa del plano" className="mx-auto max-h-[60vh] object-contain" />}
            {!preview && (
              <p className="p-8 text-center text-sm text-muted">
                {isDxf(file)
                  ? `DXF: se leerán los muros, aberturas y cotas exactas del archivo (${file.name})`
                  : `PDF: se usará la primera página; si viene de CAD, con sus medidas exactas (${file.name})`}
              </p>
            )}
          </div>

          {preview && <CaptureWarnings file={file} />}
          {preview && <ExtraShots value={extra} onChange={setExtra} />}

          {preview && extra.length === 0 && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Button size="sm" variant={manual ? 'primary' : 'secondary'} icon={<Crop className="size-4" aria-hidden />} loading={detecting} onClick={() => void toggleManual()} aria-pressed={manual}>
                {manual ? 'Esquinas manuales' : 'Ajustar esquinas'}
              </Button>
              <span className="text-subtle">
                {manual ? 'Arrastra los puntos a las esquinas de la hoja (o usa las flechas).' : 'Las esquinas se detectan automáticamente.'}
              </span>
            </div>
          )}

          {progress !== null && (
            <div
              id="upload-progress"
              role="progressbar"
              aria-label="Subida del archivo"
              aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1 w-full overflow-hidden rounded-full bg-raised"
            >
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress * 100}%` }} />
            </div>
          )}

          <TextField label="Nombre del proyecto" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Ej. Depto 3B" />

          <div className="sticky bottom-0 z-10 -mx-4 flex flex-col-reverse gap-3 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:justify-between sm:border-0 sm:bg-transparent sm:p-0">
            <Button variant="ghost" icon={<X className="size-4" aria-hidden />} onClick={() => setFile(null)} disabled={sending}>
              Elegir otra
            </Button>
            <Button variant="primary" size="lg" loading={sending} onClick={() => void submit()} aria-describedby={progress !== null ? 'upload-progress' : undefined}>
              {progress !== null && progress < 1 ? `Subiendo… ${Math.round(progress * 100)}%` : 'Convertir a 3D'}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger/8 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
