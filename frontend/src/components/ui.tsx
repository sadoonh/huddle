import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './icons'
import { formatDate, formatDueDate, humanize, initials, todayISOValue } from '../lib/format'
import type { Priority, SessionStatus, TaskStatus } from '../lib/types'

export function Spinner({ className = 'h-4 w-4' }: { className?: string }): ReactNode {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }): ReactNode {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <Spinner /> {label}
    </div>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }): ReactNode {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <div className="flex items-center gap-2 font-medium">
        <Icon name="alert" className="h-4 w-4" /> Something went wrong
      </div>
      <p className="text-rose-700">{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          <Icon name="refresh" /> Try again
        </button>
      )}
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}): ReactNode {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

const badgeTones: Record<Priority | TaskStatus | SessionStatus | 'neutral', string> = {
  urgent: 'badge-rose',
  high: 'badge-amber',
  medium: 'badge-sky',
  low: 'badge-slate',
  backlog: 'badge-slate',
  todo: 'badge-sky',
  in_progress: 'badge-indigo',
  done: 'badge-emerald',
  canceled: 'badge-slate',
  draft: 'badge-slate',
  completed: 'badge-emerald',
  neutral: 'badge-slate',
}

export function StatusBadge({ status }: { status: TaskStatus }): ReactNode {
  return (
    <span className={`badge ${badgeTones[status]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {humanize(status)}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: Priority }): ReactNode {
  return <span className={`badge ${badgeTones[priority]}`}>{humanize(priority)}</span>
}

export function SessionStatusBadge({ status }: { status: SessionStatus }): ReactNode {
  const label = status === 'in_progress' ? 'Live' : humanize(status)
  return <span className={`badge ${badgeTones[status]}`}>{label}</span>
}

export function DueDate({ date, overdue }: { date: string | null; overdue: boolean }): ReactNode {
  if (!date) return <span className="text-xs text-slate-400">No due date</span>
  // Closed tasks keep their historical due date rather than reading "overdue".
  const label = !overdue && date.slice(0, 10) < todayISOValue() ? formatDate(date) : formatDueDate(date)
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${
        overdue ? 'font-semibold text-rose-600' : 'text-slate-500'
      }`}
      title={formatDate(date)}
    >
      <Icon name="calendar" className="h-3.5 w-3.5" />
      {label}
    </span>
  )
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }): ReactNode {
  const sizes = {
    sm: 'h-6 w-6 text-[10px]',
    md: 'h-8 w-8 text-xs',
    lg: 'h-10 w-10 text-sm',
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-900 font-semibold text-white ${sizes[size]}`}
      title={name}
    >
      {initials(name)}
    </span>
  )
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

const overlayStack: string[] = []
let previousBodyOverflow: string | null = null

function lockPage(): void {
  if (overlayStack.length > 0) return
  previousBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  const root = document.getElementById('root')
  if (root) {
    root.setAttribute('inert', '')
    root.setAttribute('aria-hidden', 'true')
  }
}

function unlockPage(): void {
  if (overlayStack.length > 0) return
  document.body.style.overflow = previousBodyOverflow ?? ''
  previousBodyOverflow = null
  const root = document.getElementById('root')
  if (root) {
    root.removeAttribute('inert')
    root.removeAttribute('aria-hidden')
  }
}

function useOverlayBehavior(open: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const id = useId()
  const titleId = `${id}-title`
  const descriptionId = `${id}-description`

  useEffect(() => {
    if (!open) return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const stackId = `${id}-${Date.now()}-${Math.random()}`
    overlayStack.push(stackId)
    lockPage()

    const focusFirst = () => {
      const panel = panelRef.current
      if (!panel) return
      const first = panel.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? panel).focus()
    }
    const timer = window.setTimeout(focusFirst, 0)

    const handleKey = (event: KeyboardEvent) => {
      if (overlayStack[overlayStack.length - 1] !== stackId) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => !element.hasAttribute('disabled') && element.offsetParent !== null,
      )
      if (focusable.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKey, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', handleKey, true)
      const index = overlayStack.indexOf(stackId)
      if (index !== -1) overlayStack.splice(index, 1)
      unlockPage()
      if (trigger?.isConnected) trigger.focus()
    }
  }, [open, id])

  return { panelRef, titleId, descriptionId }
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}): ReactNode {
  const { panelRef, titleId, descriptionId } = useOverlayBehavior(open, onClose)
  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-950/40 p-3 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={`animate-fade-in my-0 flex max-h-[calc(100dvh-1.5rem)] w-full flex-col rounded-xl border border-slate-200 bg-white shadow-2xl sm:my-8 sm:max-h-[calc(100dvh-2rem)] ${
          wide ? 'max-w-3xl' : 'max-w-lg'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-slate-900">{title}</h2>
            {description && <p id={descriptionId} className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
}: {
  icon?: IconName
  title: string
  description?: string
  action?: ReactNode
}): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-12 text-center">
      <span className="rounded-full bg-white p-2.5 text-slate-400 shadow-sm">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {description && <p className="max-w-md text-xs leading-relaxed text-slate-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }): ReactNode {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold ${tone ?? 'text-slate-900'}`}>{value}</p>
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}): ReactNode {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors ${
          checked ? 'bg-emerald-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
      {label}
    </label>
  )
}


export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
}): ReactNode {
  const { panelRef, titleId, descriptionId } = useOverlayBehavior(open, onClose)
  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/30 backdrop-blur-[1px]">
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default"
        aria-label="Close panel"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        className="animate-fade-in relative flex h-[100dvh] w-full flex-col border-l border-slate-200 bg-white shadow-2xl sm:h-full sm:max-w-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-slate-900">{title}</h2>
            {description && <p id={descriptionId} className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-5 py-3">
            {footer}
          </div>
        )}
      </aside>
    </div>,
    document.body,
  )
}
