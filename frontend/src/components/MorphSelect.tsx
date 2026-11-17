import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'
import { Avatar, Spinner } from './ui'

export interface SelectOption {
  value: string
  label: string
  description?: string
  badge?: string
  disabled?: boolean
  /** Render the neutral dashed person icon instead of an initial avatar. */
  unassigned?: boolean
}

export interface MorphSelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  /** Accessible name for the trigger (rendered as a small caption when `showLabel`). */
  label: string
  showLabel?: boolean
  placeholder?: string
  searchable?: boolean
  searchPlaceholder?: string
  disabled?: boolean
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  id?: string
  className?: string
  size?: 'sm' | 'md'
  emptyLabel?: string
  /** Renders the current value as an avatar + name (owner pickers). */
  avatar?: boolean
  /** Optional colour for the selected value text (status colours, etc.). */
  valueClassName?: string
  /** Native title/help text for the trigger. */
  title?: string
  /** `quiet` reduces chrome for dense editable tables. Default is unchanged. */
  variant?: 'default' | 'quiet'
}

const TRAY_MAX_HEIGHT = 320

/**
 * Compact trigger with a connected option tray (Atelier Morph Select pattern).
 * Portal + collision handling keeps the tray out of board overflow clipping.
 * Keyboard: arrows/Home/End, typeahead or search, Enter to choose, Escape to
 * dismiss with focus returned to the trigger.
 */
export default function MorphSelect({
  value,
  options,
  onChange,
  label,
  showLabel = false,
  placeholder = 'Select…',
  searchable = false,
  searchPlaceholder = 'Search…',
  disabled = false,
  loading = false,
  error = null,
  onRetry,
  id,
  className = '',
  size = 'md',
  emptyLabel = 'No options',
  avatar = false,
  valueClassName = '',
  title,
  variant = 'default',
}: MorphSelectProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [rect, setRect] = useState<{ left: number; width: number; top: number; bottom: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const trayRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const typeahead = useRef({ buffer: '', timer: 0 })
  const listId = useId()
  const generatedId = useId()
  const triggerId = id ?? generatedId

  const selected = options.find((option) => option.value === value) ?? null
  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options
    const needle = query.trim().toLowerCase()
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        (option.description ?? '').toLowerCase().includes(needle),
    )
  }, [options, query, searchable])

  const active = filtered[Math.min(activeIndex, Math.max(filtered.length - 1, 0))] ?? null

  function position() {
    const trigger = triggerRef.current
    if (!trigger) return
    const box = trigger.getBoundingClientRect()
    const width = Math.min(Math.max(box.width, 224), window.innerWidth - 16)
    const left = Math.min(Math.max(box.left, 8), window.innerWidth - width - 8)
    setRect({ left, width, top: box.top, bottom: box.bottom })
  }

  function close(returnFocus = true) {
    setOpen(false)
    setQuery('')
    if (returnFocus) triggerRef.current?.focus()
  }

  function openTray() {
    if (disabled || loading) return
    position()
    setQuery('')
    const index = options.findIndex((option) => option.value === value)
    setActiveIndex(index >= 0 ? index : 0)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) {
      document.body.removeAttribute('data-popover-open')
      return
    }
    document.body.setAttribute('data-popover-open', '')
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node
      if (trayRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(false)
    }
    const handleScroll = () => position()
    // Escape must dismiss the tray even if focus has not reached it yet.
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleEscape, true)
    window.addEventListener('resize', handleScroll)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleEscape, true)
      window.removeEventListener('resize', handleScroll)
      window.removeEventListener('scroll', handleScroll, true)
      if (document.body.hasAttribute('data-popover-open')) {
        document.body.removeAttribute('data-popover-open')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      if (searchable) inputRef.current?.focus()
      else listRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open, searchable])

  // Keep the active option visible inside the tray.
  useLayoutEffect(() => {
    if (!open) return
    const node = trayRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  function choose(option: SelectOption | null) {
    if (!option || option.disabled) return
    onChange(option.value)
    close()
  }

  function moveActive(delta: number) {
    if (filtered.length === 0) return
    let next = activeIndex
    for (let step = 0; step < filtered.length; step += 1) {
      next = (next + delta + filtered.length) % filtered.length
      if (!filtered[next]?.disabled) break
    }
    setActiveIndex(next)
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement | HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveActive(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveActive(-1)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      setActiveIndex(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      setActiveIndex(Math.max(filtered.length - 1, 0))
      return
    }
    if (event.key === 'Enter' || (event.key === ' ' && !searchable)) {
      event.preventDefault()
      choose(active)
      return
    }
    if (event.key === 'Tab') {
      close(false)
      return
    }
    if (!searchable && event.key.length === 1 && /\S/.test(event.key)) {
      const now = Date.now()
      const buffer = now - typeahead.current.timer > 600 ? event.key : typeahead.current.buffer + event.key
      typeahead.current = { buffer, timer: now }
      const needle = buffer.toLowerCase()
      const index = filtered.findIndex((option) => option.label.toLowerCase().startsWith(needle))
      if (index >= 0) setActiveIndex(index)
    }
  }

  const trayHeight = Math.min(
    (searchable ? 48 : 8) + Math.max(filtered.length, 1) * 38 + 8,
    TRAY_MAX_HEIGHT,
  )
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight
  const openUp = rect ? rect.bottom + trayHeight + 12 > viewportHeight && rect.top > trayHeight : false

  return (
    <div className={`min-w-0 ${className}`}>
      {showLabel && (
        <span className="mb-1 block text-xs font-medium text-ink-muted" aria-hidden="true">
          {label}
        </span>
      )}
      <button
        id={triggerId}
        ref={triggerRef}
        type="button"
        disabled={disabled || loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        aria-label={showLabel ? label : `${label}: ${selected?.label ?? placeholder}`}
        onClick={() => (open ? close() : openTray())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (!open) openTray()
          }
        }}
        className={`flex w-full items-center gap-2 rounded-control border text-left text-ink transition-[border-color,box-shadow,background-color] duration-140 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:text-ink-muted ${
          variant === 'quiet'
            ? 'border-transparent bg-transparent shadow-none hover:border-hairline hover:bg-recessed/60 group-hover/row:border-hairline group-hover/row:bg-recessed/60 focus-visible:border-accent/50 focus-visible:bg-raised disabled:bg-transparent'
            : 'border-hairline bg-raised shadow-[0_1px_2px_rgb(var(--shadow-ink)/0.02)] hover:border-accent/40 disabled:bg-recessed'
        } ${size === 'sm' ? 'min-h-[32px] px-2 text-xs' : 'min-h-[40px] px-3 py-2 text-sm'} ${
          open ? 'border-accent/60 bg-raised ring-2 ring-accent/15' : ''
        }`}
      >
        {avatar && selected ? (
          selected.value && !selected.unassigned ? (
            <Avatar name={selected.label} size="sm" />
          ) : (
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-hairline text-ink-subtle">
              <Icon name="user" className="h-3 w-3" />
            </span>
          )
        ) : selected?.badge ? (
          <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        ) : null}
        <span className={`min-w-0 flex-1 truncate ${selected ? valueClassName : 'text-ink-subtle'}`}>
          {selected ? selected.label : placeholder}
        </span>
        {loading ? (
          <Spinner className="h-3.5 w-3.5 text-ink-subtle" />
        ) : (
          <Icon
            name="chevronDown"
            className={`h-3.5 w-3.5 shrink-0 text-ink-subtle transition-transform duration-180 ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {error && (
        <p className="mt-1 flex items-center gap-1 text-xs text-danger">
          <Icon name="alert" className="h-3 w-3" /> {error}
          {onRetry && (
            <button type="button" className="font-medium underline" onClick={onRetry}>
              Retry
            </button>
          )}
        </p>
      )}

      {open && rect &&
        createPortal(
          <div
            ref={trayRef}
            data-morph-tray=""
            onKeyDown={handleKeyDown}
            style={{
              position: 'fixed',
              left: rect.left,
              width: rect.width,
              ...(openUp ? { bottom: viewportHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
              maxHeight: TRAY_MAX_HEIGHT,
            }}
            className="animate-tray-in z-50 flex flex-col overflow-hidden rounded-control border border-hairline bg-elevated shadow-floating focus:outline-none"
          >
            {searchable && (
              <div className="relative border-b border-hairline p-2">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-subtle">
                  <Icon name="search" className="h-3.5 w-3.5" />
                </span>
                <input
                  ref={inputRef}
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={active ? `${listId}-option-${active.value}` : undefined}
                  aria-label={searchPlaceholder}
                  className="h-9 w-full rounded-md border border-transparent bg-recessed pl-9 pr-2 text-sm text-ink outline-none placeholder:text-ink-subtle focus:border-accent/50"
                  placeholder={searchPlaceholder}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setActiveIndex(0)
                  }}
                />
              </div>
            )}
            <ul
              id={listId}
              ref={listRef}
              role="listbox"
              aria-label={label}
              aria-activedescendant={active ? `${listId}-option-${active.value}` : undefined}
              tabIndex={searchable ? -1 : 0}
              className="min-h-0 flex-1 overflow-y-auto p-1 focus:outline-none"
            >
              {filtered.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-ink-subtle">{emptyLabel}</li>
              )}
              {filtered.map((option, index) => {
                const isSelected = option.value === value
                const isActive = index === activeIndex
                return (
                  <li
                    key={option.value}
                    id={`${listId}-option-${option.value}`}
                    data-option-index={index}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(option)}
                    className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm ${
                      option.disabled
                        ? 'cursor-not-allowed text-ink-subtle'
                        : isActive
                          ? 'bg-recessed text-ink'
                          : 'text-ink'
                    }`}
                  >
                    {avatar ? (
                      option.value && !option.unassigned ? (
                        <Avatar name={option.label} size="sm" />
                      ) : (
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-hairline text-ink-subtle">
                          <Icon name="user" className="h-3 w-3" />
                        </span>
                      )
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{option.label}</span>
                      {option.description && (
                        <span className="block truncate text-xs text-ink-muted">{option.description}</span>
                      )}
                    </span>
                    {isSelected && <Icon name="check" className="h-4 w-4 shrink-0 text-accent" />}
                  </li>
                )
              })}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  )
}
