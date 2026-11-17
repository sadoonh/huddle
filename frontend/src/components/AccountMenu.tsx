import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'
import { Avatar } from './ui'
import { humanize } from '../lib/format'
import type { Me } from '../lib/types'
import { useTheme } from '../lib/theme'

/**
 * Compact account menu. Only real actions are included: identity context and a
 * session refresh. No profile editing, notifications, or fake sign-out.
 */
export default function AccountMenu({
  me,
  mode,
  onRefresh,
}: {
  me: Me
  mode: string
  onRefresh: () => void
}): ReactNode {
  const { resolved, setPreference } = useTheme()
  const isDark = resolved === 'dark'
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; bottom: number; left: number; right: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  function close(returnFocus = true) {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  function toggle() {
    if (open) {
      close()
      return
    }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setAnchor({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      menuRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]')
        ?.focus()
    }, 0)
    const handlePointer = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node) || triggerRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey, true)
    }
  }, [open])

  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Tab') {
      close()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]',
      ) ?? [],
    )
    if (items.length === 0) return
    const index = items.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length
    items[next]?.focus()
  }

  const width = 272
  const left = anchor ? Math.min(Math.max(anchor.right - width, 8), window.innerWidth - width - 8) : 8
  const spaceBelow = anchor ? window.innerHeight - anchor.bottom - 6 : 0
  const spaceAbove = anchor ? anchor.top - 6 : 0
  const openBelow = spaceBelow >= spaceAbove
  const menuMaxHeight = Math.max(0, openBelow ? spaceBelow : spaceAbove)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="flex min-h-[40px] items-center gap-2 rounded-control px-1.5 text-left transition-colors duration-140 hover:bg-white/5 focus-visible:bg-white/5"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${me.full_name}`}
        onClick={toggle}
      >
        <span className="hidden sm:inline-flex">
          <Avatar name={me.full_name} size="md" />
        </span>
        <span className="sm:hidden">
          <Avatar name={me.full_name} size="sm" />
        </span>
        <span className="hidden max-w-[150px] truncate text-sm font-medium text-white sm:inline">
          {me.full_name}
        </span>
        <Icon
          name="chevronDown"
          className={`h-3 w-3 shrink-0 text-[#a9b2ba] transition-transform duration-140 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && anchor &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Account"
            onKeyDown={onMenuKeyDown}
            style={{
              position: 'fixed',
              left,
              width,
              ...(openBelow
                ? { top: anchor.bottom + 6 }
                : { bottom: window.innerHeight - anchor.top + 6 }),
              maxHeight: menuMaxHeight,
            }}
            className="animate-tray-in z-50 overflow-y-auto rounded-control border border-hairline bg-elevated shadow-floating"
          >
            <div className="flex items-start gap-2.5 px-3.5 py-3">
              <Avatar name={me.full_name} size="md" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{me.full_name}</p>
                <p className="truncate text-xs text-ink-muted">{me.email}</p>
                <p className="mt-1 text-[11px] font-medium text-accent">{humanize(me.role)}</p>
              </div>
            </div>
            <div className="border-t border-hairline px-3.5 py-2.5 text-xs text-ink-muted">
              {mode === 'nex' ? 'Signed in through nex' : 'Local development session'}
            </div>
            <div className="border-t border-hairline px-3.5 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Appearance</p>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={isDark}
                aria-label="Dark mode"
                title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                onClick={() => setPreference(isDark ? 'light' : 'dark')}
                className={`relative mt-1.5 flex h-10 w-[74px] items-center rounded-full border transition-colors duration-180 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-elevated ${
                  isDark ? 'border-accent/50 bg-accent-tint' : 'border-hairline bg-recessed'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute left-1 top-1 h-8 w-8 rounded-full bg-elevated shadow-card transition-transform duration-180 ease-settle ${
                    isDark ? 'translate-x-[34px]' : 'translate-x-0'
                  }`}
                />
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  className={`absolute left-3 z-10 h-4 w-4 transition-colors duration-180 ${
                    isDark ? 'text-ink-subtle' : 'text-warning'
                  }`}
                >
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                </svg>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`absolute right-3 z-10 h-4 w-4 transition-colors duration-180 ${
                    isDark ? 'text-accent' : 'text-ink-subtle'
                  }`}
                >
                  <path d="M20.5 14.1A8.5 8.5 0 0 1 9.9 3.5 8.5 8.5 0 1 0 20.5 14.1Z" />
                </svg>
              </button>
            </div>
            <div className="border-t border-hairline p-1">
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  onRefresh()
                  close()
                }}
              >
                <Icon name="refresh" className="h-3.5 w-3.5 text-ink-subtle" /> Refresh session
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
