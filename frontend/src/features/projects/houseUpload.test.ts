import { describe, expect, it, vi } from 'vitest'
import { orderFloors } from '@/domain/houseFloors'
import { uploadHouse, type HouseStep } from './houseUpload'

const file = (name: string) => new File(['x'], name, { type: 'image/png' })

describe('uploadHouse', () => {
  it('crea con el primer piso, espera a que esté listo y apila los demás en orden', async () => {
    const statuses = ['processing', 'processing', 'ready']
    const calls: string[] = []
    const deps = {
      createProject: vi.fn(async (f: File, n: string) => (calls.push(`create ${f.name} ${n}`), { id: 'p1' })),
      getProject: vi.fn(async () => ({ status: statuses.shift() ?? 'ready', revision: 1 })),
      addLevel: vi.fn(async (_id: string, f: File, n: string, rev: number) => {
        calls.push(`add ${f.name} ${n} r${rev}`)
        return { status: 'ready', revision: rev + 1 }
      }),
      sleep: async () => {},
    }
    const steps: HouseStep[] = []
    const floors = orderFloors([file('piso-3.png'), file('piso-1.png'), file('piso-2.png')])
    const id = await uploadHouse(deps, floors, 'Casa', (s) => steps.push(s))
    expect(id).toBe('p1')
    expect(calls).toEqual(['create piso-1.png Casa', 'add piso-2.png Piso 2 r1', 'add piso-3.png Piso 3 r2'])
    expect(deps.getProject).toHaveBeenCalledTimes(3)
    expect(steps.filter((s) => s.kind === 'done').map((s) => s.floor)).toEqual(['Piso 1', 'Piso 2', 'Piso 3'])
  })

  it('si el primer plano falla, avisa con el motivo y no sube los otros', async () => {
    const deps = {
      createProject: async () => ({ id: 'p1' }),
      getProject: async () => ({ status: 'failed', revision: 0, error: 'No se encontró ningún muro' }),
      addLevel: vi.fn(),
      sleep: async () => {},
    }
    await expect(uploadHouse(deps, orderFloors([file('piso-1.png'), file('piso-2.png')]), 'Casa')).rejects.toThrow(/ningún muro/)
    expect(deps.addLevel).not.toHaveBeenCalled()
  })

  it('sin planos no hace nada', async () => {
    const deps = { createProject: vi.fn(), getProject: vi.fn(), addLevel: vi.fn() }
    await expect(uploadHouse(deps, [], 'Casa')).rejects.toThrow(/al menos un plano/)
    expect(deps.createProject).not.toHaveBeenCalled()
  })
})
