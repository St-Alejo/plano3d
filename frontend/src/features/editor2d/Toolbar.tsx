import { Redo2, Undo2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton } from '@/components/ui'
import { useEditor } from '@/store/editorStore'
import { TOOLS } from './tools'


export function Toolbar({ trailing }: { trailing?: ReactNode }) {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const { canUndo, canRedo, undoLabel, redoLabel, undo, redo } = useEditor()

  return (
    <div className="flex items-center gap-1 border-b border-line bg-surface px-2 py-1.5" role="toolbar" aria-label="Herramientas del editor">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
      {TOOLS.map((t) => (
        <IconButton key={t.id} label={t.label} shortcut={t.key} active={tool === t.id} onClick={() => setTool(t.id)}>
          {t.icon}
        </IconButton>
      ))}
      <span className="mx-1 h-6 w-px bg-line" aria-hidden />
      <IconButton label={undoLabel ? `Deshacer: ${undoLabel}` : 'Deshacer'} shortcut="Ctrl+Z" disabled={!canUndo} onClick={undo}>
        <Undo2 className="size-5" aria-hidden />
      </IconButton>
      <IconButton label={redoLabel ? `Rehacer: ${redoLabel}` : 'Rehacer'} shortcut="Ctrl+Shift+Z" disabled={!canRedo} onClick={redo}>
        <Redo2 className="size-5" aria-hidden />
      </IconButton>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-l border-line pl-2 sm:border-0">{trailing}</div>
    </div>
  )
}
