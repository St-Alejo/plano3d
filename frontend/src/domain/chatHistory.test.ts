import { describe, expect, it } from 'vitest'
import { recentConversation } from './chatHistory'

describe('recentConversation', () => {
  it('vacía si aún no se ha hablado', () => {
    expect(recentConversation([])).toBe('')
  })

  it('las últimas intervenciones, con quién habló y lo que se aplicó', () => {
    const out = recentConversation([
      { from: 'user', text: 'agrega una alcoba de 3 por 3' },
      { from: 'bot', text: 'Hecho.', lines: ['Dibujé Alcoba 4 de 3 × 3 m'] },
    ])
    expect(out).toBe('Conversación reciente:\nPersona: agrega una alcoba de 3 por 3\nAsistente: Hecho. · Dibujé Alcoba 4 de 3 × 3 m')
  })

  it('solo las últimas `max` y cada una recortada', () => {
    const turns = Array.from({ length: 10 }, (_, i) => ({ from: 'user' as const, text: `m${i} ${'x'.repeat(300)}` }))
    const rows = recentConversation(turns, 3, 20).split('\n').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatch(/^Persona: m7 x+…$/)
    expect(rows[0]!.length).toBeLessThanOrEqual('Persona: '.length + 20)
  })
})
