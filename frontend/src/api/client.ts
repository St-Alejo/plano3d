import { apiOrigin } from './origin'
import { tokens, type Session } from './tokens'
import type { components } from './schema'
import type { Photos, PhotosStatus, AssistantReply, BuildingModel, CorrectionStats, Project, ProgressEvent, ProjectSummary, Revision, SolveResult, CaptureCheck, FacadeCustom } from './types'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const BASE = `${apiOrigin()}/api`

export type AuthConfig = components['schemas']['AuthConfigDTO']
export type LinkCode = components['schemas']['LinkCodeDTO']

/** Rutas que reciben credenciales: un 401 ahí es la respuesta, no un token vencido. */
const NO_RETRY = new Set(['/auth/login', '/auth/register', '/auth/demo', '/auth/refresh', '/auth/link-codes/exchange'])

let refreshing: Promise<boolean> | null = null

/**
 * Renueva la sesión con el token de refresco (una sola vez aunque fallen varias peticiones
 * a la vez). Devuelve si quedó con sesión. Un refresco rechazado cierra la sesión local.
 */
export function refreshSession(): Promise<boolean> {
  const refresh = tokens.refresh()
  if (!refresh) return Promise.resolve(false)
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      })
      if (!res.ok) {
        if (res.status === 401) tokens.clear()
        return false
      }
      tokens.set((await res.json()) as Session)
      return true
    } catch {
      return false // sin red: se conserva el token para intentarlo después
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

function withAuth(init?: RequestInit): RequestInit | undefined {
  const access = tokens.access()
  if (!access) return init
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${access}`)
  return { ...init, headers }
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, withAuth(init))
    if (res.status === 401 && !NO_RETRY.has(path) && (await refreshSession())) {
      res = await fetch(`${BASE}${path}`, withAuth(init))
    }
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el servidor')
  }
  if (!res.ok) throw await toError(res)
  return res
}

async function toError(res: Response): Promise<ApiError> {
  let detail = res.statusText
  try {
    const body = (await res.json()) as { detail?: unknown }
    if (typeof body.detail === 'string') detail = body.detail
    else if (Array.isArray(body.detail)) detail = 'Datos inválidos'
  } catch {
    /* cuerpo sin JSON */
  }
  return new ApiError(res.status, detail || `Error ${res.status}`)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await send(path, init)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** `fetch` no informa el avance de la subida: para fotos grandes en redes lentas se usa XHR. */
async function uploadWithProgress<T>(path: string, body: FormData, onProgress: (fraction: number) => void): Promise<T> {
  // XHR no reintenta: se asegura antes un token de acceso vigente
  if (!tokens.access()) await refreshSession()
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}${path}`)
    const access = tokens.access()
    if (access) xhr.setRequestHeader('Authorization', `Bearer ${access}`)
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      const data = xhr.response as { detail?: unknown } | null
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1)
        resolve(data as T)
      } else {
        const detail = data && typeof data.detail === 'string' ? data.detail : `Error ${xhr.status}`
        reject(new ApiError(xhr.status, detail))
      }
    }
    xhr.onerror = () => reject(new ApiError(0, 'No se pudo conectar con el servidor'))
    xhr.send(body)
  })
}

const json = (body: unknown): RequestInit => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

/** Esquinas normalizadas 0..1 en orden TL, TR, BR, BL. */
export type Corners = [number, number][]

export const api = {
  auth: {
    config: () => request<AuthConfig>('/auth/config'),
    login: (email: string, password: string) => request<Session>('/auth/login', { method: 'POST', ...json({ email, password }) }),
    register: (email: string, name: string, password: string) =>
      request<Session>('/auth/register', { method: 'POST', ...json({ email, name, password }) }),
    /** La cuenta demo (con la casa de 3 pisos), sin contraseña. */
    demo: () => request<Session>('/auth/demo', { method: 'POST' }),
    /** Deja la casa demo como nueva (solo desde la cuenta demo). */
    resetDemo: () => request<void>('/auth/demo/reset', { method: 'POST' }),
    /** Cierra la sesión en todos los dispositivos (web y escritorio). */
    logout: () => request<void>('/auth/logout', { method: 'POST' }),
    /** Código de un solo uso (2 min) para abrir la sesión en la app de escritorio. */
    linkCode: () => request<LinkCode>('/auth/link-codes', { method: 'POST' }),
    /** Ticket de 60 s para un WebSocket (el navegador no le pone cabeceras). */
    wsTicket: () => request<{ ticket: string; expires_in: number }>('/auth/ws-ticket', { method: 'POST' }),
  },

  listProjects: () => request<ProjectSummary[]>('/projects'),

  suggestCorners: async (file: File): Promise<Corners | null> => {
    const form = new FormData()
    form.append('file', file)
    const res = await request<{ corners: Corners | null }>('/corners', { method: 'POST', body: form })
    return res.corners
  },

  /** ¿La foto sirve? (movida, reflejo, resolución) — antes de subir. */
  checkCapture: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<CaptureCheck>('/capture/check', { method: 'POST', body: form })
  },

  getProject: (id: string) => request<Project>(`/projects/${encodeURIComponent(id)}`),

  createProject: (
    file: File,
    name: string,
    corners?: Corners,
    onProgress?: (fraction: number) => void,
    extra: File[] = [],
  ) => {
    const form = new FormData()
    form.append('file', file)
    form.append('name', name)
    if (corners) form.append('corners', JSON.stringify(corners))
    // más fotos de la misma hoja (plano grande por partes): el servidor las une
    for (const f of extra) form.append('extra', f)
    if (onProgress) return uploadWithProgress<{ id: string; status: string }>('/projects', form, onProgress)
    return request<{ id: string; status: string }>('/projects', { method: 'POST', body: form })
  },

  /** Chat del editor: lo que el intérprete local no entendió lo interpreta la IA (503 si no hay). */
  /** `scope`: 'plan' edita el plano (chat del editor); 'viewer' ajusta la vista 3D */
  /** ¿Hay fotos con IA en este servidor y cuánto presupuesto queda? */
  photosStatus: () => request<PhotosStatus>('/photos/status'),

  /** Fotos realistas desde capturas del modelo 3D (una por vista). Tarda ~15 s. */
  generatePhotos: (id: string, shots: { view: string; image: Blob }[], facade: string) => {
    const form = new FormData()
    for (const s of shots) form.append('images', s.image, `${s.view}.jpg`)
    form.append('views', shots.map((s) => s.view).join(','))
    form.append('facade', facade)
    return request<Photos>(`/projects/${encodeURIComponent(id)}/photos`, { method: 'POST', body: form })
  },

  assistant: (id: string, message: string, context: string, scope: 'plan' | 'viewer' = 'plan') =>
    request<AssistantReply>(`/projects/${encodeURIComponent(id)}/assistant`, { method: 'POST', ...json({ message, context, scope }) }),

  /** Plano desde cero: sin foto, listo para dibujar. */
  createBlankProject: (name: string) => request<Project>('/projects/blank', { method: 'POST', ...json({ name }) }),

  /**
   * Guarda con bloqueo optimista: `revision` es la versión sobre la que se editó.
   * Si otra persona guardó antes responde 409 (ApiError.status === 409).
   * `revision: '*'` fuerza el guardado (sobrescribe).
   */
  saveModel: (id: string, model: BuildingModel, revision?: number | '*', summary?: string) => {
    const init = json(model)
    const headers = { ...(init.headers as Record<string, string>) }
    if (revision !== undefined) headers['If-Match'] = revision === '*' ? '*' : `"${revision}"`
    const q = summary ? `?summary=${encodeURIComponent(summary)}` : ''
    return request<Project>(`/projects/${encodeURIComponent(id)}/model${q}`, { method: 'PUT', ...init, headers })
  },

  listRevisions: (id: string) => request<Revision[]>(`/projects/${encodeURIComponent(id)}/revisions`),

  restoreRevision: (id: string, number: number, revision?: number) =>
    request<Project>(`/projects/${encodeURIComponent(id)}/revisions/${number}/restore`, {
      method: 'POST',
      headers: revision !== undefined ? { 'If-Match': `"${revision}"` } : {},
    }),

  /** Ajusta los muros a las cotas del plano (las medidas escritas mandan). */
  solve: (id: string, revision?: number) =>
    request<SolveResult>(`/projects/${encodeURIComponent(id)}/solve`, {
      method: 'POST',
      headers: revision !== undefined ? { 'If-Match': `"${revision}"` } : {},
    }),

  /** Otro plano del mismo edificio como un piso más, encima del último (alineado por columnas). */
  addLevel: (id: string, file: File, name?: string, revision?: number) => {
    const form = new FormData()
    form.append('file', file)
    if (name) form.append('name', name)
    return request<Project>(`/projects/${encodeURIComponent(id)}/levels`, {
      method: 'POST',
      body: form,
      headers: revision !== undefined ? { 'If-Match': `"${revision}"` } : {},
    })
  },

  /** Copia de un piso encima del último (un piso tipo igual a otro). */
  duplicateLevel: (id: string, levelId: string, name?: string, revision?: number) => {
    const init = json({ name: name ?? null })
    const headers = { ...(init.headers as Record<string, string>) }
    if (revision !== undefined) headers['If-Match'] = `"${revision}"`
    return request<Project>(`/projects/${encodeURIComponent(id)}/levels/${encodeURIComponent(levelId)}/duplicate`, {
      method: 'POST',
      ...init,
      headers,
    })
  },

  /** Estilo de fachada: solo cambia el exterior; el plano queda igual. */
  setFacade: (id: string, style: string, revision?: number, custom?: FacadeCustom | null) => {
    const init = json({ style, custom: custom ?? null })
    const headers = { ...(init.headers as Record<string, string>) }
    if (revision !== undefined) headers['If-Match'] = `"${revision}"`
    return request<Project>(`/projects/${encodeURIComponent(id)}/facade`, { method: 'PUT', ...init, headers })
  },

  /** Completa los muebles que faltan (de un piso o de todos) según cada ambiente. */
  furnish: (id: string, levelId?: string, revision?: number) => {
    const init = json({ level_id: levelId ?? null })
    const headers = { ...(init.headers as Record<string, string>) }
    if (revision !== undefined) headers['If-Match'] = `"${revision}"`
    return request<Project>(`/projects/${encodeURIComponent(id)}/furnish`, { method: 'POST', ...init, headers })
  },

  quality: (id: string) => request<CorrectionStats>(`/projects/${encodeURIComponent(id)}/quality`),

  reanalyze: (id: string, corners?: Corners) =>
    request<{ id: string; status: string }>(`/projects/${encodeURIComponent(id)}/reanalyze`, {
      method: 'POST',
      ...json({ corners: corners ?? null }),
    }),

  deleteProject: (id: string) => request<void>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  progress: (id: string) => request<ProgressEvent[]>(`/projects/${encodeURIComponent(id)}/progress`),

  imagePath: (id: string, kind: 'original' | 'rectified' = 'rectified', version?: string) =>
    `/projects/${encodeURIComponent(id)}/image?kind=${kind}${version ? `&v=${encodeURIComponent(version)}` : ''}`,

  /** La imagen del plano con la sesión (un `<img src>` no puede mandar el token). */
  imageBlob: async (id: string, kind: 'original' | 'rectified' = 'rectified', version?: string): Promise<Blob> =>
    (await send(api.imagePath(id, kind, version))).blob(),
}
