import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { TutorialButton } from './TutorialButton'

beforeEach(() => localStorage.clear())

describe('botón de tutorial', () => {
  it('abre el video de la sección pedida y permite cambiar al otro', async () => {
    render(<TutorialButton initial="crear" />)
    await userEvent.click(screen.getByRole('button', { name: 'Ver tutorial' }))
    expect(screen.getByLabelText('Video: Crear desde cero')).toHaveAttribute('src', '/tutoriales/crear.webm')
    await userEvent.click(screen.getByRole('tab', { name: 'Editar un plano' }))
    expect(screen.getByLabelText('Video: Editar un plano')).toHaveAttribute('src', '/tutoriales/editar.webm')
  })

  it('la primera vez llama la atención; después de verlo, ya no', async () => {
    const { unmount } = render(<TutorialButton compact />)
    expect(screen.getByRole('button', { name: 'Ver tutorial' }).className).toContain('animate-pulse')
    await userEvent.click(screen.getByRole('button', { name: 'Ver tutorial' }))
    await userEvent.keyboard('{Escape}')
    unmount()
    render(<TutorialButton compact />)
    expect(screen.getByRole('button', { name: 'Ver tutorial' }).className).not.toContain('animate-pulse')
  })
})
