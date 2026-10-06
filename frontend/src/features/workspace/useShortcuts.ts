import { useEffect } from 'react'
import { runShortcut, type EditorAction } from './actions'

/** Atajos de teclado del editor, tomados del registro de acciones. Se ignoran mientras se escribe en un campo. */
export function useEditorShortcuts(actions: EditorAction[]): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      // con un diálogo abierto (paleta, ayuda, historial) los atajos del lienzo no aplican
      if (document.querySelector('[role="dialog"]')) return
      runShortcut(actions, e)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [actions])
}
