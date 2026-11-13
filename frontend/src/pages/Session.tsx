import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import TaskDialog from '../components/TaskDialog'
import { ResolveBlockerDialog } from '../components/TodayActions'
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
import {
  formatDate,
  formatDateTime,
  formatDueDateForStatus,
  formatOpenAge,
  formatSessionDate,
  humanize,
} from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { PILOT_ENABLED } from '../lib/config'
import { useToast } from '../lib/toast'
import type {
  AuditEvent,
  Participant,
  SessionCaptures,
  SessionDetail,
  SessionOutcomes,
} from '../lib/types'

export default function SessionPage() {
  const { sessionId = '' } = useParams()
  const { me, isManager } = useAuth()
  const { push } = useToast()
  const [busyItem, setBusyItem] = useState<string | null>(null)
  const [taskDialogId, setTaskDialogId] = useState<string | null>(null)
  const [resolveBlocker, setResolveBlocker] = useState<{ id: string; description: string } | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const detail = useAsync<SessionDetail>(() => api.get(`/standups/sessions/${sessionId}`), [sessionId])
  const outcomes = useAsync<SessionOutcomes>(() => api.get(`/standups/sessions/${sessionId}/outcomes`), [sessionId])

  async function completeAction(itemId: string) {
    setBusyItem(itemId)
    try {
      await api.patch(`/action-items/${itemId}`, { status: 'completed' })
      outcomes.refresh()
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      setBusyItem(null)
    }
  }

  if (detail.loading && !detail.data) return <Loading />
  if (detail.error || !detail.data) {
    return <ErrorBox message={detail.error ?? 'Session not found'} onRetry={detail.refresh} />
  }

  const session = detail.data
  const data = outcomes.data
  const unreviewedCount = session.participant_count - session.reviewed_count
  const hasOutcomes = Boolean(
    data && (data.action_items.length || data.unresolved_blockers.length || data.decisions.length),
  )

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`Standup outcomes · ${formatSessionDate(session.session_date)}`}
        subtitle={`Facilitated by ${session.facilitator?.full_name ?? '—'}`}
        actions={
          <>
            <Link to="/standups" className="btn btn-secondary">
              <Icon name="arrowLeft" /> Past standups
            </Link>
            {session.status !== 'completed' && isManager && (
              <Link to={`/standups/${session.id}/live`} className="btn btn-primary">
                <Icon name="play" /> Resume standup
              </Link>
            )}
          </>
        }
      />

      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <SessionStatusBadge status={session.status} />
          <span className="text-sm text-slate-500">
            {session.reviewed_count} of {session.participant_count} reviewed
          </span>
          {session.status === 'completed' && unreviewedCount > 0 && (
            <span className="text-sm text-amber-700">
              Completed with {unreviewedCount} {unreviewedCount === 1 ? 'person' : 'people'} not reviewed
            </span>
          )}
          {isManager && PILOT_ENABLED && (
            <details className="relative ml-auto">
              <summary className="text-sm font-medium text-slate-600 underline-offset-2 hover:underline">
                Session actions
              </summary>
              <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                <Link
                  to={`/ai?session=${session.id}`}
                  className="block rounded px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Import transcript
                </Link>
              </div>
            </details>
          )}
        </div>

        {outcomes.loading && !outcomes.data ? (
          <Loading label="Loading outcomes…" />
        ) : outcomes.error ? (
          <ErrorBox message={outcomes.error} onRetry={outcomes.refresh} />
        ) : !hasOutcomes ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
            No outcomes recorded in this meeting.
          </p>
        ) : (
          <>
            {data && data.action_items.length > 0 && (
              <section>
                <h2 className="text-base font-semibold text-slate-900">Next actions</h2>
                <p className="mb-2 text-sm text-slate-500">Recorded in this meeting.</p>
                <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                  {data.action_items.map((item) => (
                    <div key={item.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm ${item.status === 'open' ? 'text-slate-900' : 'text-slate-400 line-through'}`}>
                          {item.description}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          {item.owner?.full_name ?? 'Unassigned — needs an owner'}
                          {item.due_date ? ` · ${formatDueDateForStatus(item.due_date, item.status === 'completed' || item.status === 'canceled')}` : ''}
                          {' · '}{humanize(item.status)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        {item.task_id && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTaskDialogId(item.task_id!)}>
                            Open task
                          </button>
                        )}
                        {item.status === 'open' && (isManager || (me && item.owner?.id === me.id)) && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busyItem === item.id}
                            onClick={() => completeAction(item.id)}
                          >
                            {busyItem === item.id ? <Spinner className="h-3 w-3" /> : <Icon name="check" className="h-3 w-3" />}
                            Mark done
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {data && data.unresolved_blockers.length > 0 && (
              <section>
                <h2 className="text-base font-semibold text-slate-900">Help still needed</h2>
                <p className="mb-2 text-sm text-slate-500">Still open now, including items carried into this meeting.</p>
                <div className="divide-y divide-slate-200 rounded-xl border border-rose-200 bg-white">
                  {data.unresolved_blockers.map((blocker) => (
                    <div key={blocker.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900">{blocker.task_title ?? 'Team help request'}</p>
                        <p className="mt-1 text-sm text-slate-600">{blocker.description}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          Help owner: {blocker.owner?.full_name ?? 'Unassigned — needs an owner'}
                          {blocker.age_days > 0 ? ` · ${formatOpenAge(blocker.age_days)}` : ''}
                          {blocker.origin_session_date ? ` · raised ${formatDate(blocker.origin_session_date)}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        {blocker.task_id && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTaskDialogId(blocker.task_id!)}>
                            Open task
                          </button>
                        )}
                        {isManager && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setResolveBlocker({ id: blocker.id, description: blocker.description })}
                          >
                            Resolve
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {data && data.decisions.length > 0 && (
              <section>
                <h2 className="text-base font-semibold text-slate-900">Decisions</h2>
                <div className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                  {data.decisions.map((decision) => (
                    <div key={decision.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm text-slate-900">{decision.description}</p>
                          {decision.rationale && <p className="mt-1 text-sm text-slate-500">Why: {decision.rationale}</p>}
                          <p className="mt-1 text-sm text-slate-500">
                            {decision.responsible_user
                              ? `Responsible: ${decision.responsible_user.full_name}`
                              : 'No responsible person assigned'}
                          </p>
                        </div>
                        {decision.task_id && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTaskDialogId(decision.task_id!)}>
                            Open task
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        <details
          id="meeting-details"
          className="rounded-xl border border-slate-200 bg-white px-4 py-3"
          onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
        >
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">
            Meeting details
          </summary>
          {detailsOpen && (
            <MeetingDetails
              sessionId={session.id}
              participants={session.participants}
              summary={session.summary}
              notes={session.notes}
              startedAt={session.started_at}
              endedAt={session.ended_at}
            />
          )}
        </details>
      </div>

      {taskDialogId && (
        <TaskDialog
          taskId={taskDialogId}
          onClose={() => setTaskDialogId(null)}
          onChanged={() => outcomes.refresh()}
        />
      )}
      {resolveBlocker && (
        <ResolveBlockerDialog
          blockerId={resolveBlocker.id}
          description={resolveBlocker.description}
          onClose={() => setResolveBlocker(null)}
          onSaved={() => {
            setResolveBlocker(null)
            outcomes.refresh()
          }}
        />
      )}
    </div>
  )
}

function MeetingDetails({
  sessionId,
  participants,
  summary,
  notes,
  startedAt,
  endedAt,
}: {
  sessionId: string
  participants: Participant[]
  summary: string | null
  notes: string | null
  startedAt: string | null
  endedAt: string | null
}) {
  const captures = useAsync<SessionCaptures>(() => api.get(`/standups/sessions/${sessionId}/captures`), [sessionId])
  const timeline = useAsync<AuditEvent[]>(() => api.get(`/standups/sessions/${sessionId}/timeline`), [sessionId])

  if (captures.loading && !captures.data) return <Loading label="Loading meeting details…" />
  if (captures.error) return <ErrorBox message={captures.error} onRetry={captures.refresh} />

  return (
    <div className="mt-4 space-y-5">
      <section>
        <h3 className="text-sm font-semibold text-slate-800">Progress recorded</h3>
        {(captures.data?.updates.length ?? 0) === 0 ? (
          <p className="mt-1 text-sm text-slate-500">No progress updates recorded.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {captures.data!.updates.map((update) => (
              <div key={update.id} className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-sm text-slate-700">{update.progress}</p>
                {update.next_steps && <p className="mt-1 text-sm text-slate-500">Next: {update.next_steps}</p>}
                <p className="mt-1 text-xs text-slate-500">
                  {update.attributed_to?.full_name ?? update.author?.full_name ?? '—'} · {formatDateTime(update.created_at)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-800">Captured notes</h3>
        {(captures.data?.notes.length ?? 0) === 0 ? (
          <p className="mt-1 text-sm text-slate-500">No general notes captured.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {captures.data!.notes.map((note) => (
              <div key={note.id} className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-sm text-slate-700">{note.body}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {note.author?.full_name ?? '—'} · {formatDateTime(note.created_at)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-800">Participant reporting</h3>
        <div className="mt-2 space-y-3">
          {participants.map((participant) => (
            <div key={participant.id} className="flex items-start gap-3">
              <Avatar name={participant.user.full_name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">{participant.user.full_name}</p>
                <p className="text-xs text-slate-500">
                  {participant.reviewed_at ? 'Reviewed' : 'Not reviewed'}
                </p>
                {participant.daily_update ? (
                  <div className="mt-1 rounded bg-slate-50 px-2 py-1.5">
                    <p className="text-sm text-slate-700">{participant.daily_update.progress}</p>
                    {participant.daily_update.next_steps && (
                      <p className="text-sm text-slate-500">Next: {participant.daily_update.next_steps}</p>
                    )}
                    <p className="mt-0.5 text-xs text-slate-500">
                      Daily note · {formatDateTime(participant.daily_update.updated_at)}
                    </p>
                  </div>
                ) : participant.pre_meeting_progress ? (
                  <div className="mt-1 rounded bg-slate-50 px-2 py-1.5">
                    <p className="text-sm text-slate-700">{participant.pre_meeting_progress}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Legacy pre-meeting note · {formatDateTime(participant.pre_meeting_submitted_at)}
                    </p>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-slate-500">No daily note submitted.</p>
                )}
                {participant.follow_up_flagged && (
                  <p className="mt-1 text-xs text-amber-700">
                    Legacy follow-up flag{participant.follow_up_note ? `: ${participant.follow_up_note}` : ''}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-800">Session facts and notes</h3>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">Started</dt><dd className="text-slate-800">{formatDateTime(startedAt)}</dd>
          <dt className="text-slate-500">Ended</dt><dd className="text-slate-800">{formatDateTime(endedAt)}</dd>
        </dl>
        {summary && <p className="mt-2 text-sm text-slate-600">{summary}</p>}
        {notes && <p className="mt-2 text-sm text-slate-600">{notes}</p>}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-800">Audit trail</h3>
        {timeline.loading && !timeline.data ? (
          <p className="mt-1 text-sm text-slate-500">Loading audit trail…</p>
        ) : timeline.error ? (
          <ErrorBox message={timeline.error} onRetry={timeline.refresh} />
        ) : (
          <div className="mt-2 max-h-80 space-y-1 overflow-y-auto">
            {(timeline.data ?? []).map((event) => (
              <div key={event.id} className="flex items-start gap-2 rounded px-2 py-1 text-xs odd:bg-slate-50">
                <span className="w-28 shrink-0 text-slate-400">{formatDateTime(event.occurred_at)}</span>
                <span className="w-40 shrink-0 font-mono text-[11px] text-slate-500">{event.event_type}</span>
                <span className="min-w-0 flex-1 text-slate-600">
                  {event.actor?.full_name ?? event.actor_label ?? 'system'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
