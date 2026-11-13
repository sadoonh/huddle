import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import TaskDialog from '../components/TaskDialog'
import { ResolveBlockerDialog } from '../components/TodayActions'
import CaptureDrawer, { type CaptureType } from '../components/workspace/CaptureDrawer'
import { Icon } from '../components/icons'
import {
  Avatar,
  EmptyState,
  ErrorBox,
  Loading,
  Modal,
  SessionStatusBadge,
  Spinner,
} from '../components/ui'
import { api } from '../lib/api'
import { formatDate, humanize, relativeDay } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import type {
  CarriedItem,
  Participant,
  SessionDetail,
  Workspace,
  WorkspaceTask,
} from '../lib/types'

const reasonLabel: Record<string, string> = {
  blocker: 'Needs help',
  overdue: 'Overdue',
  at_risk: 'At risk',
  follow_up: 'Follow-up',
}

const reasonOrder = ['blocker', 'overdue', 'at_risk', 'follow_up']

export default function WorkspacePage() {
  const { sessionId = '' } = useParams()
  const { isManager } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()

  const detail = useAsync<SessionDetail>(() => api.get(`/standups/sessions/${sessionId}`), [sessionId])
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const workspace = useAsync<Workspace | null>(
    () =>
      selectedUserId
        ? api.get(`/standups/sessions/${sessionId}/participants/${selectedUserId}/workspace`)
        : Promise.resolve(null),
    [sessionId, selectedUserId],
  )

  const [capture, setCapture] = useState<{
    open: boolean
    type: CaptureType
    taskId: string | null
    nonce: number
  }>({ open: false, type: 'progress', taskId: null, nonce: 0 })
  const [captureDirty, setCaptureDirty] = useState(false)
  const [rosterOpen, setRosterOpen] = useState(false)
  const [finishOpen, setFinishOpen] = useState(false)
  const [force, setForce] = useState(false)
  const [notes, setNotes] = useState('')
  const [finishing, setFinishing] = useState(false)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [taskDialogId, setTaskDialogId] = useState<string | null>(null)
  const [resolveBlocker, setResolveBlocker] = useState<{ id: string; description: string } | null>(null)
  const [showOther, setShowOther] = useState(false)
  const [busyItem, setBusyItem] = useState<string | null>(null)

  const participants = detail.data?.participants ?? []
  const participant = participants.find((item) => item.user.id === selectedUserId)
  const selectedIndex = participants.findIndex((item) => item.user.id === selectedUserId)

  const allTasks = useMemo<WorkspaceTask[]>(
    () => [
      ...(workspace.data?.needs_attention ?? []),
      ...(workspace.data?.active ?? []),
      ...(workspace.data?.other ?? []),
    ],
    [workspace.data],
  )
  const allTaskIds = useMemo(
    () =>
      new Set([
        ...(workspace.data?.needs_attention ?? []).map((task) => task.id),
        ...(workspace.data?.active ?? []).map((task) => task.id),
      ]),
    [workspace.data],
  )
  const ownerOptions = useMemo(() => {
    const seen = new Set<string>()
    const options = []
    for (const item of participants) {
      if (!seen.has(item.user.id)) {
        seen.add(item.user.id)
        options.push(item.user)
      }
    }
    const facilitator = detail.data?.facilitator
    if (facilitator && !seen.has(facilitator.id)) options.push(facilitator)
    return options
  }, [participants, detail.data?.facilitator])

  const tasklessBlockers = useMemo(
    () =>
      (workspace.data?.carried_blockers ?? []).filter(
        (item) => !item.task_id || !allTaskIds.has(item.task_id),
      ),
    [workspace.data, allTaskIds],
  )
  const tasklessActions = useMemo(
    () =>
      (workspace.data?.carried_action_items ?? []).filter(
        (item) => !item.task_id || !allTaskIds.has(item.task_id),
      ),
    [workspace.data, allTaskIds],
  )

  useEffect(() => {
    if (!detail.data || selectedUserId) return
    const preferred =
      detail.data.participants.find((item) => !item.reviewed_at && item.has_daily_update) ??
      detail.data.participants.find((item) => !item.reviewed_at) ??
      detail.data.participants[0]
    if (preferred) setSelectedUserId(preferred.user.id)
  }, [detail.data, selectedUserId])

  useEffect(() => {
    if (!detail.data || !isManager) return
    if (detail.data.status === 'draft') {
      api
        .post(`/standups/sessions/${sessionId}/start`)
        .then(() => detail.refresh())
        .catch((caught) => push((caught as Error).message, 'error'))
    }
    // Only run when the session first loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data?.id])

  useEffect(() => {
    if (detail.data?.status === 'completed') {
      navigate(`/standups/${sessionId}`, { replace: true })
    }
  }, [detail.data?.status, navigate, sessionId])

  useEffect(() => {
    if (!lastSaved) return
    const timeout = window.setTimeout(() => setLastSaved(null), 5000)
    return () => window.clearTimeout(timeout)
  }, [lastSaved])

  function refresh() {
    detail.refresh()
    workspace.refresh()
  }

  function selectParticipant(userId: string) {
    if (userId === selectedUserId) return
    if (captureDirty && !window.confirm('Discard the unsaved capture?')) return
    setCapture((current) => ({ ...current, open: false }))
    setCaptureDirty(false)
    setSelectedUserId(userId)
  }

  function openCapture(type: CaptureType, taskId: string | null = null) {
    if (captureDirty && !window.confirm('Discard the current entry and start a new one?')) return
    setCapture({ open: true, type, taskId, nonce: Date.now() })
    setCaptureDirty(false)
  }

  async function markReviewedAndNext() {
    if (!participant) return
    if (captureDirty && !window.confirm('Discard the unsaved capture?')) return
    setCapture((current) => ({ ...current, open: false }))
    setCaptureDirty(false)
    setReviewBusy(true)
    try {
      if (!participant.reviewed_at) {
        await api.patch(`/standups/sessions/${sessionId}/participants/${participant.user.id}`, {
          reviewed: true,
        })
      }
      const next =
        participants.slice(selectedIndex + 1).find((item) => !item.reviewed_at) ??
        participants.find((item) => !item.reviewed_at && item.user.id !== participant.user.id)
      if (next) {
        setSelectedUserId(next.user.id)
      } else {
        push('Everyone is reviewed. You can finish the standup.')
      }
      refresh()
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      setReviewBusy(false)
    }
  }

  async function completeAction(itemId: string) {
    setBusyItem(itemId)
    try {
      await api.patch(`/action-items/${itemId}`, { status: 'completed' })
      push('Follow-up completed.')
      refresh()
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      setBusyItem(null)
    }
  }

  async function finish() {
    setFinishing(true)
    try {
      await api.post(`/standups/sessions/${sessionId}/complete`, {
        notes: notes.trim() || null,
        force,
      })
      navigate(`/standups/${sessionId}`, { replace: true })
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      setFinishing(false)
    }
  }

  if (!isManager) {
    return (
      <EmptyState
        icon="users"
        title="The live meeting is for the facilitator"
        description="Your updates and work are on Today."
        action={<Link to="/" className="btn btn-primary">Go to Today</Link>}
      />
    )
  }

  if (detail.loading) return <Loading label="Opening the standup…" />
  if (detail.error || !detail.data) {
    return <ErrorBox message={detail.error ?? 'Session not found'} onRetry={detail.refresh} />
  }

  const session = detail.data
  const unreviewed = participants.filter((item) => !item.reviewed_at)
  const latestUpdate =
    workspace.data?.daily_update?.progress ?? participant?.pre_meeting_progress ?? null

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link to="/" className="btn btn-ghost btn-sm" aria-label="Exit standup">
              <Icon name="x" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold text-slate-900">Standup</h1>
                <SessionStatusBadge status={session.status} />
              </div>
              <p className="text-xs text-slate-500">
                {formatDate(session.session_date)} · {session.reviewed_count} of {session.participant_count} reviewed
              </p>
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setFinishOpen(true)}>
            <Icon name="check" /> Finish
          </button>
        </div>
        {lastSaved && (
          <div className="border-t border-emerald-100 bg-emerald-50 px-4 py-1.5 text-center text-xs text-emerald-800">
            Saved: {lastSaved}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={selectedIndex <= 0}
            onClick={() => selectParticipant(participants[selectedIndex - 1]?.user.id ?? '')}
            aria-label="Previous person"
          >
            <Icon name="chevronLeft" />
          </button>
          <select
            className="select w-auto min-w-[190px] py-1 text-sm"
            aria-label="Participant"
            value={selectedUserId ?? ''}
            onChange={(event) => selectParticipant(event.target.value)}
          >
            {participants.map((item) => (
              <option key={item.id} value={item.user.id}>
                {item.user.full_name}{item.reviewed_at ? ' ✓' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={selectedIndex < 0 || selectedIndex >= participants.length - 1}
            onClick={() => selectParticipant(participants[selectedIndex + 1]?.user.id ?? '')}
            aria-label="Next person"
          >
            <Icon name="chevronRight" />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRosterOpen(true)}>
            <Icon name="users" /> Roster
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm ml-auto"
            onClick={markReviewedAndNext}
            disabled={reviewBusy || !participant}
          >
            {reviewBusy ? <Spinner /> : <Icon name="arrowRight" />}
            {participant?.reviewed_at ? 'Next' : 'Reviewed & next'}
          </button>
        </div>

        {workspace.loading && !workspace.data ? (
          <Loading label="Loading work…" />
        ) : workspace.error ? (
          <ErrorBox message={workspace.error} onRetry={workspace.refresh} />
        ) : !participant || !workspace.data ? (
          <EmptyState title="Select a person" icon="users" />
        ) : (
          <div className="mt-5 space-y-8">
            <section>
              <div className="flex items-center gap-3">
                <Avatar name={participant.user.full_name} size="lg" />
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{participant.user.full_name}</h2>
                  <p className="text-sm text-slate-500">
                    {latestUpdate ? `Latest update: ${latestUpdate}` : 'No update submitted.'}
                  </p>
                  {workspace.data.daily_update?.next_steps && (
                    <p className="text-xs text-slate-500">Next: {workspace.data.daily_update.next_steps}</p>
                  )}
                </div>
              </div>
            </section>

            <section aria-labelledby="needs-attention-heading">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 id="needs-attention-heading" className="text-base font-semibold text-slate-900">
                  Needs attention
                </h3>
                <span className="text-sm text-slate-500">
                  {workspace.data.needs_attention.length + tasklessBlockers.length + tasklessActions.length}
                </span>
              </div>

              {workspace.data.needs_attention.length === 0 &&
              tasklessBlockers.length === 0 &&
              tasklessActions.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-500">
                  Nothing needs help right now.
                </p>
              ) : (
                <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                  {tasklessBlockers.map((item) => (
                    <CarriedBlockRow
                      key={item.id}
                      item={item}
                      onResolve={() => setResolveBlocker({ id: item.id, description: item.description })}
                    />
                  ))}
                  {workspace.data.needs_attention.map((task) => (
                    <MeetingTaskRow
                      key={task.id}
                      task={task}
                      onOpen={() => setTaskDialogId(task.id)}
                      onUpdate={() => openCapture('progress', task.id)}
                      onHelp={() => openCapture('blocker', task.id)}
                      onAction={() => openCapture('action', task.id)}
                      onDecision={() => openCapture('decision', task.id)}
                      onNote={() => openCapture('note', task.id)}
                    />
                  ))}
                  {tasklessActions.map((item) => (
                    <div key={item.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900">{item.description}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.owner?.full_name ?? 'Unassigned'}
                          {item.due_date ? ` · due ${relativeDay(item.due_date)}` : ''}
                          {item.task_title ? ` · ${item.task_title}` : ' · general follow-up'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busyItem === item.id}
                        onClick={() => completeAction(item.id)}
                      >
                        Done
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="active-heading">
              <h3 id="active-heading" className="mb-2 text-base font-semibold text-slate-900">
                Current work
              </h3>
              {workspace.data.active.length === 0 ? (
                <p className="text-sm text-slate-500">Nothing in progress.</p>
              ) : (
                <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                  {workspace.data.active.map((task) => (
                    <MeetingTaskRow
                      key={task.id}
                      task={task}
                      showStatus
                      onOpen={() => setTaskDialogId(task.id)}
                      onUpdate={() => openCapture('progress', task.id)}
                      onHelp={() => openCapture('blocker', task.id)}
                      onAction={() => openCapture('action', task.id)}
                      onDecision={() => openCapture('decision', task.id)}
                      onNote={() => openCapture('note', task.id)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
                onClick={() => setShowOther((value) => !value)}
              >
                <span>
                  Other assignments · {workspace.data.other.length}
                </span>
                <Icon name={showOther ? 'chevronDown' : 'chevronRight'} />
              </button>
              {showOther && (
                <div className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                  {workspace.data.other.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-slate-500">No other assignments.</p>
                  ) : (
                    workspace.data.other.map((task) => (
                      <MeetingTaskRow
                        key={task.id}
                        task={task}
                        showStatus
                        onOpen={() => setTaskDialogId(task.id)}
                        onUpdate={() => openCapture('progress', task.id)}
                        onHelp={() => openCapture('blocker', task.id)}
                        onAction={() => openCapture('action', task.id)}
                        onDecision={() => openCapture('decision', task.id)}
                        onNote={() => openCapture('note', task.id)}
                      />
                    ))
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      <CaptureDrawer
        key={capture.nonce}
        open={capture.open}
        sessionId={sessionId}
        type={capture.type}
        taskId={capture.taskId}
        participantUserId={selectedUserId}
        participants={participants}
        ownerOptions={ownerOptions}
        tasks={allTasks}
        onClose={() => {
          setCapture((current) => ({ ...current, open: false }))
          setCaptureDirty(false)
        }}
        onSaved={(message) => {
          setCapture((current) => ({ ...current, open: false }))
          setCaptureDirty(false)
          setLastSaved(message)
          push(message)
          refresh()
        }}
        onDirtyChange={setCaptureDirty}
      />

      <RosterModal
        open={rosterOpen}
        participants={participants}
        selectedUserId={selectedUserId}
        onSelect={(userId) => {
          selectParticipant(userId)
          setRosterOpen(false)
        }}
        onClose={() => setRosterOpen(false)}
      />

      <Modal
        open={finishOpen}
        onClose={() => setFinishOpen(false)}
        title="Finish standup"
        description="Open help requests and follow-ups stay open after the meeting."
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setFinishOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={finish}
              disabled={finishing || (unreviewed.length > 0 && !force)}
            >
              {finishing ? <Spinner /> : <Icon name="check" />} Finish
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {unreviewed.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">
                {unreviewed.length} not reviewed
              </p>
              <p className="mt-0.5 text-sm text-amber-800">
                {unreviewed.map((item) => item.user.full_name).join(', ')}
              </p>
              <label className="mt-2 flex items-center gap-2 text-sm text-amber-900">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(event) => setForce(event.target.checked)}
                  className="h-4 w-4 rounded border-amber-300"
                />
                Finish anyway
              </label>
            </div>
          ) : (
            <p className="text-sm text-slate-600">Everyone has been reviewed.</p>
          )}
          <details>
            <summary className="cursor-pointer text-sm font-medium text-slate-600">
              Add session notes (optional)
            </summary>
            <textarea
              className="textarea mt-2"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Anything that does not fit a structured record."
            />
          </details>
        </div>
      </Modal>

      {taskDialogId && (
        <TaskDialog
          taskId={taskDialogId}
          onClose={() => setTaskDialogId(null)}
          onChanged={refresh}
        />
      )}
      {resolveBlocker && (
        <ResolveBlockerDialog
          blockerId={resolveBlocker.id}
          description={resolveBlocker.description}
          onClose={() => setResolveBlocker(null)}
          onSaved={() => {
            setResolveBlocker(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function MeetingTaskRow({
  task,
  showStatus,
  onOpen,
  onUpdate,
  onHelp,
  onAction,
  onDecision,
  onNote,
}: {
  task: WorkspaceTask
  showStatus?: boolean
  onOpen: () => void
  onUpdate: () => void
  onHelp: () => void
  onAction: () => void
  onDecision: () => void
  onNote: () => void
}) {
  const reason = reasonOrder.find((value) => task.reasons.includes(value))
  const blocker = task.open_blockers[0]
  const action = task.open_action_items[0]
  const detail =
    (blocker && blocker.description) ||
    (action && action.description) ||
    task.at_risk_reason ||
    task.latest_update?.progress ||
    null
  const owner =
    (blocker && blocker.owner?.full_name) ||
    (action && action.owner?.full_name) ||
    task.assignee?.full_name
  const extra = task.reasons.filter((value) => reasonOrder.includes(value)).length - (reason ? 1 : 0)

  return (
    <div className="flex flex-wrap items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <button
            type="button"
            className="text-left text-sm font-semibold text-slate-900 hover:text-emerald-700"
            onClick={onOpen}
          >
            {task.title}
          </button>
          {reason && (
            <span className={`text-xs font-medium ${reason === 'at_risk' || reason === 'follow_up' ? 'text-amber-700' : 'text-rose-700'}`}>
              {reasonLabel[reason]}
            </span>
          )}
          {!reason && showStatus && <span className="text-xs text-slate-500">{humanize(task.status)}</span>}
          {extra > 0 && <span className="text-xs text-slate-400">+{extra} more</span>}
        </div>
        {detail && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{detail}</p>}
        <p className="mt-1 text-xs text-slate-500">
          {owner ?? 'Unassigned'}
          {task.due_date ? ` · ${relativeDay(task.due_date)}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onUpdate}>Update</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onHelp}>Needs help</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onAction}>Add follow-up</button>
        <details className="relative">
          <summary className="btn btn-ghost btn-sm list-none [&::-webkit-details-marker]:hidden">
            More <Icon name="chevronDown" className="h-3 w-3" />
          </summary>
          <div className="absolute right-0 z-10 mt-1 w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
            <button type="button" className="block w-full rounded px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={onDecision}>
              Decision
            </button>
            <button type="button" className="block w-full rounded px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={onNote}>
              General note
            </button>
            <button type="button" className="block w-full rounded px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={onOpen}>
              Open details
            </button>
          </div>
        </details>
      </div>
    </div>
  )
}

function CarriedBlockRow({ item, onResolve }: { item: CarriedItem; onResolve: () => void }) {
  return (
    <div className="flex flex-wrap items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="text-sm font-semibold text-slate-900">{item.task_title ?? 'Team blocker'}</p>
          <span className="text-xs font-medium text-rose-700">Needs help</span>
        </div>
        <p className="mt-1 text-sm text-slate-600">{item.description}</p>
        <p className="mt-1 text-xs text-slate-500">
          {item.owner?.full_name ?? 'Unassigned'}
          {item.age_days > 0 ? ` · ${item.age_days}d open` : ''}
          {item.origin_session_date ? ` · raised ${formatDate(item.origin_session_date)}` : ''}
        </p>
      </div>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onResolve}>
        Resolve
      </button>
    </div>
  )
}

function RosterModal({
  open,
  participants,
  selectedUserId,
  onSelect,
  onClose,
}: {
  open: boolean
  participants: Participant[]
  selectedUserId: string | null
  onSelect: (userId: string) => void
  onClose: () => void
}) {
  return (
    <Modal open={open} onClose={onClose} title="Standup roster" description={`${participants.length} people`}>
      <div className="divide-y divide-slate-100">
        {participants.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.user.id)}
            className={`flex w-full items-center gap-3 px-2 py-2.5 text-left hover:bg-slate-50 ${
              item.user.id === selectedUserId ? 'bg-slate-50' : ''
            }`}
          >
            <Avatar name={item.user.full_name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-800">
                {item.user.full_name}
              </span>
              <span className="block text-xs text-slate-500">
                {item.reviewed_at ? 'Reviewed' : item.has_daily_update ? 'Update submitted' : 'No update'}
                {item.open_blocker_count > 0 ? ` · ${item.open_blocker_count} help request(s)` : ''}
              </span>
            </span>
            {item.reviewed_at ? (
              <Icon name="check" className="h-4 w-4 text-emerald-600" />
            ) : (
              <span className="h-2 w-2 rounded-full bg-slate-300" />
            )}
          </button>
        ))}
      </div>
    </Modal>
  )
}
