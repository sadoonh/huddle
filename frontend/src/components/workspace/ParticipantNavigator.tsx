import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Icon } from '../icons'
import { Avatar } from '../ui'
import type { Participant } from '../../lib/types'

export default function ParticipantNavigator({
  participants,
  selectedUserId,
  panelId,
  disabled = false,
  onSelect,
}: {
  participants: Participant[]
  selectedUserId: string | null
  panelId: string
  disabled?: boolean
  onSelect: (userId: string) => void
}) {
  const railRef = useRef<HTMLDivElement | null>(null)
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const selectedIndex = participants.findIndex((item) => item.user.id === selectedUserId)

  useEffect(() => {
    const rail = railRef.current
    const active = selectedUserId ? tabRefs.current.get(selectedUserId) : null
    if (!rail || !active) return
    const left = active.offsetLeft
    const right = left + active.offsetWidth
    const padding = 8
    if (left < rail.scrollLeft + padding) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      rail.scrollTo({ left: Math.max(left - padding, 0), behavior: reduced ? 'auto' : 'smooth' })
    } else if (right > rail.scrollLeft + rail.clientWidth - padding) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      rail.scrollTo({
        left: right - rail.clientWidth + padding,
        behavior: reduced ? 'auto' : 'smooth',
      })
    }
  }, [selectedUserId, participants.length])

  function select(index: number) {
    if (disabled) return
    const next = participants[index]
    if (!next) return
    onSelect(next.user.id)
    tabRefs.current.get(next.user.id)?.focus({ preventScroll: true })
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return
    const current = selectedIndex < 0 ? 0 : selectedIndex
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      select((current + 1) % participants.length)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      select((current - 1 + participants.length) % participants.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      select(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      select(participants.length - 1)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="btn btn-secondary btn-sm shrink-0"
        disabled={disabled || selectedIndex <= 0}
        onClick={() => select(selectedIndex - 1)}
        aria-label="Previous person"
      >
        <Icon name="chevronLeft" />
      </button>

      <div
        ref={railRef}
        role="tablist"
        aria-label="Huddle participants"
        onKeyDown={onKeyDown}
        className="relative flex min-w-0 flex-1 items-end gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {participants.map((item) => {
          const selected = item.user.id === selectedUserId
          const reviewed = Boolean(item.reviewed_at)
          return (
            <button
              key={item.id}
              ref={(node) => {
                if (node) tabRefs.current.set(item.user.id, node)
                else tabRefs.current.delete(item.user.id)
              }}
              type="button"
              role="tab"
              id={`participant-tab-${item.user.id}`}
              aria-selected={selected}
              aria-controls={panelId}
              aria-label={`${item.user.full_name}, ${reviewed ? 'Reviewed' : 'To review'}`}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              onClick={() => onSelect(item.user.id)}
              className={`flex min-w-[164px] max-w-[230px] shrink-0 items-center gap-2.5 px-2.5 pb-2.5 text-left transition-colors duration-140 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-70 ${
                selected
                  ? 'rounded-t-control rounded-b-none border-t border-hairline bg-raised pt-[7px]'
                  : 'rounded-control bg-transparent pt-2 hover:bg-raised/50'
              }`}
            >
              <Avatar name={item.user.full_name} size="sm" />
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-sm ${
                    selected ? 'font-semibold text-ink' : 'font-medium text-ink-muted'
                  }`}
                  title={item.user.full_name}
                >
                  {item.user.full_name}
                </span>
                <span
                  className={`mt-0.5 flex items-center gap-1 text-[10.5px] font-medium ${
                    reviewed ? 'text-success' : 'text-warning'
                  }`}
                >
                  {reviewed ? <Icon name="check" className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                  {reviewed ? 'Reviewed' : 'To review'}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <button
        type="button"
        className="btn btn-secondary btn-sm shrink-0"
        disabled={disabled || selectedIndex < 0 || selectedIndex >= participants.length - 1}
        onClick={() => select(selectedIndex + 1)}
        aria-label="Next person"
      >
        <Icon name="chevronRight" />
      </button>
    </div>
  )
}
