import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import MeetingCapture, { type CaptureRequest } from '../components/workspace/MeetingCapture'
import ParticipantList from '../components/workspace/ParticipantList'
import WorkspaceTaskCard, { type CaptureTab } from '../components/workspace/WorkspaceTaskCard'
import { Icon } from '../components/icons'
import {
  Avatar,
  EmptyState,
  ErrorBox,
  Loading,
  Modal,
  SessionStatusBadge,
  Spinner,
  Stat,
} from '../components/ui'
import { api } from '../lib/api'
import { formatDate, formatDateTime, relativeDay } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import type {
  SessionCaptures,
  SessionDetail,
  SessionSummary,
  Workspace,
  WorkspaceTask,
} from '../lib/types'

export default function WorkspacePage() {
  const { sessionId = '' } = useParams()
  const { me, isManager } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()

  const detail = useAsync<SessionDetail>(() => api.get(`/standups/sessions/${sessionId}`), [sessionId])
  const captures = useAsync<SessionCaptures>(() => api.get(`/standups/sessions/${sessionId}/captures`), [sessionId])
  const summary = useAsync<SessionSummary>(() => api.get(`/standups/sessions/${sessionId}/summary`), [sessionId])

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const workspace = useAsync<Workspace | null>(
    () =>
      selectedUserId
        ? api.get(`/standups/sessions/${sessionId}/participants/${selectedUserId}/workspace`)
        : Promise.resolve(null),
    [sessionId, selectedUserId],
  )

  const [captureRequest, setCaptureRequest] = useState<CaptureRequest>({ tab: 'progress', nonce: 0 })
  const [showOther, setShowOther] = useState(false)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [force, setForce] = useState(false)
  const [completeNotes, setCompleteNotes] = useState('')
  const [completing, setCompleting] = useState(false)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [followUpNote, setFollowUpNote] = useState('')
  const startedRef = useRef(false)

  const participants = detail.data?.participants ?? []
  const participant = participants.find((item) => item.user.id === selectedUserId)
  const allTasks: WorkspaceTask[] = useMemo(
    () => [...(workspace.data?.needs_attention ?? []), ...(workspace.data?.active ?? []), ...(workspace.data?.other ?? [])],
    [workspace.data],
  )

  useEffect(() => {
    if (!detail.data || selectedUserId) return
    const preferred =
      detail.data.participants.find((item) => !item.reviewed_at && item.pre_meeting_submitted_at) ??
      detail.data.participants.find((item) => !item.reviewed_at) ??
      detail.data.participants[0]
    if (preferred) setSelectedUserId(preferred.user.id)
  }, [detail.data, selectedUserId])

  useEffect(() => {
    if (participant) setFollowUpNote(participant.follow_up_note ?? '')
  }, [participant?.id, participant?.follow_up_note])

  useEffect(() => {
    if (!detail.data || !isManager || startedRef.current) return
    if (detail.data.status === 'draft') {
      startedRef.current = true
      api
        .post<SessionDetail>(`/standups/sessions/${sessionId}/start`)
        .then(() => {
          detail.refresh()
          summary.refresh()
        })
        .catch((caught) => push((caught as Error).message, 'error'))
    }
  }, [detail.data, isManager, sessionId, push])

  useEffect(() => {
    if (detail.data?.status === 'completed') {
      navigate(`/standups/${sessionId}`, { replace: true })
    }
  }, [detail.data?.status, navigate, sessionId])

  function refreshAll() {
    detail.refresh()
    captures.refresh()
    summary.refresh()
    workspace.refresh()
  }

  function capture(tab: CaptureTab, taskId?: string) {
    setCaptureRequest({ tab, taskId, nonce: Date.now() })
  }

  async function toggleReviewed(reviewed: boolean) {
    if (!selectedUserId) return
    setReviewBusy(true)
    try {
      await api.patch(`/standups/sessions/${sessionId}/participants/${selectedUserId}`, { reviewed })
      push(reviewed ? `${participant?.user.full_name ?? 'Participant'} marked reviewed.` : 'Review cleared.')
      if (reviewed) {
        const next = participants.find((item) => item.user.id !== selectedUserId && !item.reviewed_at)
        if (next) setSelectedUserId(next.user.id)
      }
      refreshAll()
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      setReviewBusy(false)
    }
  }

  async function toggleFollowUp() {
    if (!selectedUserId || !participant) return
    try {
      await api.patch(`/standups/sessions/${sessionId}/participants/${selectedUserId}`, {
        follow_up_flagged: !participant.follow_up_flagged,
        follow_up_note: followUpNote.trim() || null,
      })
      refreshAll()
    } catch (caught) {
      push((caught as Error).message, 'error')
    }
  }

  async function saveFollowUpNote() {
    if (!selectedUserId) return
    try {
      await api.patch(`/standups/sessions/${sessionId}/participants/${selectedUserId}`, {
        follow_up_note: followUpNote.trim() || null,
      })
      push('Follow-up note saved.')
      refreshAll()
    } catch (caught) {
      push((caught as Error).message, 'error')
    }
  }

  async function complete() {
    setCompleting(true)
    try {
      await api.post(`/standups/sessions/${sessionId}/complete`, {
        notes: completeNotes.trim() || null,
        force,
      })
      push('Standup completed. Open commitments carry forward automatically.')
      navigate(`/standups/${sessionId}`)
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      setCompleting(false)
    }
  }

  if (!isManager) {
    return (
      <EmptyState
        icon="users"
        title="The live workspace is for the facilitator"
        description="Your tasks and pre-meeting update are on your dashboard."
        action={
          <Link to="/" className="btn btn-primary">
            Go to my dashboard
          </Link>
        }
      />
    )
  }

  if (detail.loading) return <Loading label="Opening the standup workspace…" />
  if (detail.error || !detail.data) {
    return <ErrorBox message={detail.error ?? 'Session not found'} onRetry={detail.refresh} />
  }

  const session = detail.data
  const unreviewed = participants.filter((item) => !item.reviewed_at)
  const currentIndex = participants.findIndex((item) => item.user.id === selectedUserId)
  const percent = participants.length ? Math.round((session.reviewed_count / participants.length) * 100) : 0

  return (
    <div className="flex flex-col gap-3 xl:h-[calc(100vh-6.5rem)]">
      <header className="card flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Link to="/standups" className="btn btn-ghost btn-sm" aria-label="Back to history">
            <Icon name="arrowLeft" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold tracking-tight">{formatDate(session.session_date)} standup</h1>
              <SessionStatusBadge status={session.status} />
            </div>
            <p className="text-[11px] text-slate-400">
              {session.started_at ? `Started ${formatDateTime(session.started_at)}` : 'Starting…'} ·{' '}
              {session.reviewed_count}/{session.participant_count} reviewed
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden w-40 sm:block">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${percent}%` }} />
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={currentIndex <= 0}
              onClick={() => setSelectedUserId(participants[currentIndex - 1]?.user.id ?? null)}
              title="Previous participant"
            >
              <Icon name="chevronLeft" />
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={currentIndex === -1 || currentIndex >= participants.length - 1}
              onClick={() => setSelectedUserId(participants[currentIndex + 1]?.user.id ?? null)}
              title="Next participant"
            >
              <Icon name="chevronRight" />
            </button>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCompleteOpen(true)}>
            <Icon name="check" /> Complete
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-12">
        {/* Left — employee navigation */}
        <aside className="panel min-h-[260px] overflow-hidden xl:col-span-3 xl:min-h-0">
          <ParticipantList
            participants={participants}
            selectedId={selectedUserId}
            onSelect={setSelectedUserId}
          />
        </aside>

        {/* Center — exception-first task workspace */}
        <section className="panel min-h-[420px] overflow-hidden xl:col-span-6 xl:min-h-0">
          {workspace.loading && !workspace.data ? (
            <Loading label="Loading employee workspace…" />
          ) : workspace.error ? (
            <div className="p-4">
              <ErrorBox message={workspace.error} onRetry={workspace.refresh} />
            </div>
          ) : !participant || !workspace.data ? (
            <EmptyState title="Select a participant" icon="users" />
          ) : (
            <>
              <div className="border-b border-slate-200 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={participant.user.full_name} size="lg" />
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">{participant.user.full_name}</h2>
                      <p className="text-[11px] text-slate-400">
                        {participant.pre_meeting_submitted_at
                          ? `Update submitted ${formatDateTime(participant.pre_meeting_submitted_at)}`
                          : 'No pre-meeting update · using existing task state'}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      className={`btn btn-sm ${participant.follow_up_flagged ? 'btn-danger' : 'btn-secondary'}`}
                      onClick={toggleFollowUp}
                    >
                      <Icon name="flag" className="h-3 w-3" />
                      {participant.follow_up_flagged ? 'Follow-up flagged' : 'Flag follow-up'}
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${participant.reviewed_at ? 'btn-secondary' : 'btn-primary'}`}
                      onClick={() => toggleReviewed(!participant.reviewed_at)}
                      disabled={reviewBusy}
                    >
                      {reviewBusy ? <Spinner className="h-3 w-3" /> : <Icon name="check" className="h-3 w-3" />}
                      {participant.reviewed_at ? 'Reviewed' : 'Mark reviewed'}
                    </button>
                  </div>
                </div>

                {participant.follow_up_flagged && (
                  <div className="mt-2 flex gap-1.5">
                    <input
                      className="input py-1 text-xs"
                      placeholder="What needs following up?"
                      value={followUpNote}
                      onChange={(event) => setFollowUpNote(event.target.value)}
                    />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={saveFollowUpNote}>
                      Save
                    </button>
                  </div>
                )}

                {(participant.pre_meeting_progress ||
                  participant.pre_meeting_next_steps ||
                  participant.pre_meeting_blockers) && (
                  <div className="mt-2.5 grid gap-2 rounded-lg bg-slate-50 p-2.5 sm:grid-cols-3">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Progress</p>
                      <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-snug text-slate-700">
                        {participant.pre_meeting_progress || '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Next steps</p>
                      <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-snug text-slate-700">
                        {participant.pre_meeting_next_steps || '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Blockers</p>
                      <p
                        className={`mt-0.5 whitespace-pre-wrap text-[11px] leading-snug ${
                          participant.pre_meeting_blockers ? 'text-rose-700' : 'text-slate-700'
                        }`}
                      >
                        {participant.pre_meeting_blockers || '—'}
                      </p>
                    </div>
                  </div>
                )}

                {(workspace.data.carried_blockers.length > 0 ||
                  workspace.data.carried_action_items.length > 0) && (
                  <details className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5">
                    <summary className="cursor-pointer text-[11px] font-semibold text-amber-800">
                      Carrying forward: {workspace.data.carried_blockers.length} blocker(s),{' '}
                      {workspace.data.carried_action_items.length} follow-up(s)
                    </summary>
                    <div className="mt-1.5 space-y-1">
                      {[...workspace.data.carried_blockers, ...workspace.data.carried_action_items].map((item) => (
                        <div key={`${item.kind}-${item.id}`} className="flex items-start justify-between gap-2 text-[11px]">
                          <span className="min-w-0 flex-1 text-slate-700">
                            <span className={`badge mr-1 ${item.kind === 'blocker' ? 'badge-rose' : 'badge-amber'}`}>
                              {item.kind === 'blocker' ? 'Blocker' : 'Follow-up'}
                            </span>
                            {item.description}
                          </span>
                          <span className="shrink-0 text-[10px] text-slate-400">
                            {item.age_days}d
                            {item.origin_session_date ? ` · ${formatDate(item.origin_session_date)}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                <TaskSection
                  title="Needs attention"
                  tone="rose"
                  tasks={workspace.data.needs_attention}
                  empty="No blocked, overdue or at-risk work. This employee is clear."
                  sessionId={sessionId}
                  recentUpdates={workspace.data.recent_updates}
                  recentDecisions={workspace.data.recent_decisions}
                  onChanged={refreshAll}
                  onCapture={capture}
                />
                <TaskSection
                  title="Active work"
                  tone="indigo"
                  tasks={workspace.data.active}
                  empty="Nothing in progress."
                  sessionId={sessionId}
                  recentUpdates={workspace.data.recent_updates}
                  recentDecisions={workspace.data.recent_decisions}
                  onChanged={refreshAll}
                  onCapture={capture}
                />

                <div>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-500 hover:bg-slate-100"
                    onClick={() => setShowOther((value) => !value)}
                  >
                    <span>
                      Other assignments · {workspace.data.other.length}{' '}
                      <span className="font-normal text-slate-400">(planned, backlog, closed)</span>
                    </span>
                    <Icon name={showOther ? 'chevronDown' : 'chevronRight'} className="h-3.5 w-3.5" />
                  </button>
                  {showOther && (
                    <div className="mt-2 space-y-2">
                      {workspace.data.other.length === 0 ? (
                        <p className="px-1 text-[11px] text-slate-400">No other assignments.</p>
                      ) : (
                        workspace.data.other.map((task) => (
                          <WorkspaceTaskCard
                            key={task.id}
                            task={task}
                            sessionId={sessionId}
                            recentUpdates={workspace.data?.recent_updates ?? []}
                            recentDecisions={workspace.data?.recent_decisions ?? []}
                            onChanged={refreshAll}
                            onCapture={capture}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>

                {allTasks.length === 0 && (
                  <EmptyState
                    title="No tasks assigned"
                    description="There is nothing on this employee's plate. Record a decision or follow-up if new work was agreed."
                    icon="inbox"
                  />
                )}
              </div>
            </>
          )}
        </section>

        {/* Right — meeting capture */}
        <aside className="panel min-h-[480px] overflow-hidden xl:col-span-3 xl:min-h-0">
          <MeetingCapture
            sessionId={sessionId}
            participants={participants}
            tasks={allTasks}
            selectedUserId={selectedUserId}
            captures={captures.data}
            request={captureRequest}
            onCaptured={refreshAll}
            onRequestComplete={() => setCompleteOpen(true)}
          />
        </aside>
      </div>

      <Modal
        open={completeOpen}
        onClose={() => setCompleteOpen(false)}
        title="Complete standup"
        description="Ending the session does not close open commitments — they carry forward."
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setCompleteOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={completing || (unreviewed.length > 0 && !force)}
              onClick={complete}
            >
              {completing ? <Spinner /> : <Icon name="check" />}
              Complete session
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {summary.data && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Reviewed" value={`${summary.data.reviewed_count}/${session.participant_count}`} />
              <Stat label="Updates" value={summary.data.updates} />
              <Stat label="Blockers" value={summary.data.blockers_created} tone="text-rose-600" />
              <Stat label="Follow-ups" value={summary.data.action_items} tone="text-amber-600" />
            </div>
          )}

          {unreviewed.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-800">
                {unreviewed.length} participant(s) not reviewed
              </p>
              <p className="mt-0.5 text-[11px] text-amber-700">
                {unreviewed.map((item) => item.user.full_name).join(', ')}
              </p>
              <label className="mt-2 flex items-center gap-2 text-[11px] font-medium text-amber-800">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(event) => setForce(event.target.checked)}
                  className="h-3.5 w-3.5 rounded border-amber-300"
                />
                Complete anyway
              </label>
            </div>
          )}

          <div>
            <label className="label" htmlFor="session-notes">
              Session notes (optional)
            </label>
            <textarea
              id="session-notes"
              className="textarea"
              value={completeNotes}
              onChange={(event) => setCompleteNotes(event.target.value)}
              placeholder="Context worth preserving beyond the structured records…"
            />
          </div>

          <p className="text-[11px] leading-relaxed text-slate-500">
            The summary is generated from structured records. Unresolved blockers and open follow-ups remain
            visible in subsequent standups until explicitly closed.
          </p>
        </div>
      </Modal>
    </div>
  )
}

function TaskSection({
  title,
  tone,
  tasks,
  empty,
  sessionId,
  recentUpdates,
  recentDecisions,
  onChanged,
  onCapture,
}: {
  title: string
  tone: 'rose' | 'indigo'
  tasks: WorkspaceTask[]
  empty: string
  sessionId: string
  recentUpdates: Workspace['recent_updates']
  recentDecisions: Workspace['recent_decisions']
  onChanged: () => void
  onCapture: (tab: CaptureTab, taskId?: string) => void
}) {
  const toneClass = tone === 'rose' ? 'text-rose-700' : 'text-indigo-700'
  return (
    <section>
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className={`text-[10px] font-bold uppercase tracking-wider ${toneClass}`}>{title}</h3>
        <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-500">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-400">
          {empty}
        </p>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <WorkspaceTaskCard
              key={task.id}
              task={task}
              sessionId={sessionId}
              recentUpdates={recentUpdates}
              recentDecisions={recentDecisions}
              onChanged={onChanged}
              onCapture={onCapture}
            />
          ))}
        </div>
      )}
    </section>
  )
}
