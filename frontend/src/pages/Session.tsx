import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import TaskDialog from '../components/TaskDialog'
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
import type {
  AuditEvent,
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

  const detail = useAsync<SessionDetail>(() => api.get(`/standups/sessions/${sessionId}`), [sessionId])
  const outcomes = useAsync<SessionOutcomes>(() => api.get(`/standups/sessions/${sessionId}/outcomes`), [sessionId])
  const captures = useAsync<SessionCaptures>(() => api.get(`/standups/sessions/${sessionId}/captures`), [sessionId])
  const timeline = useAsync<AuditEvent[]>(() => api.get(`/standups/sessions/${sessionId}/timeline`), [sessionId])

  async function completeAction(itemId: string) {
    setBusyItem(itemId)
    try {
      await api.patch(`/action-items/${itemId}`, { status: 'completed' })
      outcomes.refresh()
      captures.refresh()
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
  const data = outcomes.data
  const hasOutcomes = Boolean(
    data && (data.action_items.length || data.unresolved_blockers.length || data.decisions.length),
  )

  return (
    <div>
      <PageHeader
        title={formatDate(session.session_date)}
        subtitle={`Standup · facilitated by ${session.facilitator?.full_name ?? '—'}`}
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
            {isManager && (
              <Link to="/ai" className="btn btn-ghost">
                <Icon name="sparkles" /> Import transcript
              </Link>
            )}
          </>
        }
      />

      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <SessionStatusBadge status={session.status} />
          <span className="text-sm text-slate-500">
            {session.reviewed_count} of {session.participant_count} reviewed
          </span>
        </div>

        {outcomes.loading ? (
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
                <p className="mb-2 text-xs text-slate-500">Recorded in this meeting.</p>
                <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                  {data.action_items.map((item) => (
                    <div key={item.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm ${item.status === 'open' ? 'text-slate-900' : 'text-slate-400 line-through'}`}>
                          {item.description}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.owner?.full_name ?? 'Unassigned'}
                          {item.due_date ? ` · due ${relativeDay(item.due_date)}` : ''}
                          {' · '}{humanize(item.status)}
                        </p>
                      </div>
                      {item.status === 'open' && (isManager || (me && item.owner?.id === me.id)) && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={busyItem === item.id}
                          onClick={() => completeAction(item.id)}
                        >
                          {busyItem === item.id ? <Spinner className="h-3 w-3" /> : <Icon name="check" className="h-3 w-3" />}
                          Done
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {data && data.unresolved_blockers.length > 0 && (
              <section>
                <h2 className="text-base font-semibold text-slate-900">Unresolved help needed</h2>
                <p className="mb-2 text-xs text-slate-500">Still open now, including items carried into this meeting.</p>
                <div className="divide-y divide-slate-200 rounded-xl border border-rose-200 bg-white">
                  {data.unresolved_blockers.map((blocker) => (
                    <div key={blocker.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900">{blocker.task_title ?? 'Team blocker'}</p>
                        <p className="mt-1 text-sm text-slate-600">{blocker.description}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {blocker.owner?.full_name ?? 'Unassigned'}
                          {blocker.age_days > 0 ? ` · ${blocker.age_days}d open` : ''}
                          {blocker.origin_session_date ? ` · raised ${formatDate(blocker.origin_session_date)}` : ''}
                        </p>
                      </div>
                      {blocker.task_id && (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTaskDialogId(blocker.task_id!)}>
                          Open task
                        </button>
                      )}
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
                      <p className="text-sm text-slate-900">{decision.description}</p>
                      {decision.rationale && (
                        <p className="mt-1 text-xs text-slate-500">Why: {decision.rationale}</p>
                      )}
                      {decision.responsible_user && (
                        <p className="mt-1 text-xs text-slate-500">
                          Responsible: {decision.responsible_user.full_name}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        <details className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">
            Progress recorded ({captures.data?.updates.length ?? 0})
          </summary>
          <div className="mt-3 space-y-2">
            {(captures.data?.updates ?? []).map((update) => (
              <div key={update.id} className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-sm text-slate-700">{update.progress}</p>
                {update.next_steps && <p className="mt-1 text-xs text-slate-500">Next: {update.next_steps}</p>}
                <p className="mt-1 text-xs text-slate-500">
                  {update.attributed_to?.full_name ?? update.author?.full_name ?? '—'} ·{' '}
                  {formatDateTime(update.created_at)}
                </p>
              </div>
            ))}
          </div>
        </details>

        <details className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">
            Participant reporting
          </summary>
          <div className="mt-3 space-y-3">
            {session.participants.map((participant) => (
              <div key={participant.id} className="flex items-start gap-3">
                <Avatar name={participant.user.full_name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">{participant.user.full_name}</p>
                  <p className="text-xs text-slate-500">
                    {participant.reviewed_at ? 'Reviewed' : 'Not reviewed'}
                    {participant.pre_meeting_submitted_at ? ' · update submitted' : ''}
                  </p>
                  {participant.pre_meeting_progress && (
                    <p className="mt-1 text-sm text-slate-600">{participant.pre_meeting_progress}</p>
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
        </details>

        <details className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">
            Session facts and notes
          </summary>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-slate-500">Date</dt><dd className="text-slate-800">{formatDate(session.session_date)}</dd>
            <dt className="text-slate-500">Facilitator</dt><dd className="text-slate-800">{session.facilitator?.full_name ?? '—'}</dd>
            <dt className="text-slate-500">Started</dt><dd className="text-slate-800">{formatDateTime(session.started_at)}</dd>
            <dt className="text-slate-500">Ended</dt><dd className="text-slate-800">{formatDateTime(session.ended_at)}</dd>
          </dl>
          {session.summary && <p className="mt-3 text-sm text-slate-600">{session.summary}</p>}
          {session.notes && <p className="mt-2 text-sm text-slate-600">{session.notes}</p>}
        </details>

        <details className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">
            Audit trail ({timeline.data?.length ?? 0})
          </summary>
          <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
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
        </details>
      </div>

      {taskDialogId && (
        <TaskDialog
          taskId={taskDialogId}
          onClose={() => setTaskDialogId(null)}
          onChanged={() => {
            outcomes.refresh()
            captures.refresh()
          }}
        />
      )}
    </div>
  )
}
