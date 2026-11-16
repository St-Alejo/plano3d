/**
 * La app de escritorio se publica como instalador en los «Releases» de GitHub del repositorio
 * de la web. El enlace de descarga es estable (siempre la última versión) y los datos que se
 * muestran (versión, tamaño, SHA-256) salen de la API pública de GitHub.
 */

export const RELEASES_REPO = 'St-Alejo/plano3d-frontend'
export const INSTALLER = 'Plano3D-Setup.exe'
export const DOWNLOAD_URL = `https://github.com/${RELEASES_REPO}/releases/latest/download/${INSTALLER}`
export const RELEASES_URL = `https://github.com/${RELEASES_REPO}/releases/latest`
export const RELEASES_API = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`

export interface ReleaseInfo {
  version: string
  size: number
  published: string
  sha256: string | null
}

interface GithubAsset {
  name?: string
  size?: number
  digest?: string | null
}

interface GithubRelease {
  tag_name?: string
  published_at?: string
  body?: string | null
  assets?: GithubAsset[]
}

const SHA = /[a-f0-9]{64}/i

/** Lo que importa del release; null si no trae el instalador. */
export function parseRelease(json: unknown): ReleaseInfo | null {
  const r = (json ?? {}) as GithubRelease
  const asset = r.assets?.find((a) => a.name === INSTALLER)
  if (!asset || !r.tag_name) return null
  // GitHub calcula el resumen del archivo («sha256:…»); si no, se busca en las notas
  const fromDigest = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : null
  const fromBody = r.body?.match(new RegExp(`SHA-?256[^a-f0-9]*(${SHA.source})`, 'i'))?.[1] ?? null
  return {
    version: r.tag_name.replace(/^v/i, ''),
    size: asset.size ?? 0,
    published: r.published_at ?? '',
    sha256: (fromDigest ?? fromBody)?.toLowerCase() ?? null,
  }
}

/** «86,4 MB». */
export function formatSize(bytes: number): string {
  if (bytes <= 0) return ''
  const mb = bytes / (1024 * 1024)
  return `${mb.toLocaleString('es-CO', { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`
}

/** El enlace que abre la app instalada en un proyecto con una sesión prestada. */
export function deepLink(projectId: string, code: string): string {
  return `plano3d://open?project=${encodeURIComponent(projectId)}&code=${encodeURIComponent(code)}`
}

export async function fetchLatestRelease(signal?: AbortSignal): Promise<ReleaseInfo | null> {
  const res = await fetch(RELEASES_API, { signal, headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) return null
  return parseRelease(await res.json())
}
