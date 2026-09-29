import type { BuildingModel, Project, ProgressEvent, ProjectSummary } from './types'

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

  getProject: (id: string) => request<Project>(`/projects/${encodeURIComponent(id)}`),

  createProject: (file: File, name: string, corners?: Corners, onProgress?: (fraction: number) => void) => {
    const form = new FormData()
    form.append('file', file)
    form.append('name', name)
    if (corners) form.append('corners', JSON.stringify(corners))
    if (onProgress) return uploadWithProgress<{ id: string; status: string }>('/projects', form, onProgress)
    return request<{ id: string; status: string }>('/projects', { method: 'POST', body: form })
  },

  saveModel: (id: string, model: BuildingModel) =>
    request<Project>(`/projects/${encodeURIComponent(id)}/model`, { method: 'PUT', ...json(model) }),

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
