import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Icon, type IconName } from '../components/icons'

type Tone = 'success' | 'error' | 'info'

export interface ToastAction {
  label: string
  onClick: () => void | Promise<void>
}

export interface ToastOptions {
  /** One compact action (Undo, View task…). Performs a real mutation when needed. */
  action?: ToastAction
  /** Milliseconds before auto-dismiss. Paused while hovered or focused. */
  duration?: number
}

interface ToastItem {
  id: number
  message: string
  tone: Tone
  action?: ToastAction
  duration: number
}

interface ToastValue {
  push: (message: string, tone?: Tone, options?: ToastOptions) => void
}

const ToastContext = createContext<ToastValue | null>(null)

const toneStyles: Record<Tone, { surface: string; icon: IconName; iconClass: string }> = {
  success: { surface: 'border-hairline', icon: 'check', iconClass: 'bg-success-tint text-accent' },
  error: { surface: 'border-danger/30', icon: 'alert', iconClass: 'bg-danger-tint text-danger' },
  info: { surface: 'border-hairline', icon: 'message', iconClass: 'bg-recessed text-ink-muted' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const push = useCallback((message: string, tone: Tone = 'success', options: ToastOptions = {}) => {
    const id = Date.now() + Math.random()
    const duration = options.duration ?? (tone === 'error' ? 6500 : options.action ? 8000 : 3600)
    setItems((current) => [
      ...current.slice(-2),
      { id, message, tone, action: options.action, duration },
    ])
  }, [])

  const value = useMemo(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-96"
        aria-live="polite"
        aria-atomic="false"
      >
        {items.map((item) => (
          <ToastRow key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastRow({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }): ReactNode {
  const [paused, setPaused] = useState(false)
  const [running, setRunning] = useState(false)
  const remaining = useRef(item.duration)
  const startedAt = useRef(0)

  useEffect(() => {
    if (paused) return
    startedAt.current = Date.now()
    const timer = window.setTimeout(onDismiss, remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current = Math.max(remaining.current - (Date.now() - startedAt.current), 0)
    }
  }, [paused, onDismiss])

  const style = toneStyles[item.tone]

  async function runAction() {
    if (!item.action || running) return
    setRunning(true)
    try {
      await item.action.onClick()
    } catch {
      /* the action reports its own failure (a real server result) */
    } finally {
      setRunning(false)
      onDismiss()
    }
  }

  return (
    <div
      role={item.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className={`animate-toast-in pointer-events-auto flex w-full items-start gap-2.5 rounded-control border bg-elevated px-3 py-2.5 text-sm text-ink shadow-floating ${style.surface}`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${style.iconClass}`}
      >
        <Icon name={style.icon} className="h-3 w-3" strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1 pt-0.5">{item.message}</span>
      {item.action && (
        <button
          type="button"
          className="shrink-0 rounded-md px-2 py-1 text-sm font-semibold text-accent transition-colors duration-140 hover:bg-accent-tint disabled:opacity-60"
          onClick={runAction}
          disabled={running}
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        className="shrink-0 rounded p-1 text-ink-subtle transition-colors duration-140 hover:bg-recessed hover:text-ink"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        <Icon name="x" className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function useToast(): ToastValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
