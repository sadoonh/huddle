import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './api'
import { setBusinessDate } from './format'
import type { Me } from './types'

interface AuthValue {
  me: Me | null
  mode: string
  loading: boolean
  error: string | null
  isManager: boolean
  refresh: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState('dev')
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    api
      .get<{ mode: string }>('/auth/config')
      .then((config) => setMode(config.mode))
      .catch(() => setMode('dev'))
  }, [])

  useEffect(() => {
    api
      .get<{ business_date: string }>('/meta')
      .then((meta) => setBusinessDate(meta.business_date))
      .catch(() => setBusinessDate(null))
  }, [])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    api
      .get<Me>('/me')
      .then((value) => {
        if (!alive) return
        setMe(value)
        setLoading(false)
      })
      .catch((caught: Error) => {
        if (!alive) return
        setMe(null)
        setError(caught.message)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [nonce, mode])

  const refresh = useCallback(() => setNonce((value) => value + 1), [])

  const value = useMemo<AuthValue>(
    () => ({
      me,
      mode,
      loading,
      error,
      isManager: Boolean(me?.is_manager || me?.role === 'admin'),
      refresh,
    }),
    [me, mode, loading, error, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
