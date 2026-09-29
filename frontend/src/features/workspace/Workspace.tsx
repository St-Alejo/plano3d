import * as Tabs from '@radix-ui/react-tabs'
import { Box, Check, Save } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '@/api/client'
import type { Point, Project } from '@/api/types'
import { CalibrateScale } from '@/domain/commands'
import { Button, Spinner } from '@/components/ui'
import { CalibrateDialog } from '@/features/editor2d/CalibrateDialog'
import { PropertiesPanel } from '@/features/editor2d/PropertiesPanel'
import { Toolbar } from '@/features/editor2d/Toolbar'
import { TOOLS } from '@/features/editor2d/tools'
import { selectIsDirty, useEditor } from '@/store/editorStore'
import { UnsavedChangesGuard } from './UnsavedChangesGuard'
import { useEditorShortcuts } from './useShortcuts'

// Konva y Three.js son pesados: se cargan solo al entrar al espacio de trabajo
const Editor2D = lazy(() => import('@/features/editor2d/Editor2D').then((m) => ({ default: m.Editor2D })))
const Viewer3D = lazy(() => import('@/features/viewer3d/Viewer3D').then((m) => ({ default: m.Viewer3D })))

function useIsDesktop(): boolean {
  const query = '(min-width: 1024px)'
  const [desktop, setDesktop] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const fn = () => setDesktop(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return desktop
}

export function Workspace({ project }: { project: Project }) {
  const load = useEditor((s) => s.load)
  const model = useEditor((s) => s.model)
  const dirty = useEditor(selectIsDirty)
  const tool = useEditor((s) => s.tool)
  const selection = useEditor((s) => s.selection)
  const error = useEditor((s) => s.error)
  const clearError = useEditor((s) => s.clearError)
  const dispatch = useEditor((s) => s.dispatch)
  const select = useEditor((s) => s.select)
  const markSaved = useEditor((s) => s.markSaved)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [calib, setCalib] = useState<{ a: Point; b: Point } | null>(null)
  const desktop = useIsDesktop()
  const [coarse] = useState(() => window.matchMedia('(pointer: coarse)').matches)

  useEffect(() => {
    if (project.model) load(project.id, project.model)
  }, [project.id, project.model, load])

  const save = useCallback(async (): Promise<boolean> => {
    const m = useEditor.getState().model
    if (!m || !selectIsDirty(useEditor.getState())) return true
    setSaving(true)
    setSaveError(null)
    try {
      await api.saveModel(project.id, m)
      markSaved()
      return true
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'No se pudo guardar')
      return false
    } finally {
      setSaving(false)
    }
  }, [project.id, markSaved])

  useEditorShortcuts(() => void save())

  // aviso al salir con cambios sin guardar
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  if (!model) return <Spinner label="Preparando el editor" />

  const imageUrl = api.imageUrl(project.id, 'rectified', project.updated_at)
  const t = TOOLS.find((x) => x.id === tool)
  const hint = coarse ? t?.touchHint : t?.hint

  const editor = (
    <Suspense fallback={<Spinner label="Cargando editor 2D" />}>
      <Editor2D imageUrl={imageUrl} onCalibrate={(a, b) => setCalib({ a, b })} />
    </Suspense>
  )
  const viewer = (
    <Suspense fallback={<Spinner label="Cargando visor 3D" />}>
      <Viewer3D
        model={model}
        className="size-full"
        highlightWallId={selection?.kind === 'wall' ? selection.id : selection?.kind === 'opening' ? selection.wallId : null}
        onPick={(p) => select(p)}
      />
    </Suspense>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <UnsavedChangesGuard dirty={dirty} onSave={save} />
      <Toolbar
        trailing={
          <>
            <span className="hidden font-mono text-xs text-subtle lg:inline" aria-live="polite">
              {saving ? 'guardando…' : dirty ? 'cambios sin guardar' : 'guardado'}
            </span>
            <Button
              size="sm"
              variant={dirty ? 'primary' : 'secondary'}
              loading={saving}
              disabled={!dirty}
              aria-label={dirty ? 'Guardar cambios' : 'Todo guardado'}
              title={dirty ? 'Guardar (Ctrl+S)' : 'No hay cambios pendientes'}
              icon={dirty ? <Save className="size-4" aria-hidden /> : <Check className="size-4" aria-hidden />}
              onClick={() => void save()}
            >
              <span className="hidden sm:inline">Guardar</span>
            </Button>
            <Link
              to={`/p/${project.id}/3d`}
              aria-label="Recorrer en 3D"
              className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-line-strong px-3 text-sm hover:border-accent pointer-coarse:h-11 pointer-coarse:min-w-11"
            >
              <Box className="size-4" aria-hidden /> <span className="hidden sm:inline">Recorrer</span>
            </Link>
          </>
        }
      />
      {hint && <p className="border-b border-line bg-canvas px-3 py-1.5 text-xs text-muted">{hint}</p>}
      {(error || saveError) && (
        <div role="alert" className="flex items-center justify-between gap-2 border-b border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <span>{error ?? saveError}</span>
          <button type="button" className="underline" onClick={() => (clearError(), setSaveError(null))}>
            Cerrar
          </button>
        </div>
      )}

      {desktop ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_280px]">
          <section aria-label="Editor 2D" className="min-h-0 border-r border-line">{editor}</section>
          <section aria-label="Vista 3D" className="min-h-0 border-r border-line">{viewer}</section>
          <aside aria-label="Propiedades" className="overflow-y-auto bg-surface p-4">
            <PropertiesPanel />
          </aside>
        </div>
      ) : (
        <Tabs.Root defaultValue="2d" className="flex min-h-0 flex-1 flex-col">
          <Tabs.List className="grid grid-cols-3 border-b border-line bg-surface" aria-label="Vistas">
            {[
              ['2d', 'Plano 2D'],
              ['3d', 'Vista 3D'],
              ['props', 'Detalles'],
            ].map(([v, l]) => (
              <Tabs.Trigger key={v} value={v!} className="h-11 text-sm text-muted data-[state=active]:border-b-2 data-[state=active]:border-accent data-[state=active]:text-fg">
                {l}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Tabs.Content value="2d" className="min-h-[60vh] flex-1">{editor}</Tabs.Content>
          <Tabs.Content value="3d" className="min-h-[60vh] flex-1">{viewer}</Tabs.Content>
          <Tabs.Content value="props" className="flex-1 overflow-y-auto p-4">
            <PropertiesPanel />
          </Tabs.Content>
        </Tabs.Root>
      )}

      <CalibrateDialog
        line={calib}
        onClose={() => setCalib(null)}
        onConfirm={(meters) => {
          if (calib) dispatch(new CalibrateScale(calib.a, calib.b, meters))
          setCalib(null)
          useEditor.getState().setTool('select')
        }}
      />
    </div>
  )
}
