import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import type { Point } from '@/api/types'
import { distance } from '@/domain/model'
import { Button, TextField } from '@/components/ui'

export function CalibrateDialog({
  line,
  onConfirm,
  onClose,
}: {
  line: { a: Point; b: Point } | null
  onConfirm: (meters: number) => void
  onClose: () => void
}) {
  const current = line ? distance(line.a, line.b) : 0

  return (
    <Dialog.Root open={line !== null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-canvas/70 backdrop-blur-sm" />
        <Dialog.Content className="corner-ticks fixed top-1/2 left-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 border border-line-strong bg-surface p-6">
          <Dialog.Title className="font-display text-lg font-semibold">Calibrar escala</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">
            La línea mide <b className="font-mono">{current.toFixed(2)} m</b> con la escala actual. ¿Cuánto mide en realidad?
          </Dialog.Description>
          <MetersForm key={current} initial={current} onConfirm={onConfirm} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function MetersForm({ initial, onConfirm }: { initial: number; onConfirm: (m: number) => void }) {
  const [value, setValue] = useState(initial ? initial.toFixed(2) : '')
  const meters = Number(value.replace(',', '.'))
  const valid = Number.isFinite(meters) && meters > 0
  return (
    <form
      className="mt-4 flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onConfirm(meters)
      }}
    >
      <TextField label="Medida real" suffix="m" inputMode="decimal" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Dialog.Close asChild>
          <Button variant="ghost">Cancelar</Button>
        </Dialog.Close>
        <Button type="submit" variant="primary" disabled={!valid}>
          Aplicar escala
        </Button>
      </div>
    </form>
  )
}
