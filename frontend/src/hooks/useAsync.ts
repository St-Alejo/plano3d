import { useCallback, useEffect, useState } from 'react'

export interface AsyncState<T> {
  data: T | undefined
  error: Error | undefined
  loading: boolean
  reload: () => void
  setData: (v: T) => void
}

interface Inner<T> {
  data?: T
  error?: Error
  loading: boolean
}

/** Carga de datos remota con estados explícitos (cargando / error / datos). */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<Inner<T>>({ loading: true })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    fn().then(
      (data) => alive && setState({ data, loading: false }),
      (e: unknown) =>
        alive && setState((s) => ({ ...s, error: e instanceof Error ? e : new Error(String(e)), loading: false })),
    )
    return () => {
      alive = false
    }
    // `fn` es un cierre nuevo en cada render: las dependencias reales las declara quien llama
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: undefined }))
    setNonce((n) => n + 1)
  }, [])

  const setData = useCallback((data: T) => setState({ data, loading: false }), [])

  return { data: state.data, error: state.error, loading: state.loading, reload, setData }
}
