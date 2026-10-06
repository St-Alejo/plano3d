import { Camera, Crop, FileUp, ScanLine, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router'
import { api, type Corners } from '@/api/client'
import { Button, TextField } from '@/components/ui'
import { CornerEditor } from './CornerEditor'
import { DEFAULT_CORNERS } from './corners'
import { CaptureWarnings, ExtraShots } from './CaptureExtras'
import { ACCEPT, MAX_MB, isDxf, isImage, validateFile } from './validateFile'


export function NewPlanPage() {
  const navigate = useNavigate()
  const cameraInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [manual, setManual] = useState(false)
  const [corners, setCorners] = useState<Corners>(DEFAULT_CORNERS)
  const [extra, setExtra] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
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
    setName((n) => n || f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 80))
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
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <p className="font-mono text-xs text-accent-dim">02 — Captura</p>
      <h1 className="mb-6 text-2xl font-semibold sm:text-3xl">Nuevo plano</h1>

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
          className={`corner-ticks blueprint-grid flex flex-col items-center gap-6 border px-6 py-14 text-center transition ${
            dragOver ? 'border-accent bg-accent/5' : 'border-line'
          }`}
        >
          <ScanLine className="size-12 text-accent" aria-hidden />
          <div>
            <h2 className="text-lg font-semibold">Fotografía el plano desde arriba</h2>
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

      {file && (
        <div className="flex flex-col gap-6">
          <div className="corner-ticks border border-line bg-surface p-3">
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
              className="h-1 w-full overflow-hidden bg-raised"
            >
              <div className="h-full bg-accent transition-[width]" style={{ width: `${progress * 100}%` }} />
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
        <p role="alert" className="mt-4 border-l-2 border-danger pl-3 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
