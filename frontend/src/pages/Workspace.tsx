import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
import { useConfirm } from '../lib/confirm'
import { formatDate, formatDueDate, formatDueDateForStatus, formatOpenAge, formatTime, humanize } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import type {
  CarriedItem,
  Participant,
  SessionDetail,
  User,
  UserBrief,
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
  const confirm = useConfirm()
  const navigate = useNavigate()

  const detail = useAsync<SessionDetail>(() => api.get(`/standups/sessions/${sessionId}`), [sessionId])
  const usersQuery = useAsync<User[]>(() => api.get('/users'), [])
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
  const [captureBusy, setCaptureBusy] = useState(false)
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
  const startedRef = useRef(false)

  const participants = detail.data?.participants ?? []
  const participant = participants.find((item) => item.user.id === selectedUserId)
  const selectedIndex = participants.findIndex((item) => item.user.id === selectedUserId)

  // Never render another person's workspace while the next one loads.
  const activeWorkspace =
    workspace.data &&
    workspace.data.session_id === sessionId &&
    workspace.data.participant.user.id === selectedUserId
      ? workspace.data
      : null

  const allTasks = useMemo<WorkspaceTask[]>(
    () => [
      ...(activeWorkspace?.needs_attention ?? []),
      ...(activeWorkspace?.active ?? []),
      ...(activeWorkspace?.other ?? []),
    ],
    [activeWorkspace],
  )
  const attentionTaskIds = useMemo(
    () =>
      new Set([
        ...(activeWorkspace?.needs_attention ?? []).map((task) => task.id),
        ...(activeWorkspace?.active ?? []).map((task) => task.id),
      ]),
    [activeWorkspace],
  )
  const tasklessBlockers = useMemo(
    () =>
      (activeWorkspace?.carried_blockers ?? []).filter(
        (item) => !item.task_id || !attentionTaskIds.has(item.task_id),
      ),
    [activeWorkspace, attentionTaskIds],
  )
  const tasklessActions = useMemo(
    () =>
      (activeWorkspace?.carried_action_items ?? []).filter(
        (item) => !item.task_id || !attentionTaskIds.has(item.task_id),
      ),
    [activeWorkspace, attentionTaskIds],
  )
  const ownerOptions = useMemo<UserBrief[]>(() => {
    const seen = new Set<string>()
    const options: UserBrief[] = []
    for (const user of usersQuery.data ?? []) {
      if (!seen.has(user.id)) {
        seen.add(user.id)
        options.push(user)
      }
    }
    for (const item of participants) {
      if (!seen.has(item.user.id)) {
        seen.add(item.user.id)
        options.push(item.user)
      }
    }
    const facilitator = detail.data?.facilitator
    if (facilitator && !seen.has(facilitator.id)) options.push(facilitator)
    return options
  }, [usersQuery.data, participants, detail.data?.facilitator])

  useEffect(() => {
    if (!detail.data || selectedUserId) return
    const preferred =
      detail.data.participants.find((item) => !item.reviewed_at && item.has_daily_update) ??
      detail.data.participants.find((item) => !item.reviewed_at) ??
      detail.data.participants[0]
    if (preferred) setSelectedUserId(preferred.user.id)
  }, [detail.data, selectedUserId])

  useEffect(() => {
    if (!detail.data || !isManager || startedRef.current) return
    if (detail.data.status === 'draft') {
      startedRef.current = true
      api
        .post(`/standups/sessions/${sessionId}/start`)
        .then(() => detail.refresh())
        .catch((caught) => push((caught as Error).message, 'error'))
    }
  }, [detail.data, isManager, sessionId, push])

  useEffect(() => {
    if (detail.data?.status === 'completed') {
      navigate(`/standups/${sessionId}`, { replace: true })
    }
  }, [detail.data?.status, navigate, sessionId])

  useEffect(() => {
    if (!lastSaved) return
    const timeout = window.setTimeout(() => setLastSaved(null), 6000)
    return () => window.clearTimeout(timeout)
  }, [lastSaved])

  useEffect(() => {
    if (!captureDirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [captureDirty])

  // SPA Back while a capture draft is open. Push a same-URL guard entry so the
  // browser does not silently leave the meeting; confirm in-app before leaving.
  useEffect(() => {
    if (!captureDirty) return
    const url = window.location.href
    const guardState = { ...(window.history.state ?? {}), __standupDraftGuard: true }
    window.history.pushState(guardState, '', url)
    let prompting = false
    const onPop = () => {
      if (prompting) return
      prompting = true
      void confirm({
        title: 'Discard this entry?',
        description: 'You have unsaved text in the capture panel.',
        confirmLabel: 'Discard and leave',
        cancelLabel: 'Keep editing',
        tone: 'danger',
      }).then((discard) => {
        prompting = false
        if (discard) {
          navigate('/')
        } else {
          window.history.pushState(guardState, '', url)
        }
      })
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (window.history.state?.__standupDraftGuard && window.location.pathname.endsWith('/live')) {
        window.history.back()
      }
    }
  }, [captureDirty, confirm, navigate])

  // Light refresh for review state and late updates. An active draft is never
  // replaced, and we never switch the selected person.
  useEffect(() => {
    if (detail.data?.status !== 'in_progress') return
    const refresh = () => {
      detail.refresh()
      if (!captureDirty) workspace.refresh()
    }
    const interval = window.setInterval(refresh, 20000)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data?.status, captureDirty, selectedUserId])

  function refresh() {
    detail.refresh()
    workspace.refresh()
  }

  async function confirmDiscard(): Promise<boolean> {
    if (!captureDirty) return true
    return confirm({
      title: 'Discard this entry?',
      description: 'You have unsaved text in the capture panel.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      tone: 'danger',
    })
  }

  function blockWhileBusy(): boolean {
    if (!captureBusy) return false
    push('A save is in progress. Wait for it to finish.', 'info')
    return true
  }

  async function selectParticipant(userId: string) {
    if (!userId || userId === selectedUserId) return
    if (blockWhileBusy()) return
    if (!(await confirmDiscard())) return
    setCapture((current) => ({ ...current, open: false }))
    setCaptureDirty(false)
    setSelectedUserId(userId)
  }

  async function openCapture(type: CaptureType, taskId: string | null = null) {
    if (blockWhileBusy()) return
    if (!(await confirmDiscard())) return
    setCapture({ open: true, type, taskId, nonce: Date.now() })
    setCaptureDirty(false)
  }

  async function requestCloseCapture() {
    if (blockWhileBusy()) return
    if (!(await confirmDiscard())) return
    setCapture((current) => ({ ...current, open: false }))
    setCaptureDirty(false)
  }

  async function requestExit() {
    if (blockWhileBusy()) return
    if (!(await confirmDiscard())) return
    navigate('/')
  }

  async function markReviewedAndNext() {
    if (!participant) return
    if (blockWhileBusy()) return
    if (!(await confirmDiscard())) return
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
        push('Everyone is reviewed. Finish the standup when you are ready.')
      }
      refresh()
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      setReviewBusy(false)
    }
  }

  async function undoReview(userId: string) {
    try {
      await api.patch(`/standups/sessions/${sessionId}/participants/${userId}`, { reviewed: false })
      push('Review cleared.')
      refresh()
    } catch (caught) {
      push((caught as Error).message, 'error')
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
        action={<button type="button" className="btn btn-primary" onClick={() => navigate('/')}>Go to Today</button>}
      />
    )
  }

  if (detail.loading && !detail.data) return <Loading label="Opening the standup…" />
  if (detail.error || !detail.data) {
    return <ErrorBox message={detail.error ?? 'Session not found'} onRetry={detail.refresh} />
  }

  const session = detail.data
  const unreviewed = participants.filter((item) => !item.reviewed_at)
  const canAdvance =
    participant && !participant.reviewed_at
      ? true
      : participants.some((item) => !item.reviewed_at && item.user.id !== selectedUserId)
  const latest = latestParticipantUpdate(activeWorkspace, participant)

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <button type="button" className="btn btn-ghost btn-sm" onClick={requestExit}>
              <Icon name="arrowLeft" /> Back to Today
            </button>
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
          {unreviewed.length > 0 ? (
            <button type="button" className="btn btn-secondary" onClick={() => setFinishOpen(true)}>
              <Icon name="check" /> Finish
            </button>
          ) : (
            <span className="text-sm text-emerald-700">Everyone reviewed</span>
          )}
        </div>
        {lastSaved && (
          <div className="border-t border-emerald-100 bg-emerald-50 px-4 py-1.5 text-center text-xs text-emerald-800">
            Saved: {lastSaved}{' '}
            <a href={`/standups/${sessionId}#meeting-details`} className="font-medium underline">
              View entry
            </a>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5">
        {unreviewed.length === 0 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-sm text-emerald-900">
              Everyone has been reviewed. Finish the standup when you are ready.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => setFinishOpen(true)}>
              <Icon name="check" /> Finish standup
            </button>
          </div>
        )}

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
            className="select w-auto min-w-[190px] py-1.5 text-sm"
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
            disabled={reviewBusy || !participant || !canAdvance}
          >
            {reviewBusy ? <Spinner /> : <Icon name="arrowRight" />}
            {!participant?.reviewed_at
              ? 'Mark reviewed & next'
              : participants.some((item) => !item.reviewed_at)
                ? 'Next unreviewed'
                : 'Everyone reviewed'}
          </button>
        </div>

        {workspace.loading && !activeWorkspace ? (
          <Loading label="Loading this person’s work…" />
        ) : workspace.error ? (
          <ErrorBox message={workspace.error} onRetry={workspace.refresh} />
        ) : !participant || !activeWorkspace ? (
          <Loading label="Loading this person’s work…" />
        ) : (
          <div className="mt-5 space-y-7">
            <section>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Avatar name={participant.user.full_name} size="lg" />
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{participant.user.full_name}</h2>
                    <p className="text-sm text-slate-500">
                      {latest
                        ? `Latest update: ${latest.text}`
                        : 'No daily note or task update submitted.'}
                    </p>
                    {latest && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {latest.label} · {latest.at ? formatTime(latest.at) : 'time unavailable'}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => openCapture('action', null)}>
                    Add follow-up
                  </button>
                  <details className="relative">
                    <summary className="btn btn-secondary btn-sm list-none [&::-webkit-details-marker]:hidden">
                      More <Icon name="chevronDown" className="h-3 w-3" />
                    </summary>
                    <div
                      className="absolute right-0 z-10 mt-1 w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest('button')) {
                          event.currentTarget.closest('details')?.removeAttribute('open')
                        }
                      }}
                    >
                      <button type="button" className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={() => openCapture('blocker', null)}>
                        Ask for help
                      </button>
                      <button type="button" className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={() => openCapture('decision', null)}>
                        Record decision
                      </button>
                      <button type="button" className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={() => openCapture('note', null)}>
                        General note
                      </button>
                    </div>
                  </details>
                </div>
              </div>
            </section>

            <section aria-labelledby="needs-attention-heading">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 id="needs-attention-heading" className="text-base font-semibold text-slate-900">
                  Needs attention
                </h3>
                <span className="text-sm text-slate-500">
                  {activeWorkspace.needs_attention.length + tasklessBlockers.length + tasklessActions.length}{' '}
                  items
                </span>
              </div>

              {activeWorkspace.needs_attention.length === 0 &&
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
                  {activeWorkspace.needs_attention.map((task) => (
                    <MeetingTaskRow
                      key={task.id}
                      task={task}
                      onOpen={() => setTaskDialogId(task.id)}
                      onUpdate={() => openCapture('progress', task.id)}
                      onHelp={() => openCapture('blocker', task.id)}
                      onAction={() => openCapture('action', task.id)}
                      onDecision={() => openCapture('decision', task.id)}
                      onNote={() => openCapture('note', task.id)}
                      onResolve={(blockerId, description) => setResolveBlocker({ id: blockerId, description })}
                      onDone={(itemId) => completeAction(itemId)}
                      busyItem={busyItem}
                    />
                  ))}
                  {tasklessActions.map((item) => (
                    <div key={item.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900">{item.description}</p>
                        <p className="mt-1 text-sm text-slate-600">
                          {item.task_title ?? 'General follow-up'}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {ownerLine(item.owner, 'Assigned to')}
                          {item.due_date ? ` · ${formatDueDate(item.due_date)}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busyItem === item.id}
                        onClick={() => completeAction(item.id)}
                      >
                        Mark done
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
              {activeWorkspace.active.length === 0 ? (
                <p className="text-sm text-slate-500">No active work.</p>
              ) : (
                <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                  {activeWorkspace.active.map((task) => (
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
                      onResolve={(blockerId, description) => setResolveBlocker({ id: blockerId, description })}
                      onDone={(itemId) => completeAction(itemId)}
                      busyItem={busyItem}
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
                <span>Other assignments · {activeWorkspace.other.length}</span>
                <Icon name={showOther ? 'chevronDown' : 'chevronRight'} />
              </button>
              {showOther && (
                <div className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                  {activeWorkspace.other.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-slate-500">No other assignments.</p>
                  ) : (
                    activeWorkspace.other.map((task) => (
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
                        onResolve={(blockerId, description) => setResolveBlocker({ id: blockerId, description })}
                        onDone={(itemId) => completeAction(itemId)}
                        busyItem={busyItem}
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
        onClose={requestCloseCapture}
        onSaved={(message) => {
          setCapture((current) => ({ ...current, open: false }))
          setCaptureDirty(false)
          setLastSaved(message)
          refresh()
        }}
        onDirtyChange={setCaptureDirty}
        onBusyChange={setCaptureBusy}
      />

      <RosterModal
        open={rosterOpen}
        participants={participants}
        selectedUserId={selectedUserId}
        onSelect={(userId) => {
          void selectParticipant(userId).then(() => setRosterOpen(false))
        }}
        onUnreview={undoReview}
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
              {finishing ? <Spinner /> : <Icon name="check" />} Finish standup
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

function latestParticipantUpdate(
  workspace: Workspace | null,
  participant: Participant | undefined,
): { label: string; text: string; at: string | null } | null {
  if (!workspace || !participant) return null
  const candidates: { label: string; text: string; at: string | null }[] = []
  if (workspace.daily_update) {
    candidates.push({
      label: 'Daily note',
      text: workspace.daily_update.progress,
      at: workspace.daily_update.updated_at,
    })
  }
  const taskUpdate = workspace.recent_updates[0]
  if (taskUpdate) {
    candidates.push({
      label: taskUpdate.task_title ? `Task update · ${taskUpdate.task_title}` : 'Task update',
      text: taskUpdate.progress,
      at: taskUpdate.created_at,
    })
  }
  if (participant.pre_meeting_submitted_at && participant.pre_meeting_progress) {
    candidates.push({
      label: 'Pre-meeting note',
      text: participant.pre_meeting_progress,
      at: participant.pre_meeting_submitted_at,
    })
  }
  if (candidates.length === 0) return null
  return candidates.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))[0]
}

function ownerLine(owner: UserBrief | null, label: string): string {
  return owner ? `${label}: ${owner.full_name}` : `${label}: Unassigned — needs an owner`
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
  onResolve,
  onDone,
  busyItem,
}: {
  task: WorkspaceTask
  showStatus?: boolean
  onOpen: () => void
  onUpdate: () => void
  onHelp: () => void
  onAction: () => void
  onDecision: () => void
  onNote: () => void
  onResolve: (blockerId: string, description: string) => void
  onDone: (itemId: string) => void
  busyItem: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const reason = reasonOrder.find((value) => task.reasons.includes(value))
  const blocker = task.open_blockers[0]
  const action = task.open_action_items[0]
  const detail =
    (reason === 'blocker' && blocker?.description) ||
    (reason === 'follow_up' && action?.description) ||
    task.at_risk_reason ||
    task.latest_update?.progress ||
    null
  const owner = blocker?.owner ?? action?.owner ?? task.assignee
  const ownerLabel =
    reason === 'blocker' ? 'Help owner' : reason === 'follow_up' ? 'Assigned to' : 'Task owner'
  const otherIssues =
    task.open_blockers.length +
    task.open_action_items.length +
    (task.is_overdue ? 1 : 0) +
    (task.is_at_risk ? 1 : 0) -
    (reason ? 1 : 0)

  return (
    <div className="px-4 py-3" data-task-id={task.id}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <button
              type="button"
              className="text-left text-sm font-semibold text-slate-900 hover:text-emerald-700"
              onClick={onOpen}
            >
              {task.title}
            </button>
            {reason ? (
              <span className={`text-xs font-medium ${reason === 'at_risk' || reason === 'follow_up' ? 'text-amber-700' : 'text-rose-700'}`}>
                {reasonLabel[reason]}
              </span>
            ) : showStatus ? (
              <span className="text-xs text-slate-500">{humanize(task.status)}</span>
            ) : null}
            {otherIssues > 0 && (
              <button
                type="button"
                className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
              >
                {otherIssues} other issue{otherIssues === 1 ? '' : 's'}
              </button>
            )}
          </div>
          {detail && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{detail}</p>}
          <p className="mt-1 text-xs text-slate-500">
            {ownerLine(owner, ownerLabel)}
            {task.due_date ? ` · ${formatDueDateForStatus(task.due_date, task.status === 'done' || task.status === 'canceled')}` : ''}
          </p>

          {expanded && (
            <div className="mt-2 space-y-1.5 rounded-lg bg-slate-50 p-2.5">
              {task.open_blockers.map((item) => (
                <div key={item.id} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                  <div>
                    <p className="text-slate-700">{item.description}</p>
                    <p className="text-xs text-slate-500">
                      {ownerLine(item.owner, 'Help owner')} · {item.age_days}d open
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onResolve(item.id, item.description)}
                  >
                    Resolve
                  </button>
                </div>
              ))}
              {task.open_action_items.map((item) => (
                <div key={item.id} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                  <div>
                    <p className="text-slate-700">{item.description}</p>
                    <p className="text-xs text-slate-500">
                      {ownerLine(item.owner, 'Assigned to')}
                      {item.due_date ? ` · ${formatDueDateForStatus(item.due_date, item.status === 'completed' || item.status === 'canceled')}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busyItem === item.id}
                    onClick={() => onDone(item.id)}
                  >
                    Mark done
                  </button>
                </div>
              ))}
              {task.is_overdue && (
                <p className="text-xs text-rose-700">
                  Overdue{task.due_date ? ` · ${formatDueDateForStatus(task.due_date, task.status === 'done' || task.status === 'canceled')}` : ''}
                </p>
              )}
              {task.is_at_risk && (
                <p className="text-xs text-amber-700">{task.at_risk_reason ?? 'Flagged as at risk'}</p>
              )}
            </div>
          )}
        </div>

        <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:shrink-0">
          {reason === 'blocker' && (
            <>
              {task.open_blockers.length === 1 && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onResolve(blocker.id, blocker.description)}
                >
                  Resolve
                </button>
              )}
              <button type="button" className="btn btn-primary btn-sm" onClick={onOpen}>
                Review help
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onHelp}>
                Report another issue
              </button>
            </>
          )}
          {reason === 'follow_up' && action && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busyItem === action.id}
              onClick={() => onDone(action.id)}
            >
              Mark done
            </button>
          )}
          {(reason === 'overdue' || reason === 'at_risk' || !reason) && (
            <button type="button" className="btn btn-primary btn-sm" onClick={onUpdate}>
              Update
            </button>
          )}
          {reason !== 'blocker' && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onHelp}>
              Ask for help
            </button>
          )}
          <details className="relative">
            <summary className="btn btn-ghost btn-sm list-none [&::-webkit-details-marker]:hidden">
              More <Icon name="chevronDown" className="h-3 w-3" />
            </summary>
            <div
              className="absolute right-0 z-10 mt-1 w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
              onClick={(event) => {
                if ((event.target as HTMLElement).closest('button')) {
                  event.currentTarget.closest('details')?.removeAttribute('open')
                }
              }}
            >
              <button type="button" className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={onUpdate}>
                Add update
              </button>
              <button type="button" className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={onAction}>
                Add follow-up
              </button>
              <button type="button" className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={onDecision}>
                Record decision
              </button>
              <button type="button" className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={onNote}>
                General note
              </button>
            </div>
          </details>
        </div>
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
          {ownerLine(item.owner, 'Help owner')}
          {item.age_days > 0 ? ` · ${formatOpenAge(item.age_days)}` : ''}
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
  onUnreview,
  onClose,
}: {
  open: boolean
  participants: Participant[]
  selectedUserId: string | null
  onSelect: (userId: string) => void
  onUnreview: (userId: string) => void
  onClose: () => void
}) {
  return (
    <Modal open={open} onClose={onClose} title="Standup roster" description={`${participants.length} people`}>
      <div className="divide-y divide-slate-100">
        {participants.map((item) => (
          <div key={item.id} className="flex items-center gap-2 px-2 py-2.5">
            <button
              type="button"
              onClick={() => onSelect(item.user.id)}
              className={`flex min-w-0 flex-1 items-center gap-3 rounded px-1 py-1 text-left hover:bg-slate-50 ${
                item.user.id === selectedUserId ? 'bg-slate-50' : ''
              }`}
            >
              <Avatar name={item.user.full_name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-800">{item.user.full_name}</span>
                <span className="block text-xs text-slate-500">
                  {item.reviewed_at
                    ? 'Reviewed'
                    : item.has_daily_update
                      ? 'Update submitted'
                      : 'No daily update'}
                  {item.open_blocker_count > 0 ? ` · ${item.open_blocker_count} help request(s)` : ''}
                </span>
              </span>
            </button>
            {item.reviewed_at && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onUnreview(item.user.id)}
              >
                Undo review
              </button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}
