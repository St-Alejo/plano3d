import { useEffect } from 'react'
import { DeleteOpening, DeleteWall, TranslateWall } from '@/domain/commands'
import { useEditor, type Tool } from '@/store/editorStore'

const TOOL_KEYS: Record<string, Tool> = { v: 'select', w: 'wall', d: 'door', n: 'window', c: 'calibrate' }

/** Atajos de teclado del editor. Se ignoran mientras se escribe en un campo. */
export function useEditorShortcuts(onSave?: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const s = useEditor.getState()
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
      } else if (mod && key === 'y') {
        e.preventDefault()
        s.redo()
      } else if (mod && key === 's') {
        e.preventDefault()
        onSave?.()
      } else if (!mod && !e.altKey && TOOL_KEYS[key]) {
        s.setTool(TOOL_KEYS[key])
      } else if (key.startsWith('arrow') && s.selection?.kind === 'wall') {
        // mover el muro seleccionado: 5 cm, o 25 cm con Shift
        e.preventDefault()
        const step = e.shiftKey ? 0.25 : 0.05
        const d = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[key]
        if (d) s.dispatch(new TranslateWall(s.levelId, s.selection.id, d[0]!, d[1]!))
      } else if (key === 'escape') {
        s.select(null)
        s.setTool('select')
      } else if ((key === 'delete' || key === 'backspace') && s.selection) {
        const sel = s.selection
        const cmd =
          sel.kind === 'wall'
            ? new DeleteWall(s.levelId, sel.id)
            : sel.kind === 'opening'
              ? new DeleteOpening(s.levelId, sel.wallId, sel.id)
              : null
        if (cmd && s.dispatch(cmd)) s.select(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onSave])
}
