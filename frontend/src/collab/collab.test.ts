import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BuildingModel } from '@/api/types'
import { UpdateWall } from '@/domain/commands'
import { applyOps, type ModelOp } from '@/domain/ops'
import { selectIsDirty, useEditor } from '@/store/editorStore'
import { sampleModel } from '@/test/fixtures'
import { CollabClient, type CollabSocket } from './CollabClient'
import { CollabSession, type Transport, type TransportHandlers } from './CollabSession'
import { useCollab } from './collabStore'
import type { ClientMessage, PeerInfo } from './protocol'

const ME: PeerInfo = { id: 'peer_me', name: 'Steven', client: 'web' }
const DESK: PeerInfo = { id: 'peer_desk', name: 'Steven', client: 'desktop' }

function fakeTransport() {
  const sent: ClientMessage[] = []
  let handlers!: TransportHandlers
  const transport = (h: TransportHandlers): Transport => {
    handlers = h
    return { start: vi.fn(), stop: vi.fn(), send: (m) => (sent.push(m), true) }
  }
  return { transport, sent, get h() { return handlers } }
}

function wallOf(model: BuildingModel, id: string) {
  return model.levels[0]!.walls.find((w) => w.id === id)!
}

function putWall(model: BuildingModel, id: string, patch: Record<string, unknown>): ModelOp {
  return { t: 'put', k: 'wall', level: 'lvl_0', id, v: { ...wallOf(model, id), ...patch } as never }
}

function setup(model = sampleModel()) {
  useEditor.getState().load('prj_1', model, 4)
  const fake = fakeTransport()
  const session = new CollabSession('prj_1', { editor: useEditor, transport: fake.transport, presenceMs: 0 })
  session.start()
  const welcome = (extra: Partial<{ model: BuildingModel; seq: number; revision: number; peers: PeerInfo[] }> = {}) =>
    session.receive({ type: 'welcome', you: ME, seq: 0, revision: 4, peers: [], model, ...extra })
  return { session, fake, welcome, model }
}

const opsSent = (sent: ClientMessage[]) => sent.filter((m): m is Extract<ClientMessage, { type: 'ops' }> => m.type === 'ops')

afterEach(() => {
  useEditor.getState().reset()
  vi.useRealTimers()
})

describe('sesión de edición en vivo', () => {
  it('al entrar toma el modelo de la sala y queda guardado', () => {
    const base = sampleModel()
    const { welcome } = setup(base)
    const newer = applyOps(base, [putWall(base, 'w_top', { thickness: 0.3 })])
    welcome({ model: newer, revision: 7, seq: 3 })
    const st = useEditor.getState()
    expect(wallOf(st.model!, 'w_top').thickness).toBe(0.3)
    expect(st.revision).toBe(7)
    expect(selectIsDirty(st)).toBe(false)
    expect(st.canUndo).toBe(false) // lo remoto no entra al historial
  })

  it('un cambio local viaja como lote y la confirmación lo da por guardado', () => {
    const { fake, welcome } = setup()
    welcome()
    expect(useEditor.getState().dispatch(new UpdateWall('lvl_0', 'w_top', { thickness: 0.25 }))).toBe(true)
    const [batch] = opsSent(fake.sent)
    expect(batch).toBeDefined()
    expect(batch!.ops).toContainEqual(expect.objectContaining({ t: 'put', k: 'wall', id: 'w_top' }))
    expect(useCollab.getState().pending).toBe(1)
    expect(selectIsDirty(useEditor.getState())).toBe(true)

    const shown = useEditor.getState().model
    fake.h.onMessage({ type: 'applied', seq: 1, op_id: batch!.op_id, ops: batch!.ops, author: ME.id })
    expect(useCollab.getState().pending).toBe(0)
    expect(selectIsDirty(useEditor.getState())).toBe(false)
    expect(useEditor.getState().model).toBe(shown) // la confirmación propia no redibuja
    expect(useEditor.getState().canUndo).toBe(true)
  })

  it('el cambio de otra persona se ve sin tocar el deshacer y avisa de dónde vino', () => {
    const { fake, welcome, model } = setup()
    welcome({ peers: [DESK] })
    useEditor.getState().dispatch(new UpdateWall('lvl_0', 'w_left', { thickness: 0.2 }))
    const mine = opsSent(fake.sent)[0]!
    // el escritorio cambia otro muro antes de que llegue la confirmación propia
    fake.h.onMessage({ type: 'applied', seq: 1, op_id: 'desk-1', ops: [putWall(model, 'w_right', { thickness: 0.4 })], author: DESK.id })
    let m = useEditor.getState().model!
    expect(wallOf(m, 'w_right').thickness).toBe(0.4)
    expect(wallOf(m, 'w_left').thickness).toBe(0.2) // lo propio sigue encima (rebase)
    expect(useEditor.getState().canUndo).toBe(true)
    expect(useCollab.getState().notice).toMatchObject({ client: 'desktop' })
    // ninguna de esas aplicaciones remotas se reenvía al servidor
    expect(opsSent(fake.sent)).toHaveLength(1)

    fake.h.onMessage({ type: 'applied', seq: 2, op_id: mine.op_id, ops: mine.ops, author: ME.id })
    m = useEditor.getState().model!
    expect(wallOf(m, 'w_left').thickness).toBe(0.2)
    expect(wallOf(m, 'w_right').thickness).toBe(0.4)
  })

  it('si el servidor rechaza un lote, se vuelve a lo confirmado y se avisa', () => {
    const { fake, welcome } = setup()
    welcome()
    useEditor.getState().dispatch(new UpdateWall('lvl_0', 'w_top', { thickness: 0.33 }))
    const batch = opsSent(fake.sent)[0]!
    fake.h.onMessage({ type: 'reject', op_id: batch.op_id, reason: 'muro inválido' })
    const st = useEditor.getState()
    expect(wallOf(st.model!, 'w_top').thickness).not.toBe(0.33)
    expect(st.error).toMatch(/muro inválido/)
    expect(useCollab.getState().pending).toBe(0)
  })

  it('al reconectar aplica lo perdido y reenvía lo que no alcanzó a confirmarse', () => {
    const { fake, welcome, model } = setup()
    welcome({ seq: 2 })
    expect(fake.h.lastSeq()).toBe(2)
    useEditor.getState().dispatch(new UpdateWall('lvl_0', 'w_top', { thickness: 0.27 }))
    const lost = opsSent(fake.sent)[0]!
    fake.sent.length = 0
    // el servidor nunca recibió el lote propio; mientras tanto el escritorio movió otro muro
    fake.h.onMessage({
      type: 'welcome',
      you: ME,
      seq: 3,
      revision: 5,
      peers: [],
      missed: [{ seq: 3, op_id: 'desk-9', ops: [putWall(model, 'w_bottom', { thickness: 0.5 })], author: DESK.id }],
    })
    expect(opsSent(fake.sent).map((b) => b.op_id)).toContain(lost.op_id)
    const m = useEditor.getState().model!
    expect(wallOf(m, 'w_bottom').thickness).toBe(0.5)
    expect(wallOf(m, 'w_top').thickness).toBe(0.27)
  })

  it('una edición por REST llega entera y actualiza la revisión', () => {
    const { fake, welcome, model } = setup()
    welcome()
    const facade: BuildingModel = { ...model, facade: 'moderna_ladrillo' }
    fake.h.onMessage({ type: 'snapshot', seq: 4, revision: 9, model: facade })
    expect(useEditor.getState().model!.facade).toBe('moderna_ladrillo')
    expect(useEditor.getState().revision).toBe(9)
    fake.h.onMessage({ type: 'saved', revision: 10, seq: 4 })
    expect(useEditor.getState().revision).toBe(10)
  })

  it('lo editado antes de conectar se manda al entrar', () => {
    const { fake, welcome } = setup()
    useEditor.getState().dispatch(new UpdateWall('lvl_0', 'w_mid', { thickness: 0.22 }))
    expect(opsSent(fake.sent)).toHaveLength(0)
    welcome()
    const [batch] = opsSent(fake.sent)
    expect(batch?.ops).toContainEqual(expect.objectContaining({ id: 'w_mid' }))
    expect(wallOf(useEditor.getState().model!, 'w_mid').thickness).toBe(0.22)
  })

  it('cuenta su selección y guarda la presencia de los demás', async () => {
    const { fake, welcome } = setup()
    welcome({ peers: [DESK] })
    fake.h.onMessage({ type: 'presence', peer_id: DESK.id, state: { level: 'lvl_0', selection: 'w_top' } })
    expect(useCollab.getState().peers[DESK.id]?.presence?.selection).toBe('w_top')
    fake.sent.length = 0
    useEditor.getState().select({ kind: 'wall', id: 'w_left' })
    await new Promise((r) => setTimeout(r, 5))
    expect(fake.sent).toContainEqual({ type: 'presence', state: { level: 'lvl_0', selection: 'w_left', tool: 'select' } })
    fake.h.onMessage({ type: 'peer_left', peer_id: DESK.id })
    expect(useCollab.getState().peers[DESK.id]).toBeUndefined()
  })

  it('un render que sube el escritorio queda en la lista de llegados', () => {
    const { fake, welcome } = setup()
    welcome({ peers: [DESK] })
    const render = { id: 'p-1', label: 'Calle', camera: 'Calle', quality: 'final', hour: 'dia', media_type: 'image/jpeg', size_bytes: 9, width: 4, height: 3, created_at: '2026-11-16T00:00:00Z' }
    fake.h.onMessage({ type: 'render_added', render })
    expect(useCollab.getState().arrivedRenders).toEqual([render])
  })

  it('al cerrar se apaga todo', () => {
    const { session, fake, welcome } = setup()
    welcome()
    session.stop()
    expect(useCollab.getState().status).toBe('off')
    useEditor.getState().dispatch(new UpdateWall('lvl_0', 'w_top', { thickness: 0.21 }))
    expect(opsSent(fake.sent)).toHaveLength(0)
  })
})

class FakeSocket implements CollabSocket {
  static all: FakeSocket[] = []
  readyState = 0
  sent: string[] = []
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  onclose: ((ev: { code?: number }) => void) | null = null
  constructor(readonly url: string) {
    FakeSocket.all.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.({})
  }
  drop(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

describe('transporte WebSocket', () => {
  beforeEach(() => {
    FakeSocket.all = []
    vi.useFakeTimers()
  })

  const make = (seq: number | null = null) => {
    const statuses: string[] = []
    const client = new CollabClient('prj 1', {
      socket: (url) => new FakeSocket(url),
      ticket: async () => 'tk',
      lastSeq: () => seq,
      onMessage: vi.fn(),
      onStatus: (s) => statuses.push(s),
      pingMs: 1000,
      backoff: { min: 100, max: 400 },
    })
    return { client, statuses }
  }

  it('entra con ticket, saluda con el último seq y hace ping', async () => {
    const { client, statuses } = make(7)
    client.start()
    await vi.runOnlyPendingTimersAsync()
    const s = FakeSocket.all[0]!
    expect(s.url).toMatch(/\/api\/ws\/collab\/prj%201\?ticket=tk$/)
    s.open()
    expect(JSON.parse(s.sent[0]!)).toEqual({ type: 'hello', client: 'web', last_seq: 7 })
    s.onmessage?.({ data: JSON.stringify({ type: 'welcome', you: ME, seq: 7, revision: 1, peers: [] }) })
    expect(statuses.at(-1)).toBe('live')
    await vi.advanceTimersByTimeAsync(1000)
    expect(s.sent.map((d) => JSON.parse(d).type)).toContain('ping')
    expect(client.send({ type: 'ping' })).toBe(true)
    client.stop()
    expect(client.send({ type: 'ping' })).toBe(false)
  })

  it('si se cae reintenta, y si no tiene permiso deja de intentar', async () => {
    const { client, statuses } = make()
    client.start()
    await vi.runOnlyPendingTimersAsync()
    FakeSocket.all[0]!.open()
    FakeSocket.all[0]!.drop()
    expect(statuses.at(-1)).toBe('offline')
    await vi.advanceTimersByTimeAsync(500)
    expect(FakeSocket.all).toHaveLength(2)
    FakeSocket.all[1]!.drop(4401)
    expect(statuses.at(-1)).toBe('closed')
    await vi.advanceTimersByTimeAsync(5000)
    expect(FakeSocket.all).toHaveLength(2)
  })
})
