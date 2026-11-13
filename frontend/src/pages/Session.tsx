import type { ReactNode } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Icon } from '../components/icons'
import {
  Avatar,
  ErrorBox,
  Loading,
  PageHeader,
  SessionStatusBadge,
  Spinner,
} from '../components/ui'
import { api } from '../lib/api'
import { formatDate, formatDateTime, humanize, relativeDay } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { useState } from 'react'
import type {
  AuditEvent,
  SessionCaptures,
  SessionDetail,
  SessionSummary,
} from '../lib/types'

export default function SessionPage() {
  const { sessionId = '' } = useParams()
  const { me, isManager } = useAuth()
  const { push } = useToast()
  const [busyItem, setBusyItem] = useState<string | null>(null)

  const detail = useAsync<SessionDetail>(() => api.get(`/standups/sessions/${sessionId}`), [sessionId])
  const summary = useAsync<SessionSummary>(() => api.get(`/standups/sessions/${sessionId}/summary`), [sessionId])
  const captures = useAsync<SessionCaptures>(() => api.get(`/standups/sessions/${sessionId}/captures`), [sessionId])
  const timeline = useAsync<AuditEvent[]>(() => api.get(`/standups/sessions/${sessionId}/timeline`), [sessionId])

  async function toggleAction(id: string, status: 'open' | 'completed') {
    setBusyItem(id)
    try {
      await api.patch(`/action-items/${id}`, { status })
      captures.refresh()
      summary.refresh()
      detail.refresh()
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      setBusyItem(null)
    }
  }

  if (detail.loading) return <Loading />
  if (detail.error || !detail.data) {
    return <ErrorBox message={detail.error ?? 'Session not found'} onRetry={detail.refresh} />
  }

  const session = detail.data
  const canCompleteFollowUp = (ownerId: string | null) =>
    isManager || (me && ownerId === me.id)
  const openFollowUps = captures.data?.action_items.filter((item) => item.status === 'open') ?? []

  return (
    <div>
      <PageHeader
        title={formatDate(session.session_date)}
        subtitle={`Standup session · facilitated by ${session.facilitator?.full_name ?? '—'}`}
        actions={
          <>
            <Link to="/standups" className="btn btn-secondary">
              <Icon name="arrowLeft" /> History
            </Link>
            {session.status !== 'completed' && isManager && (
              <Link to={`/standups/${session.id}/live`} className="btn btn-primary">
                <Icon name="play" /> Open live workspace
              </Link>
            )}
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">Session summary</h2>
                <SessionStatusBadge status={session.status} />
              </div>
              <span className="text-[11px] text-slate-400">
                {session.started_at ? `Started ${formatDateTime(session.started_at)}` : 'Not started'}
                {session.ended_at ? ` · Ended ${formatDateTime(session.ended_at)}` : ''}
              </span>
            </div>
            <div className="p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {summary.data?.summary_text ?? session.summary ?? 'No summary recorded.'}
              </p>
              {summary.data && (
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <SummaryStat label="Updates" value={summary.data.updates} />
                  <SummaryStat label="Blockers" value={summary.data.blockers_created} tone="text-rose-600" />
                  <SummaryStat label="Resolved" value={summary.data.blockers_resolved} tone="text-emerald-600" />
                  <SummaryStat label="Decisions" value={summary.data.decisions} />
                </div>
              )}
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold">What was recorded</h2>
              <span className="text-[11px] text-slate-400">
                Structured records, not free-text notes
              </span>
            </div>
            {captures.loading ? (
              <Loading />
            ) : captures.error ? (
              <div className="p-4">
                <ErrorBox message={captures.error} onRetry={captures.refresh} />
              </div>
            ) : (
              <div className="grid gap-0 divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0">
                <div className="p-4">
                  <CaptureSection title="Progress updates" count={captures.data?.updates.length ?? 0}>
                    {(captures.data?.updates ?? []).map((update) => (
                      <div key={update.id} className="rounded-lg border border-slate-200 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            {update.attributed_to?.full_name ?? update.author?.full_name ?? '—'}
                          </span>
                          <span className="badge badge-slate">{humanize(update.source)}</span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
                          {update.progress}
                        </p>
                        {update.next_steps && (
                          <p className="mt-1 text-[11px] text-slate-500">
                            <span className="font-semibold">Next:</span> {update.next_steps}
                          </p>
                        )}
                      </div>
                    ))}
                  </CaptureSection>

                  <CaptureSection title="Decisions" count={captures.data?.decisions.length ?? 0} className="mt-4">
                    {(captures.data?.decisions ?? []).map((decision) => (
                      <div key={decision.id} className="rounded-lg border border-violet-200 bg-violet-50/40 p-2.5">
                        <p className="text-xs leading-relaxed text-slate-700">{decision.description}</p>
                        {decision.rationale && (
                          <p className="mt-1 text-[11px] text-slate-500">Why: {decision.rationale}</p>
                        )}
                        {decision.responsible_user && (
                          <p className="mt-1 text-[10px] text-slate-400">
                            Responsible: {decision.responsible_user.full_name}
                          </p>
                        )}
                      </div>
                    ))}
                  </CaptureSection>

                  <CaptureSection title="Notes" count={captures.data?.notes.length ?? 0} className="mt-4">
                    {(captures.data?.notes ?? []).map((note) => (
                      <p key={note.id} className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
                        {note.body}
                      </p>
                    ))}
                  </CaptureSection>
                </div>

                <div className="p-4">
                  <CaptureSection title="Blockers" count={captures.data?.blockers.length ?? 0}>
                    {(captures.data?.blockers ?? []).map((blocker) => (
                      <div
                        key={blocker.id}
                        className={`rounded-lg border p-2.5 ${
                          blocker.status === 'open'
                            ? 'border-rose-200 bg-rose-50/40'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`badge ${blocker.status === 'open' ? 'badge-rose' : 'badge-emerald'}`}>
                            {humanize(blocker.status)}
                          </span>
                          {blocker.age_days > 0 && blocker.status === 'open' && (
                            <span className="text-[10px] text-rose-600">{blocker.age_days}d open</span>
                          )}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-slate-700">{blocker.description}</p>
                        <p className="mt-1 text-[10px] text-slate-400">
                          {blocker.task_title ? `${blocker.task_title} · ` : ''}
                          owner {blocker.owner?.full_name ?? 'unassigned'}
                        </p>
                        {blocker.resolution_details && (
                          <p className="mt-1 text-[11px] text-emerald-700">
                            Resolved: {blocker.resolution_details}
                          </p>
                        )}
                      </div>
                    ))}
                  </CaptureSection>

                  <CaptureSection title="Follow-ups" count={captures.data?.action_items.length ?? 0} className="mt-4">
                    {(captures.data?.action_items ?? []).map((item) => (
                      <div key={item.id} className="rounded-lg border border-amber-200 bg-amber-50/40 p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs leading-relaxed text-slate-700">{item.description}</p>
                          <span className={`badge ${item.status === 'open' ? 'badge-amber' : 'badge-emerald'}`}>
                            {humanize(item.status)}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <p className="text-[10px] text-slate-400">
                            {item.owner?.full_name ?? 'Unassigned'}
                            {item.due_date ? ` · due ${relativeDay(item.due_date)}` : ''}
                          </p>
                          {canCompleteFollowUp(item.owner?.id ?? null) && item.status === 'open' && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={busyItem === item.id}
                              onClick={() => toggleAction(item.id, 'completed')}
                            >
                              {busyItem === item.id ? <Spinner className="h-3 w-3" /> : <Icon name="check" className="h-3 w-3" />}
                              Complete
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {openFollowUps.length > 0 && (
                      <p className="text-[11px] text-amber-700">
                        {openFollowUps.length} follow-up(s) remain open and will carry forward.
                      </p>
                    )}
                  </CaptureSection>
                </div>
              </div>
            )}
          </div>

          <details className="card p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">
              Audit trail · {timeline.data?.length ?? 0} events
            </summary>
            <div className="mt-3 max-h-80 space-y-1.5 overflow-y-auto">
              {(timeline.data ?? []).map((event) => (
                <div key={event.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-[11px] odd:bg-slate-50">
                  <span className="w-28 shrink-0 text-slate-400">{formatDateTime(event.occurred_at)}</span>
                  <span className="w-40 shrink-0 font-mono text-[10px] text-slate-500">{event.event_type}</span>
                  <span className="min-w-0 flex-1 text-slate-600">
                    {event.actor?.full_name ?? event.actor_label ?? 'system'}
                    {event.source && <span className="ml-1 text-slate-400">· {humanize(event.source)}</span>}
                  </span>
                </div>
              ))}
              {!timeline.data?.length && <p className="text-xs text-slate-500">No events recorded.</p>}
            </div>
          </details>
        </div>

        <div className="space-y-5">
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold">Participants</h2>
              <span className="text-[11px] text-slate-400">
                {session.reviewed_count}/{session.participant_count} reviewed
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {session.participants.map((participant) => (
                <div key={participant.id} className="p-3.5">
                  <div className="flex items-center gap-2">
                    <Avatar name={participant.user.full_name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-slate-800">
                        {participant.user.full_name}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {participant.reviewed_at
                          ? `Reviewed ${formatDateTime(participant.reviewed_at)}`
                          : participant.pre_meeting_submitted_at
                            ? 'Update submitted · not reviewed'
                            : 'No pre-meeting update'}
                      </p>
                    </div>
                    {participant.reviewed_at ? (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                        <Icon name="check" className="h-3 w-3" strokeWidth={3} />
                      </span>
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-slate-300" />
                    )}
                  </div>
                  {(participant.pre_meeting_progress || participant.pre_meeting_next_steps || participant.pre_meeting_blockers) && (
                    <div className="mt-2 space-y-1 rounded-md bg-slate-50 p-2 text-[11px] text-slate-600">
                      {participant.pre_meeting_progress && <p>{participant.pre_meeting_progress}</p>}
                      {participant.pre_meeting_next_steps && (
                        <p className="text-slate-500">Next: {participant.pre_meeting_next_steps}</p>
                      )}
                      {participant.pre_meeting_blockers && (
                        <p className="text-rose-600">Blocked: {participant.pre_meeting_blockers}</p>
                      )}
                    </div>
                  )}
                  {participant.follow_up_flagged && (
                    <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                      Flagged for follow-up{participant.follow_up_note ? `: ${participant.follow_up_note}` : ''}
                    </p>
                  )}
                  <div className="mt-2 flex gap-1.5">
                    {participant.open_blocker_count > 0 && (
                      <span className="badge badge-rose">{participant.open_blocker_count} blockers</span>
                    )}
                    {participant.open_action_item_count > 0 && (
                      <span className="badge badge-amber">{participant.open_action_item_count} follow-ups</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-4">
            <h2 className="text-sm font-semibold">Session facts</h2>
            <dl className="mt-2 space-y-1.5 text-xs">
              <Fact label="Date" value={formatDate(session.session_date)} />
              <Fact label="Status" value={humanize(session.status)} />
              <Fact label="Facilitator" value={session.facilitator?.full_name ?? '—'} />
              <Fact label="Participants" value={String(session.participant_count)} />
              <Fact label="Blockers reported here" value={String(session.open_blocker_count)} />
              <Fact label="Follow-ups created here" value={String(session.open_action_item_count)} />
            </dl>
          </div>
        </div>
      </div>
    </div>
  )
}

function SummaryStat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-base font-semibold ${tone ?? 'text-slate-900'}`}>{value}</p>
    </div>
  )
}

function CaptureSection({
  title,
  count,
  children,
  className = '',
}: {
  title: string
  count: number
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
        {title} · {count}
      </h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-700">{value}</dd>
    </div>
  )
}
