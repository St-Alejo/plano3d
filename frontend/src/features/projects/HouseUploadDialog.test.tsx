import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderWithRouter } from '@/test/render'
import { HouseUpload } from './HouseUploadDialog'

const png = (name: string) => new File(['x'], name, { type: 'image/png' })

describe('HouseUpload', () => {
  it('ordena los planos por su nombre y deja corregir el orden con las flechas', async () => {
    renderWithRouter(<HouseUpload />)
    await userEvent.click(screen.getByRole('button', { name: /Casa por pisos/ }))
    await userEvent.upload(screen.getByLabelText('Planos de los pisos'), [png('piso-3.png'), png('piso-1.png'), png('piso-2.png')])
    const list = screen.getByRole('list', { name: /Pisos/ })
    const rows = () => within(list).getAllByRole('listitem').map((li) => li.textContent)
    expect(rows()).toEqual([expect.stringMatching(/Piso 1.*piso-1/), expect.stringMatching(/Piso 2.*piso-2/), expect.stringMatching(/Piso 3.*piso-3/)])
    await userEvent.click(screen.getByRole('button', { name: 'Subir Piso 1' }))
    expect(rows()[0]).toMatch(/Piso 1.*piso-2/)
    expect(screen.getByRole('button', { name: 'Crear casa de 3 pisos' })).toBeEnabled()
  })
})
