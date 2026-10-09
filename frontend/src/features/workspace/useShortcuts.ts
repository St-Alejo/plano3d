import { useEffect } from 'react'
import { runShortcut, type EditorAction } from './actions'

/** Atajos de teclado del editor, tomados del registro de acciones. Mientras se escribe en un campo solo vale Ctrl+S. */
export function useEditorShortcuts(actions: EditorAction[]): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      // mientras se escribe solo vale Guardar (Ctrl+S): lo demás son letras del texto
      if (typing && !((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's')) return
      // con un diálogo abierto (paleta, ayuda, historial) los atajos del lienzo no aplican
      if (document.querySelector('[role="dialog"]')) return
      runShortcut(actions, e)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [actions])
}
