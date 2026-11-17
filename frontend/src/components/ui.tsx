import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './icons'
import { humanize, initials } from '../lib/format'
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
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-muted">
      <Spinner /> {label}
    </div>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }): ReactNode {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-danger/30 bg-danger-tint px-4 py-3 text-sm text-danger">
      <div className="flex items-center gap-2 font-medium">
        <Icon name="alert" className="h-4 w-4" /> Something went wrong
      </div>
      <p className="text-danger">{message}</p>
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
        <h1 className="font-heading text-2xl font-extrabold tracking-[-0.025em] text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
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

const avatarTones = [
  'bg-[#3c6e58]',
  'bg-[#5b7287]',
  'bg-[#7a6752]',
  'bg-[#62618a]',
  'bg-[#4f7369]',
  'bg-[#8a5f52]',
]

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }): ReactNode {
  const sizes = {
    sm: 'h-6 w-6 text-[10px]',
    md: 'h-8 w-8 text-xs',
    lg: 'h-10 w-10 text-sm',
  }
  const tone = avatarTones[
    Array.from(name).reduce((total, character) => total + character.charCodeAt(0), 0) % avatarTones.length
  ]
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-1 ring-inset ring-black/5 ${tone} ${sizes[size]}`}
      title={name}
      aria-hidden="true"
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
      const visible = (element: HTMLElement) =>
        element.offsetParent !== null && !element.hasAttribute('disabled')
      // Prefer an explicit autofocus target, then the first real form field,
      // then any focusable element. This keeps the caret in the field a form
      // is about (e.g. Title / Add update) instead of the header Close button.
      const explicit = Array.from(
        panel.querySelectorAll<HTMLElement>('[data-autofocus], [autofocus]'),
      ).find(visible)
      const field = Array.from(
        panel.querySelectorAll<HTMLElement>('input:not([type="hidden"]), textarea, select'),
      ).find(visible)
      const first = explicit ?? field ?? panel.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? panel).focus()
    }
    const timer = window.setTimeout(focusFirst, 0)

    const handleKey = (event: KeyboardEvent) => {
      if (overlayStack[overlayStack.length - 1] !== stackId) return
      if (event.key === 'Escape') {
        // An open picker/menu owns Escape first; a second press closes the overlay.
        if (document.body.hasAttribute('data-popover-open')) return
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
  const hasBody = children !== null && children !== undefined && children !== false

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-overlay/40 p-3 backdrop-blur-[3px] sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={`animate-pop-in my-0 flex max-h-[calc(100dvh-1.5rem)] w-full flex-col rounded-sheet border border-hairline bg-elevated shadow-floating sm:my-8 sm:max-h-[calc(100dvh-2rem)] ${
          wide ? 'max-w-3xl' : 'max-w-lg'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className={`flex items-start justify-between gap-3 px-5 py-3.5 ${hasBody ? 'border-b border-hairline' : ''}`}>
          <div>
            <h2 id={titleId} className="text-base font-semibold text-ink">{title}</h2>
            {description && <p id={descriptionId} className="mt-0.5 text-sm text-ink-muted">{description}</p>}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        {hasBody && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>}
        {footer && (
          <div className={`flex shrink-0 justify-end gap-2 px-5 py-3 ${hasBody ? 'border-t border-hairline' : ''}`}>
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
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-hairline bg-recessed/60 px-6 py-12 text-center">
      <span className="rounded-full bg-raised p-2.5 text-ink-subtle shadow-sm">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && <p className="max-w-md text-xs leading-relaxed text-ink-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }): ReactNode {
  return (
    <div className="rounded-lg border border-hairline bg-raised px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold ${tone ?? 'text-ink'}`}>{value}</p>
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
    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-muted">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-hairline'
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
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg'
}): ReactNode {
  const { panelRef, titleId, descriptionId } = useOverlayBehavior(open, onClose)
  if (!open) return null
  const hasBody = children !== null && children !== undefined && children !== false

  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-overlay/40 backdrop-blur-[3px]">
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default"
        aria-label="Close panel"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        className={`animate-sheet-in relative flex h-[100dvh] w-full flex-col border-l border-hairline bg-elevated shadow-floating sm:h-full ${
          size === 'lg' ? 'sm:max-w-xl' : 'sm:max-w-md'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-base font-semibold text-ink">{title}</h2>
            {description && <p id={descriptionId} className="mt-0.5 truncate text-sm text-ink-muted">{description}</p>}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm shrink-0"
            onClick={onClose}
            aria-label="Close task details"
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-hairline px-5 py-3">{footer}</div>
        )}
      </aside>
    </div>,
    document.body,
  )
}

/* ------------------------------------------------------------------------- */
/* Elevated component primitives                                             */
/* ------------------------------------------------------------------------- */

export interface SegmentItem<T extends string> {
  value: T
  label: string
  count?: number
  controls?: string
}

/**
 * Recessed track with a raised, sliding selected pill.
 * Use role="tablist" when the selection controls a panel, "radiogroup" for a
 * plain choice. Selection state is always announced (aria-selected/checked).
 */
export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  label,
  role = 'tablist',
  className = '',
  size = 'md',
}: {
  items: SegmentItem<T>[]
  value: T
  onChange: (value: T) => void
  label: string
  role?: 'tablist' | 'radiogroup'
  className?: string
  size?: 'sm' | 'md'
}): ReactNode {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })

  const measure = useCallback(() => {
    const track = trackRef.current
    const active = buttons.current.get(value)
    if (!track || !active) return
    setIndicator({ left: active.offsetLeft - track.clientLeft, width: active.offsetWidth })
  }, [value])

  useLayoutEffect(() => {
    measure()
  }, [measure, items.length])

  useEffect(() => {
    const track = trackRef.current
    if (!track || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(track)
    return () => observer.disconnect()
  }, [measure])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const index = items.findIndex((item) => item.value === value)
    if (index < 0) return
    let next = index
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % items.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return
    event.preventDefault()
    const item = items[next]
    onChange(item.value)
    buttons.current.get(item.value)?.focus()
  }

  return (
    <div
      ref={trackRef}
      role={role}
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={`relative inline-flex max-w-full items-center overflow-x-auto rounded-control border border-hairline bg-recessed p-0.5 shadow-[inset_0_1px_2px_rgb(var(--shadow-ink)/0.05)] ${className}`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0.5 top-0.5 rounded-[8px] border border-hairline bg-raised shadow-[0_1px_2px_rgb(var(--shadow-ink)/0.08)] transition-[transform,width] duration-180 ease-settle"
        style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
      />
      {items.map((item) => {
        const selected = item.value === value
        return (
          <button
            key={item.value}
            ref={(node) => {
              if (node) buttons.current.set(item.value, node)
              else buttons.current.delete(item.value)
            }}
            type="button"
            role={role === 'tablist' ? 'tab' : 'radio'}
            aria-selected={role === 'tablist' ? selected : undefined}
            aria-checked={role === 'radiogroup' ? selected : undefined}
            aria-controls={item.controls}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={`relative z-[1] inline-flex min-h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] px-3 text-[13px] font-medium transition-colors duration-140 ${
              size === 'sm' ? 'min-h-[26px] px-2.5 text-xs' : ''
            } ${selected ? 'text-accent' : 'text-ink-muted hover:text-ink'}`}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={`tabular rounded px-1 text-[11px] font-semibold ${
                  selected ? 'bg-accent-tint text-accent' : 'bg-recessed text-ink-muted'
                }`}
              >
                {item.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Idle → working → saved button driven only by a confirmed async result.
 * The label stack reserves the widest label so the control never jumps.
 */
export function AsyncActionButton({
  label,
  pendingLabel = 'Working…',
  successLabel = 'Saved',
  onAction,
  onError,
  variant = 'primary',
  className = '',
  disabled = false,
  icon,
  successDuration = 1400,
}: {
  label: string
  pendingLabel?: string
  successLabel?: string
  onAction: () => Promise<unknown>
  onError?: (message: string) => void
  variant?: 'primary' | 'secondary'
  className?: string
  disabled?: boolean
  icon?: IconName
  successDuration?: number
}): ReactNode {
  const [status, setStatus] = useState<'idle' | 'pending' | 'success'>('idle')
  const timerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    },
    [],
  )

  async function run() {
    if (status === 'pending' || disabled) return
    setStatus('pending')
    try {
      await onAction()
      setStatus('success')
      timerRef.current = window.setTimeout(() => setStatus('idle'), successDuration)
    } catch (caught) {
      setStatus('idle')
      onError?.(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const current = status === 'pending' ? pendingLabel : status === 'success' ? successLabel : label
  const widest = [label, pendingLabel, successLabel].reduce((long, item) =>
    item.length > long.length ? item : long,
  )

  return (
    <button
      type="button"
      onClick={run}
      disabled={disabled || status === 'pending'}
      aria-busy={status === 'pending'}
      className={`btn ${variant === 'primary' ? 'btn-primary' : 'btn-secondary'} ${className}`}
    >
      <span className="inline-grid place-items-center">
        <span className="invisible col-start-1 row-start-1 whitespace-nowrap">{widest}</span>
        <span className="col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5 whitespace-nowrap">
          {(icon || status !== 'idle') && (
            <span className="inline-flex h-4 w-4 items-center justify-center" aria-hidden="true">
              {status === 'pending' ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : status === 'success' ? (
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                  <path
                    d="M20 6 9 17l-5-5"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="animate-check-draw"
                  />
                </svg>
              ) : (
                <Icon name={icon!} className="h-4 w-4" />
              )}
            </span>
          )}
          {current}
        </span>
      </span>
    </button>
  )
}

/**
 * Stroke-drawn completion control. Uses a real checkbox for semantics and
 * touch/keyboard behaviour; drawing is feedback, never the state itself.
 */
export function Skeleton({ className = '' }: { className?: string }): ReactNode {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-recessed ${className}`} />
}
