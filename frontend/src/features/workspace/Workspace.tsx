import * as Dialog from '@radix-ui/react-dialog'
import * as Tabs from '@radix-ui/react-tabs'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { Box, Check, Command, PanelLeft, Save } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApiError, api } from '@/api/client'
import type { Point, Project } from '@/api/types'
import { CalibrateScale, ReplaceModel } from '@/domain/commands'
import { Button, IconButton, Spinner } from '@/components/ui'
import { CalibrateDialog } from '@/features/editor2d/CalibrateDialog'
import { PropertiesPanel } from '@/features/editor2d/PropertiesPanel'
import { Toolbar } from '@/features/editor2d/Toolbar'
import { TOOLS } from '@/features/editor2d/tools'
import { selectIsDirty, useEditor, type ViewMode } from '@/store/editorStore'
import { buildActions } from './actions'
import { AreaSchedulePanel } from './AreaSchedulePanel'
import { CatalogPanel } from './CatalogPanel'
import { CommandPalette } from './CommandPalette'
import { EditorContextMenu } from './EditorContextMenu'
import { GroupInspector } from './GroupInspector'
import { HistoryDialog } from './HistoryDialog'
import { LayersPanel } from './LayersPanel'
import { ShortcutsHelp } from './ShortcutsHelp'
import { StatusBar } from './StatusBar'
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

export function Workspace({ project, onReload }: { project: Project; onReload: () => void }) {
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
  const revision = useEditor((s) => s.revision)
  const viewMode = useEditor((s) => s.viewMode)
  const setViewMode = useEditor((s) => s.setViewMode)
  const groupSize = useEditor((s) => s.group.length)
  const [layersOpen, setLayersOpen] = useState(true)
  const [conflict, setConflict] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [calib, setCalib] = useState<{ a: Point; b: Point } | null>(null)
  const desktop = useIsDesktop()
  const [coarse] = useState(() => window.matchMedia('(pointer: coarse)').matches)

  useEffect(() => {
    if (project.model) load(project.id, project.model, project.revision)
  }, [project.id, project.model, project.revision, load])

  /**
   * Guarda con bloqueo optimista (If-Match con la revisión cargada). Si otra persona
   * guardó antes, el servidor responde 409 y se ofrece recargar o sobrescribir.
   */
  const save = useCallback(
    async (force = false): Promise<boolean> => {
      const st = useEditor.getState()
      const m = st.model
      if (!m || (!force && !selectIsDirty(st))) return true
      setSaving(true)
      setSaveError(null)
      try {
        const saved = await api.saveModel(project.id, m, force ? '*' : st.revision, st.undoLabel ?? 'Corrección manual')
        markSaved(saved.revision)
        setConflict(null)
        return true
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) setConflict(e.message)
        else setSaveError(e instanceof Error ? e.message : 'No se pudo guardar')
        return false
      } finally {
        setSaving(false)
      }
    },
    [project.id, markSaved],
  )

  /** Ajuste a cotas: guarda, el servidor resuelve y el resultado entra como un comando (deshacible). */
  const [solving, setSolving] = useState(false)
  const solve = useCallback(async () => {
    if (!(await save())) return
    setSolving(true)
    setSaveError(null)
    try {
      const res = await api.solve(project.id, useEditor.getState().revision)
      if (res.project.model) {
        dispatch(new ReplaceModel(res.project.model))
        markSaved(res.project.revision)
      }
      const r = res.report
      if (r.dims_conflict > 0) {
        setSaveError(`${r.dims_conflict} cota(s) no cierran con las demás: revísalas (en rojo).`)
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'No se pudo ajustar a las cotas')
    } finally {
      setSolving(false)
    }
  }, [project.id, save, dispatch, markSaved])

  const navigate = useNavigate()
  const [palette, setPalette] = useState(false)
  const [help, setHelp] = useState(false)
  const actions = useMemo(
    () =>
      buildActions({
        save: () => void save(),
        openPalette: () => setPalette(true),
        openHelp: () => setHelp(true),
        open3D: () => void navigate(`/p/${project.id}/3d`),
      }),
    [save, navigate, project.id],
  )
  useEditorShortcuts(actions)

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
    <EditorContextMenu actions={actions}>
      <div className="size-full">
        <Suspense fallback={<Spinner label="Cargando editor 2D" />}>
          <Editor2D imageUrl={imageUrl} onCalibrate={(a, b) => setCalib({ a, b })} />
        </Suspense>
      </div>
    </EditorContextMenu>
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
      <UnsavedChangesGuard dirty={dirty} onSave={() => save()} />
      <Dialog.Root open={conflict !== null} onOpenChange={(o) => !o && setConflict(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-canvas/70 backdrop-blur-sm" />
          <Dialog.Content className="corner-ticks fixed top-1/2 left-1/2 z-50 w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 border border-line-strong bg-surface p-6">
            <Dialog.Title className="font-display text-lg font-semibold">Otra versión se guardó mientras editabas</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted">
              {conflict} Puedes cargar la versión guardada (tus cambios se descartan) o sobrescribirla con la tuya
              (la otra queda en el historial y se puede restaurar).
            </Dialog.Description>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="ghost"
                onClick={() => {
                  setConflict(null)
                  onReload()
                }}
              >
                Cargar la versión guardada
              </Button>
              <Button variant="primary" loading={saving} onClick={() => void save(true)}>
                Sobrescribir con la mía
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Toolbar
        trailing={
          <>
            {desktop && (
              <>
                <IconButton label="Panel de capas" active={layersOpen} onClick={() => setLayersOpen((o) => !o)}>
                  <PanelLeft className="size-5" aria-hidden />
                </IconButton>
                <ToggleGroup.Root
                  type="single"
                  value={viewMode}
                  onValueChange={(v) => v && setViewMode(v as ViewMode)}
                  aria-label="Vista"
                  className="flex rounded-md border border-line p-0.5"
                >
                  {(
                    [
                      ['2d', 'Plano', '1'],
                      ['split', 'Dividido', '2'],
                      ['3d', '3D', '3'],
                    ] as const
                  ).map(([v, l, k]) => (
                    <ToggleGroup.Item
                      key={v}
                      value={v}
                      title={`${l} (${k})`}
                      className="h-7 rounded-sm px-2.5 text-xs text-muted data-[state=on]:bg-raised data-[state=on]:text-fg"
                    >
                      {l}
                    </ToggleGroup.Item>
                  ))}
                </ToggleGroup.Root>
                <IconButton label="Buscar un comando" shortcut="Ctrl+K" onClick={() => setPalette(true)}>
                  <Command className="size-5" aria-hidden />
                </IconButton>
              </>
            )}
            <span className="hidden font-mono text-xs text-subtle xl:inline" aria-live="polite">
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
            <HistoryDialog projectId={project.id} currentRevision={revision} dirty={dirty} onRestored={onReload} />
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
      {hint && !desktop && <p className="border-b border-line bg-canvas px-3 py-1.5 text-xs text-muted">{hint}</p>}
      {(error || saveError) && (
        <div role="alert" className="flex items-center justify-between gap-2 border-b border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <span>{error ?? saveError}</span>
          <button type="button" className="underline" onClick={() => (clearError(), setSaveError(null))}>
            Cerrar
          </button>
        </div>
      )}

      {desktop ? (
        <>
          <div className={`grid min-h-0 flex-1 ${layersOpen ? 'grid-cols-[220px_minmax(0,1fr)_300px]' : 'grid-cols-[minmax(0,1fr)_300px]'}`}>
            {layersOpen && (
              <aside aria-label="Capas y objetos" className="min-h-0 overflow-y-auto border-r border-line bg-surface p-3">
                <LayersPanel />
                <div className="mt-6">
                  <CatalogPanel />
                </div>
              </aside>
            )}
            <div className={`grid min-h-0 ${viewMode === 'split' ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {viewMode !== '3d' && <section aria-label="Editor 2D" className="min-h-0 border-r border-line">{editor}</section>}
              {viewMode !== '2d' && <section aria-label="Vista 3D" className="min-h-0 border-r border-line">{viewer}</section>}
            </div>
            <Tabs.Root defaultValue="props" className="flex min-h-0 flex-col bg-surface">
              <Tabs.List aria-label="Inspector" className="grid shrink-0 grid-cols-2 border-b border-line">
                {(
                  [
                    ['props', 'Propiedades'],
                    ['areas', 'Áreas'],
                  ] as const
                ).map(([v, l]) => (
                  <Tabs.Trigger
                    key={v}
                    value={v}
                    className="h-9 text-xs text-muted data-[state=active]:border-b-2 data-[state=active]:border-brand data-[state=active]:text-fg"
                  >
                    {l}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
              <Tabs.Content value="props" asChild>
                <aside aria-label="Propiedades" className="min-h-0 flex-1 overflow-y-auto p-4">
                  {groupSize > 1 ? <GroupInspector /> : <PropertiesPanel onSolve={() => void solve()} solving={solving} />}
                </aside>
              </Tabs.Content>
              <Tabs.Content value="areas" className="min-h-0 flex-1 overflow-y-auto p-4">
                <AreaSchedulePanel projectName={project.name} />
              </Tabs.Content>
            </Tabs.Root>
          </div>
          <StatusBar hint={hint} onHelp={() => setHelp(true)} />
        </>
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
          <Tabs.Content value="props" className="flex flex-1 flex-col gap-8 overflow-y-auto p-4">
            <PropertiesPanel onSolve={() => void solve()} solving={solving} />
            <div>
              <h2 className="mb-3 font-serif text-2xl font-normal">Cuadro de áreas</h2>
              <AreaSchedulePanel projectName={project.name} />
            </div>
            <CatalogPanel />
          </Tabs.Content>
        </Tabs.Root>
      )}

      <CommandPalette open={palette} onOpenChange={setPalette} actions={actions} />
      <ShortcutsHelp open={help} onOpenChange={setHelp} actions={actions} />
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
