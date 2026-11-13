import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data: T | undefined
  loading: boolean
  error: string | null
  refresh: () => void
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Small fetch-on-mount hook. `deps` controls refetching; `refresh` forces one.
 * The loader is kept in a ref so callers don't need to memoize it.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: string | null }>({
    data: undefined,
    loading: true,
    error: null,
  })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    setState((previous) => ({ ...previous, loading: true, error: null }))
    loaderRef
      .current()
      .then((data) => {
        if (alive) setState({ data, loading: false, error: null })
      })
      .catch((error) => {
        if (alive) setState({ data: undefined, loading: false, error: errorMessage(error) })
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const refresh = useCallback(() => setNonce((value) => value + 1), [])
  return { ...state, refresh }
}

export function useAction(): {
  busy: boolean
  error: string | null
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>
  reset: () => void
} {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true)
    setError(null)
    try {
      return await fn()
    } catch (caught) {
      setError(errorMessage(caught))
      return undefined
    } finally {
      setBusy(false)
    }
  }, [])

  return { busy, error, run, reset: () => setError(null) }
}
