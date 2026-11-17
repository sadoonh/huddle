import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import AccountMenu from '../components/AccountMenu'
import TaskDialog from '../components/TaskDialog'
import TaskCard from '../components/work/TaskCard'
import ParticipantNavigator from '../components/workspace/ParticipantNavigator'
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
import { formatDate, formatTime, humanize } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { statusTextClass } from '../lib/taskDisplay'
import type { Participant, SessionDetail, Workspace, WorkspaceTask } from '../lib/types'

type Group = 'in_progress' | 'todo' | 'blocked'

const GROUP_LABELS: Record<Group, string> = {
  in_progress: 'In Progress',
  todo: 'To Do',
  blocked: 'Blocked',
}

export default function WorkspacePage() {
  const { sessionId = '' } = useParams()
  const { isManager, me, mode, refresh: refreshSession } = useAuth()
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

  const [finishOpen, setFinishOpen] = useState(false)
  const [force, setForce] = useState(false)
  const [notes, setNotes] = useState('')
  const [finishing, setFinishing] = useState(false)
  const [reviewBusy, setReviewBusy] = useState(false)
  const reviewBusyRef = useRef(false)
  const [taskDialogId, setTaskDialogId] = useState<string | null>(null)
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

  const groups = useMemo(() => {
    const active = activeWorkspace?.active ?? []
    return {
      inProgress: active.filter((task) => task.status === 'in_progress'),
      todo: active.filter((task) => task.status === 'todo' || task.status === 'backlog'),
      blocked: activeWorkspace?.needs_attention ?? [],
      done: (activeWorkspace?.other ?? []).filter((task) => task.status === 'done'),
    }
  }, [activeWorkspace])

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

  // Light refresh for review state and late updates.
  useEffect(() => {
    if (detail.data?.status !== 'in_progress') return
    const refresh = () => {
      detail.refresh()
      workspace.refresh()
    }
    const interval = window.setInterval(refresh, 20000)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data?.status, selectedUserId])

  // Plain Tab cycles participants on the manager Huddle page only. Shift+Tab
  // remains the normal backwards escape; editing fields and open overlays keep
  // their native focus behavior.
  useEffect(() => {
    if (!isManager) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Tab' ||
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.isComposing ||
        event.keyCode === 229
      ) {
        return
      }
      const active = document.activeElement
      if (
        active instanceof HTMLElement &&
        (active.isContentEditable ||
          active.closest(
            'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
          ))
      ) {
        return
      }
      if (
        document.body.hasAttribute('data-popover-open') ||
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-morph-tray]',
        )
      ) {
        return
      }
      if (participants.length === 0) return
      event.preventDefault()
      if (event.repeat || reviewBusyRef.current) return
      const nextIndex =
        selectedIndex < 0 ? 0 : (selectedIndex + 1) % participants.length
      const next = participants[nextIndex]
      if (!next) return
      void selectParticipant(next.user.id)
      window.requestAnimationFrame(() => {
        document
          .getElementById(`participant-tab-${next.user.id}`)
          ?.focus({ preventScroll: true })
      })
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager, participants, selectedIndex])

  function refresh() {
    detail.refresh()
    workspace.refresh()
  }

  async function selectParticipant(userId: string) {
    if (reviewBusyRef.current || !userId || userId === selectedUserId) return
    setSelectedUserId(userId)
  }

  function requestExit() {
    navigate('/tasks')
  }

  async function markReviewedAndNext() {
    if (!participant || reviewBusyRef.current || isCompleted || !activeWorkspace) return
    reviewBusyRef.current = true
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
        push('Everyone is reviewed. Finish the Huddle when you are ready.')
      }
      refresh()
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      reviewBusyRef.current = false
      setReviewBusy(false)
    }
  }

  async function markUnreviewed() {
    if (
      !participant ||
      reviewBusyRef.current ||
      isCompleted ||
      !participant.reviewed_at ||
      !activeWorkspace
    )
      return
    reviewBusyRef.current = true
    setReviewBusy(true)
    try {
      await api.patch(`/standups/sessions/${sessionId}/participants/${participant.user.id}`, {
        reviewed: false,
      })
      push('Review cleared.')
      refresh()
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      reviewBusyRef.current = false
      setReviewBusy(false)
    }
  }

  async function finish() {
    setFinishing(true)
    try {
      await api.post(`/standups/sessions/${sessionId}/complete`, {
        notes: notes.trim() || null,
        force,
      })
      navigate('/tasks', { replace: true })
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
        description="Your updates and work are on Tasks."
        action={<button type="button" className="btn btn-primary" onClick={() => navigate('/')}>Go to Tasks</button>}
      />
    )
  }

  if (detail.loading && !detail.data) return <Loading label="Opening the Huddle…" />
  if (detail.error || !detail.data) {
    return <ErrorBox message={detail.error ?? 'Session not found'} onRetry={detail.refresh} />
  }

  const session = detail.data
  const isCompleted = session.status === 'completed'
  const unreviewed = participants.filter((item) => !item.reviewed_at)
  const canAdvance =
    participant && !participant.reviewed_at
      ? true
      : participants.some((item) => !item.reviewed_at && item.user.id !== selectedUserId)
  const latest = latestParticipantUpdate(activeWorkspace, participant)
  const reviewedPercent =
    session.participant_count > 0
      ? Math.round((session.reviewed_count / session.participant_count) * 100)
      : 0
  const participantPanelId = 'huddle-participant-workspace'

  return (
    <div className="min-h-screen bg-canvas">
      <header className="brand-header">
        <div className="relative z-10 mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-[26px]">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="brand-nav-item brand-nav-idle flex items-center gap-1.5"
              onClick={requestExit}
            >
              <Icon name="arrowLeft" className="h-4 w-4" />
              <span className="hidden sm:inline">Back to Tasks</span>
              <span className="sm:hidden">Tasks</span>
            </button>
            <span className="brand-wordmark hidden text-[26px] sm:inline-flex" aria-hidden="true">
              ne<span className="text-signal">x</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!isCompleted &&
              (unreviewed.length > 0 ? (
                <button
                  type="button"
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-control border border-charcoal-border bg-white/5 px-3.5 text-sm font-medium text-white transition-colors duration-140 hover:bg-white/10"
                  onClick={() => setFinishOpen(true)}
                >
                  <Icon name="check" /> Finish
                </button>
              ) : (
                <span className="text-sm font-medium text-signal">Everyone reviewed</span>
              ))}
            {me && <AccountMenu me={me} mode={mode} onRefresh={refreshSession} />}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-5">
        {!isCompleted && unreviewed.length === 0 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent-tint px-4 py-3">
            <p className="text-sm text-accent">
              Everyone has been reviewed. Finish the Huddle when you are ready.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => setFinishOpen(true)}>
              <Icon name="check" /> Finish Huddle
            </button>
          </div>
        )}

        <section className="mb-0 rounded-t-card border border-b-0 border-hairline bg-raised shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-3.5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">Huddle</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <h1 className="font-heading text-xl font-bold tracking-[-0.02em] text-ink">
                  {formatDate(session.session_date)}
                </h1>
                <SessionStatusBadge status={session.status} />
              </div>
            </div>
            <div className="w-full min-w-[170px] max-w-[250px] sm:w-auto">
              <div className="flex items-baseline justify-between gap-3 text-xs text-ink-muted">
                <span>Reviewed</span>
                <span className="tabular font-semibold text-ink">
                  {session.reviewed_count} of {session.participant_count}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="Participants reviewed"
                aria-valuemin={0}
                aria-valuemax={session.participant_count}
                aria-valuenow={session.reviewed_count}
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-recessed"
              >
                <span
                  className="block h-full rounded-full bg-accent transition-[width] duration-220"
                  style={{ width: `${reviewedPercent}%` }}
                />
              </div>
            </div>
          </div>
          {participants.length > 0 && (
            <div className="border-t border-hairline bg-recessed px-3 pt-2.5">
              <ParticipantNavigator
                participants={participants}
                selectedUserId={selectedUserId}
                panelId={participantPanelId}
                disabled={reviewBusy}
                onSelect={(userId) => void selectParticipant(userId)}
              />
            </div>
          )}
        </section>

        <div
          id={participantPanelId}
          role="tabpanel"
          aria-labelledby={selectedUserId ? `participant-tab-${selectedUserId}` : undefined}
          aria-busy={
            participants.length > 0 && workspace.loading && !activeWorkspace ? true : undefined
          }
          tabIndex={0}
          className="overflow-hidden rounded-b-card border border-t-0 border-hairline bg-raised focus:outline-none"
        >
          {participants.length === 0 ? (
            <div className="px-4 py-5">
              <EmptyState
                icon="users"
                title="No participants in this Huddle"
                description="There is nobody to review in this session."
              />
            </div>
          ) : workspace.loading && !activeWorkspace ? (
            <div className="px-4 py-5">
              <Loading label="Loading this person’s work…" />
            </div>
          ) : workspace.error ? (
            <div className="px-4 py-5">
              <ErrorBox message={workspace.error} onRetry={workspace.refresh} />
            </div>
          ) : !participant || !activeWorkspace ? (
            <div className="px-4 py-5">
              <Loading label="Loading this person’s work…" />
            </div>
          ) : (
            <>
            <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 basis-full [overflow-wrap:anywhere] sm:basis-0">
                <p className="break-words text-sm text-ink-muted [overflow-wrap:anywhere]">
                  {latest ? latest.text : 'No task update submitted.'}
                </p>
                {latest && (
                  <p className="mt-0.5 text-xs text-ink-subtle">
                    {latest.label} · {latest.at ? formatTime(latest.at) : 'time unavailable'}
                  </p>
                )}
              </div>
              <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:items-end">
                {participant.reviewed_at && (
                  <p className="w-full text-xs text-ink-subtle sm:w-auto">
                    Reviewed
                    {participant.reviewed_by ? ` by ${participant.reviewed_by.full_name}` : ''}
                    {' · '}
                    {formatTime(participant.reviewed_at)}
                  </p>
                )}
                {!isCompleted && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {participant.reviewed_at && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void markUnreviewed()}
                        disabled={reviewBusy || !activeWorkspace}
                      >
                        Mark unreviewed
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={markReviewedAndNext}
                      disabled={reviewBusy || !canAdvance || !activeWorkspace}
                    >
                      {reviewBusy ? <Spinner /> : <Icon name="arrowRight" />}
                      {!participant.reviewed_at
                        ? 'Mark reviewed & next'
                        : participants.some((item) => !item.reviewed_at)
                          ? 'Next unreviewed'
                          : 'Everyone reviewed'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-hairline bg-recessed/30 p-3 sm:p-4">
            <div className="overflow-x-auto pb-3">
              <div className="flex min-w-full items-stretch gap-4">
                <div className="flex min-w-[280px] max-w-[360px] flex-1 flex-col">
                  <HuddleColumn
                    group="in_progress"
                    label="In Progress"
                    tasks={groups.inProgress}
                    onOpen={(task) => setTaskDialogId(task.id)}
                  />
                </div>
                <div className="flex min-w-[280px] max-w-[360px] flex-1 flex-col">
                  <HuddleColumn
                    group="todo"
                    label="To Do"
                    tasks={groups.todo}
                    onOpen={(task) => setTaskDialogId(task.id)}
                  />
                </div>
                <div className="flex min-w-[280px] max-w-[360px] flex-1 flex-col">
                  <HuddleColumn
                    group="blocked"
                    label="Blocked"
                    tasks={groups.blocked}
                    onOpen={(task) => setTaskDialogId(task.id)}
                  />
                </div>
                <div className="flex min-w-[280px] max-w-[360px] flex-1 flex-col">
                  <DoneColumn tasks={groups.done} onOpen={(task) => setTaskDialogId(task.id)} />
                </div>
              </div>
            </div>
            </div>
            </>
          )}
        </div>
      </main>

      <Modal
        open={finishOpen}
        onClose={() => setFinishOpen(false)}
        title="Finish Huddle"
        description="This closes the live meeting. Updates stay on their tasks."
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
              {finishing ? <Spinner /> : <Icon name="check" />} Finish Huddle
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {unreviewed.length > 0 ? (
            <div className="rounded-lg border border-warning/30 bg-warning-tint p-3">
              <p className="text-sm font-medium text-warning">{unreviewed.length} not reviewed</p>
              <p className="mt-0.5 text-sm text-warning">
                {unreviewed.map((item) => item.user.full_name).join(', ')}
              </p>
              <label className="mt-2 flex items-center gap-2 text-sm text-warning">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(event) => setForce(event.target.checked)}
                  className="h-4 w-4 rounded border-warning/40"
                />
                Finish anyway
              </label>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Everyone has been reviewed.</p>
          )}
          <details>
            <summary className="cursor-pointer text-sm font-medium text-ink-muted">
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

const GROUP_DOT: Record<Group, string> = {
  in_progress: 'bg-accent',
  todo: 'bg-info',
  blocked: 'bg-danger',
}

const GROUP_TEXT: Record<Group, string> = {
  in_progress: statusTextClass('in_progress'),
  todo: statusTextClass('todo'),
  blocked: 'text-danger',
}

function HuddleColumn({
  group,
  label,
  tasks,
  onOpen,
}: {
  group: Group
  label: string
  tasks: WorkspaceTask[]
  onOpen: (task: WorkspaceTask) => void
}) {
  return (
    <section
      data-lane-status={group}
      aria-label={`${label} column`}
      className="lane flex w-full min-w-0 flex-1 flex-col"
    >
      <header className="flex items-center justify-between gap-2 rounded-t-card border-b border-hairline bg-recessed/95 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${GROUP_DOT[group]}`} aria-hidden="true" />
          <h2 className={`truncate text-sm font-semibold ${GROUP_TEXT[group]}`}>{label}</h2>
          <span className="tabular rounded-full bg-raised/80 px-1.5 py-0.5 text-[11px] font-semibold text-ink-muted">
            {tasks.length}
          </span>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-2.5">
        {tasks.length === 0 ? (
          <div className="rounded-md border border-dashed border-hairline bg-raised/40 px-3 py-6 text-center">
            <p className="text-xs font-medium text-ink-muted">
              {group === 'blocked'
                ? 'Nothing blocked'
                : group === 'todo'
                  ? 'Nothing queued'
                  : 'Nothing in flight'}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
              {group === 'blocked'
                ? 'Blocked work appears here.'
                : group === 'todo'
                  ? 'Committed work appears here.'
                  : 'Work that starts appears here.'}
            </p>
          </div>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              showProject
              canMove={false}
              pending={false}
              selected={false}
              lifted={false}
              liftingStatus={null}
              onOpen={(task) => onOpen(task as WorkspaceTask)}
              onPointerDragStart={() => {}}
              onKeyboardKeyDown={() => {}}
            />
          ))
        )}
      </div>
    </section>
  )
}

function DoneColumn({
  tasks,
  onOpen,
}: {
  tasks: WorkspaceTask[]
  onOpen: (task: WorkspaceTask) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <section
      data-lane-status="done"
      aria-label="Done column"
      className="lane flex w-full min-w-0 flex-1 flex-col"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center justify-between gap-2 rounded-t-card border-b border-hairline bg-recessed/95 px-3.5 py-2.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
          <span className={`truncate text-sm font-semibold ${statusTextClass('done')}`}>Done</span>
          <span className="tabular rounded-full bg-raised/80 px-1.5 py-0.5 text-[11px] font-semibold text-ink-muted">
            {tasks.length}
          </span>
        </span>
        <Icon
          name="chevronDown"
          className={`h-4 w-4 shrink-0 text-ink-muted transition-transform duration-140 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-2.5">
          {tasks.length === 0 ? (
            <div className="rounded-md border border-dashed border-hairline bg-raised/40 px-3 py-6 text-center">
              <p className="text-xs font-medium text-ink-muted">Nothing completed yet</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
                Completed work arrives here.
              </p>
            </div>
          ) : (
            tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                showProject
                canMove={false}
                pending={false}
                selected={false}
                lifted={false}
                liftingStatus={null}
                onOpen={(task) => onOpen(task as WorkspaceTask)}
                onPointerDragStart={() => {}}
                onKeyboardKeyDown={() => {}}
              />
            ))
          )}
        </div>
      )}
    </section>
  )
}
