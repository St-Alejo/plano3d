import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { PanelSection, ToolbarGroup } from './ui'

beforeEach(() => {
  localStorage.clear()
})

describe('PanelSection', () => {
  it('pliega y despliega su contenido con un botón con aria-expanded', async () => {
    render(
      <PanelSection title="Capas">
        <p>contenido</p>
      </PanelSection>,
    )
    const toggle = screen.getByRole('button', { name: 'Capas' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('contenido')).toBeVisible()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('contenido')).not.toBeVisible()
  })

  it('recuerda el estado con storageKey', async () => {
    const { unmount } = render(
      <PanelSection title="Catálogo" storageKey="catalogo">
        <p>piezas</p>
      </PanelSection>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Catálogo' }))
    unmount()
    render(
      <PanelSection title="Catálogo" storageKey="catalogo">
        <p>piezas</p>
      </PanelSection>,
    )
    expect(screen.getByRole('button', { name: 'Catálogo' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('empieza plegada con defaultOpen=false', () => {
    render(
      <PanelSection title="Materiales" defaultOpen={false}>
        <p>acabados</p>
      </PanelSection>,
    )
    expect(screen.getByText('acabados')).not.toBeVisible()
  })
})

describe('ToolbarGroup', () => {
  it('expone un grupo con nombre accesible', () => {
    render(
      <ToolbarGroup label="Dibujo">
        <button type="button">Muro</button>
      </ToolbarGroup>,
    )
    expect(screen.getByRole('group', { name: 'Dibujo' })).toContainElement(screen.getByRole('button', { name: 'Muro' }))
  })
})
