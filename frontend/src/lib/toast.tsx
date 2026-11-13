import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Icon } from '../components/icons'

type Tone = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  message: string
  tone: Tone
}

interface ToastValue {
  push: (message: string, tone?: Tone) => void
}

const ToastContext = createContext<ToastValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const push = useCallback(
    (message: string, tone: Tone = 'success') => {
      const id = Date.now() + Math.random()
      setItems((current) => [...current.slice(-2), { id, message, tone }])
      window.setTimeout(
        () => dismiss(id),
        tone === 'error' ? 6000 : 3200,
      )
    },
    [dismiss],
  )

  const value = useMemo(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
        aria-live="polite"
        aria-atomic="false"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role={item.tone === 'error' ? 'alert' : 'status'}
            className={`animate-fade-in pointer-events-auto flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm shadow-panel ${
              item.tone === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : item.tone === 'info'
                  ? 'border-sky-200 bg-sky-50 text-sky-800'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            <span className="min-w-0 flex-1">{item.message}</span>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-current/70 hover:text-current"
              aria-label="Dismiss notification"
              onClick={() => dismiss(item.id)}
            >
              <Icon name="x" className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
