import type { BuildingModel, CorrectionStats, Project, ProgressEvent, ProjectSummary, Revision, SolveResult, CaptureCheck } from './types'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, init)
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el servidor')
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
      else if (Array.isArray(body.detail)) detail = 'Datos inválidos'
    } catch {
      /* cuerpo sin JSON */
    }
    throw new ApiError(res.status, detail || `Error ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** `fetch` no informa el avance de la subida: para fotos grandes en redes lentas se usa XHR. */
function uploadWithProgress<T>(path: string, body: FormData, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}${path}`)
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

  quality: (id: string) => request<CorrectionStats>(`/projects/${encodeURIComponent(id)}/quality`),

  reanalyze: (id: string, corners?: Corners) =>
    request<{ id: string; status: string }>(`/projects/${encodeURIComponent(id)}/reanalyze`, {
      method: 'POST',
      ...json({ corners: corners ?? null }),
    }),

  deleteProject: (id: string) => request<void>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  progress: (id: string) => request<ProgressEvent[]>(`/projects/${encodeURIComponent(id)}/progress`),

  imageUrl: (id: string, kind: 'original' | 'rectified' = 'rectified', version?: string) =>
    `${BASE}/projects/${encodeURIComponent(id)}/image?kind=${kind}${version ? `&v=${encodeURIComponent(version)}` : ''}`,
}
