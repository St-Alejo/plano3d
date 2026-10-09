/**
 * Registro único de acciones del editor (patrón Command a nivel de interfaz):
 * cada acción declara su nombre, atajo, cuándo está disponible y qué hace. Los
 * atajos de teclado, la paleta de comandos (Ctrl+K), la ayuda de atajos (?) y el
 * menú contextual se construyen desde esta misma lista, así nunca se contradicen.
 */
import type { ReactNode } from 'react'
import { normalize } from '@/features/projects/listing'
import { TOOLS } from '@/features/editor2d/tools'
import { useEditor, type ViewMode } from '@/store/editorStore'
import {
  canCopy,
  canDelete,
  canPaste,
  canRotate,
  copySelection,
  deleteSelection,
  duplicateSelection,
  nudgeSelection,
  paste,
  rotateSelection,
  selectAllWalls,
} from './editActions'

export type ActionGroup = 'Herramientas' | 'Edición' | 'Selección' | 'Vista' | 'Proyecto'

export interface EditorAction {
  id: string
  label: string
  group: ActionGroup
  /** atajo tal como se muestra ("Ctrl+C") */
  keys?: string
  /** reconoce el atajo en un evento de teclado */
  match?: (e: KeyboardEvent) => boolean
  enabled?: () => boolean
  /** recibe el evento cuando se dispara por teclado (p. ej. Shift cambia el paso de las flechas) */
  run: (e?: KeyboardEvent) => void
  icon?: ReactNode
  /** solo atajo: no aparece en la paleta ni en la ayuda (p. ej. mover con flechas) */
  hidden?: boolean
}

export interface ActionContext {
  save: () => void
  openPalette: () => void
  openHelp: () => void
  open3D: () => void
  /** dentro del estudio: pantalla completa y salir; fuera: abrirlo */
  studio?: { fullscreen: () => void; exit: () => void } | { open: () => void }
}

const mod = (e: KeyboardEvent) => e.ctrlKey || e.metaKey

/** "mod+shift+z", "delete", "?"... → comparador de eventos de teclado. */
export function combo(spec: string): (e: KeyboardEvent) => boolean {
  const parts = spec.toLowerCase().split('+')
  const key = parts.at(-1)!
  const wantMod = parts.includes('mod')
  const wantShift = parts.includes('shift')
  const wantAlt = parts.includes('alt')
  return (e) => {
    if (e.key.toLowerCase() !== key) return false
    if (mod(e) !== wantMod || e.altKey !== wantAlt) return false
    // "?" y similares ya implican Shift en el teclado: solo se exige cuando se pide explícitamente
    return key.length > 1 || /[a-z0-9]/.test(key) ? e.shiftKey === wantShift : true
  }
}

const any =
  (...fns: ((e: KeyboardEvent) => boolean)[]) =>
  (e: KeyboardEvent) =>
    fns.some((f) => f(e))

const st = () => useEditor.getState()

const VIEWS: { mode: ViewMode; label: string; key: string }[] = [
  { mode: '2d', label: 'Ver solo el plano 2D', key: '1' },
  { mode: 'split', label: 'Ver plano y 3D lado a lado', key: '2' },
  { mode: '3d', label: 'Ver solo la vista 3D', key: '3' },
]

export function buildActions(ctx: ActionContext): EditorAction[] {
  const nudge = (dx: number, dy: number) => (e?: KeyboardEvent) => {
    const step = e?.shiftKey ? 0.25 : 0.05
    nudgeSelection(dx * step, dy * step)
  }
  const arrows: [string, number, number][] = [
    ['arrowleft', -1, 0],
    ['arrowright', 1, 0],
    ['arrowup', 0, -1],
    ['arrowdown', 0, 1],
  ]

  return [
    ...TOOLS.map(
      (t): EditorAction => ({
        id: `tool.${t.id}`,
        label: t.label,
        group: 'Herramientas',
        keys: t.key,
        match: combo(t.key),
        run: () => st().setTool(t.id),
        icon: t.icon,
      }),
    ),
    { id: 'edit.undo', label: 'Deshacer', group: 'Edición', keys: 'Ctrl+Z', match: combo('mod+z'), enabled: () => st().canUndo, run: () => st().undo() },
    {
      id: 'edit.redo',
      label: 'Rehacer',
      group: 'Edición',
      keys: 'Ctrl+Shift+Z',
      match: any(combo('mod+shift+z'), combo('mod+y')),
      enabled: () => st().canRedo,
      run: () => st().redo(),
    },
    { id: 'edit.copy', label: 'Copiar muros', group: 'Edición', keys: 'Ctrl+C', match: combo('mod+c'), enabled: canCopy, run: () => void copySelection() },
    { id: 'edit.paste', label: 'Pegar', group: 'Edición', keys: 'Ctrl+V', match: combo('mod+v'), enabled: canPaste, run: () => void paste() },
    { id: 'edit.duplicate', label: 'Duplicar', group: 'Edición', keys: 'Ctrl+D', match: combo('mod+d'), enabled: canCopy, run: () => void duplicateSelection() },
    {
      id: 'edit.delete',
      label: 'Eliminar selección',
      group: 'Edición',
      keys: 'Supr',
      match: any(combo('delete'), combo('backspace')),
      enabled: canDelete,
      run: () => void deleteSelection(),
    },
    ...arrows.map(
      ([key, dx, dy]): EditorAction => ({
        id: `edit.nudge.${key}`,
        label: 'Mover selección',
        group: 'Edición',
        match: (e) => e.key.toLowerCase() === key && !mod(e) && !e.altKey,
        enabled: () => st().group.some((g) => g.kind === 'wall' || g.kind === 'furniture'),
        run: nudge(dx, dy),
        hidden: true,
      }),
    ),
    { id: 'edit.rotate', label: 'Girar mueble 90°', group: 'Edición', keys: 'R', match: combo('r'), enabled: canRotate, run: () => void rotateSelection() },
    { id: 'select.all', label: 'Seleccionar todos los muros', group: 'Selección', keys: 'Ctrl+A', match: combo('mod+a'), run: () => void selectAllWalls() },
    {
      id: 'select.none',
      label: 'Quitar selección',
      group: 'Selección',
      keys: 'Esc',
      match: combo('escape'),
      run: () => {
        st().select(null)
        st().setTool('select')
      },
    },
    ...VIEWS.map(
      (v): EditorAction => ({
        id: `view.${v.mode}`,
        label: v.label,
        group: 'Vista',
        keys: v.key,
        match: combo(v.key),
        run: () => st().setViewMode(v.mode),
      }),
    ),
    { id: 'view.dimensions', label: 'Mostrar u ocultar cotas', group: 'Vista', run: () => st().toggleDimensions() },
    { id: 'view.image', label: 'Mostrar u ocultar el plano original', group: 'Vista', run: () => st().toggleLayer('image', 'hidden') },
    { id: 'project.save', label: 'Guardar', group: 'Proyecto', keys: 'Ctrl+S', match: combo('mod+s'), run: ctx.save },
    { id: 'project.3d', label: 'Recorrer en 3D', group: 'Proyecto', run: ctx.open3D },
    ...studioActions(ctx),
    { id: 'app.palette', label: 'Buscar un comando', group: 'Proyecto', keys: 'Ctrl+K', match: combo('mod+k'), run: ctx.openPalette },
    { id: 'app.help', label: 'Ver atajos de teclado', group: 'Proyecto', keys: '?', match: combo('?'), run: ctx.openHelp },
  ]
}

function studioActions(ctx: ActionContext): EditorAction[] {
  const s = ctx.studio
  if (!s) return []
  if ('open' in s) return [{ id: 'view.studio', label: 'Abrir el estudio a pantalla completa', group: 'Vista', keys: 'F', match: combo('f'), run: s.open }]
  return [
    { id: 'view.fullscreen', label: 'Pantalla completa', group: 'Vista', keys: 'F', match: combo('f'), run: s.fullscreen },
    { id: 'view.exitStudio', label: 'Salir del estudio', group: 'Vista', run: s.exit },
  ]
}

/** Ejecuta la primera acción disponible que reconoce el evento. Devuelve si hubo alguna. */
export function runShortcut(actions: EditorAction[], e: KeyboardEvent): boolean {
  for (const a of actions) {
    if (!a.match?.(e)) continue
    if (a.enabled && !a.enabled()) continue
    e.preventDefault()
    a.run(e)
    return true
  }
  return false
}

export const isAvailable = (a: EditorAction) => !a.enabled || a.enabled()

/** Filtro de la paleta: por grupo y nombre, sin tildes; oculta lo no disponible ahora. */
export function filterActions(actions: EditorAction[], query: string): EditorAction[] {
  const q = normalize(query)
  return actions.filter((a) => !a.hidden && isAvailable(a) && (!q || normalize(`${a.group} ${a.label}`).includes(q)))
}

/** acciones que tienen sentido sobre lo seleccionado (menú contextual) */
export const CONTEXT_ACTIONS = ['edit.copy', 'edit.paste', 'edit.duplicate', 'edit.rotate', 'edit.delete', 'select.all', 'select.none']
