import { useEffect, useState } from 'react'
import { fetchLatestRelease, type ReleaseInfo } from './release'

export type ReleaseState = { status: 'loading' } | { status: 'ready'; release: ReleaseInfo } | { status: 'none' }

/** El último instalador publicado (para mostrar versión, tamaño y SHA-256 junto al botón). */
export function useLatestRelease(): ReleaseState {
  const [state, setState] = useState<ReleaseState>({ status: 'loading' })
  useEffect(() => {
    const ctl = new AbortController()
    fetchLatestRelease(ctl.signal)
      .then((release) => setState(release ? { status: 'ready', release } : { status: 'none' }))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setState({ status: 'none' })
      })
    return () => ctl.abort()
  }, [])
  return state
}
