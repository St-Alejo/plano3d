import { describe, expect, it } from 'vitest'
import { apiOrigin, wsOrigin } from './origin'

describe('origen de la API', () => {
  it('sin VITE_API_URL usa el mismo origen (proxy)', () => {
    expect(apiOrigin(undefined)).toBe('')
    expect(wsOrigin({ protocol: 'https:', host: 'demo.app' }, '')).toBe('wss://demo.app')
    expect(wsOrigin({ protocol: 'http:', host: 'localhost:5173' }, '')).toBe('ws://localhost:5173')
  })

  it('con VITE_API_URL va directo al backend, también el WebSocket', () => {
    expect(apiOrigin(' https://api.demo.io/ ')).toBe('https://api.demo.io')
    expect(wsOrigin({ protocol: 'https:', host: 'front.io' }, 'https://api.demo.io')).toBe('wss://api.demo.io')
    expect(wsOrigin({ protocol: 'http:', host: 'x' }, 'http://localhost:8000')).toBe('ws://localhost:8000')
  })
})
