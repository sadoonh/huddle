import { useMemo, useState } from 'react'
import { Icon } from '../icons'
import { Avatar } from '../ui'
import type { Participant } from '../../lib/types'

export default function ParticipantList({
  participants,
  selectedId,
  onSelect,
}: {
  participants: Participant[]
  selectedId: string | null
  onSelect: (userId: string) => void
}) {
  const [filter, setFilter] = useState<'all' | 'unreviewed'>('all')
  const reviewed = participants.filter((participant) => participant.reviewed_at).length
  const percent = participants.length ? Math.round((reviewed / participants.length) * 100) : 0

  const visible = useMemo(
    () =>
      filter === 'unreviewed'
        ? participants.filter((participant) => !participant.reviewed_at)
        : participants,
    [participants, filter],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 px-3 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Team</h2>
          <span className="text-[10px] text-slate-400">
            {reviewed}/{participants.length}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-2 flex gap-1">
          {(['all', 'unreviewed'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                filter === value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {value === 'all' ? 'All' : 'Pending'}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
        {visible.map((participant) => {
          const active = participant.user.id === selectedId
          return (
            <button
              key={participant.id}
              type="button"
              onClick={() => onSelect(participant.user.id)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
                active ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'
              }`}
            >
              <span className="relative">
                <Avatar name={participant.user.full_name} size="sm" />
                {participant.pre_meeting_submitted_at && (
                  <span
                    className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white bg-sky-500"
                    title="Pre-meeting update submitted"
                  />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-xs font-semibold ${active ? 'text-white' : 'text-slate-800'}`}>
                  {participant.user.full_name}
                </span>
                <span className={`block truncate text-[10px] ${active ? 'text-slate-400' : 'text-slate-400'}`}>
                  {participant.reviewed_at
                    ? 'Reviewed'
                    : participant.pre_meeting_submitted_at
                      ? 'Update ready'
                      : 'No update'}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {participant.open_blocker_count > 0 && (
                  <span
                    className={`rounded px-1 text-[10px] font-bold ${
                      active ? 'bg-rose-500/20 text-rose-200' : 'bg-rose-100 text-rose-700'
                    }`}
                    title={`${participant.open_blocker_count} open blockers`}
                  >
                    {participant.open_blocker_count}
                  </span>
                )}
                {participant.follow_up_flagged && (
                  <span className={active ? 'text-amber-300' : 'text-amber-500'} title="Flagged for follow-up">
                    <Icon name="flag" className="h-3 w-3" />
                  </span>
                )}
                {participant.reviewed_at && (
                  <span className={active ? 'text-emerald-300' : 'text-emerald-600'} title="Reviewed">
                    <Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                )}
              </span>
            </button>
          )
        })}
        {visible.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-slate-400">Everyone has been reviewed.</p>
        )}
      </div>

      <div className="border-t border-slate-200 px-3 py-2 text-[10px] leading-relaxed text-slate-400">
        <span className="mr-2 inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-500" /> update
        </span>
        <span className="mr-2 inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> blockers
        </span>
        <span className="inline-flex items-center gap-1">
          <Icon name="flag" className="h-2.5 w-2.5 text-amber-500" /> follow-up
        </span>
      </div>
    </div>
  )
}
