/** Lo último que se dijo en el chat, para que la IA entienda «esa alcoba» o «la nueva». */
export interface ChatTurn {
  from: 'user' | 'bot'
  text: string
  lines?: string[]
}

/** Las últimas `max` intervenciones como texto breve (cada una recortada a `width` caracteres). */
export function recentConversation(turns: readonly ChatTurn[], max = 6, width = 240): string {
  const rows = turns.slice(-max).map((t) => {
    const said = [t.text, ...(t.lines ?? [])].join(' · ').replace(/\s+/g, ' ').trim()
    const cut = said.length > width ? `${said.slice(0, width - 1)}…` : said
    return `${t.from === 'user' ? 'Persona' : 'Asistente'}: ${cut}`
  })
  return rows.length ? `Conversación reciente:\n${rows.join('\n')}` : ''
}
