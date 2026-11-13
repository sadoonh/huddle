import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import TaskDialog from '../components/TaskDialog'
import { NeedsHelpDialog, ResolveBlockerDialog, UpdateDialog } from '../components/TodayActions'
import { Icon } from '../components/icons'
import {
  DueDate,
  EmptyState,
  ErrorBox,
  Loading,
  PageHeader,
  Spinner,
  StatusBadge,
} from '../components/ui'
import { api } from '../lib/api'
import { formatDate, relativeDay } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import {
  TASK_STATUSES,
  type AttentionItem,
  type Page,
  type Task,
  type TaskDetail,
  type TaskStatus,
  type TodayData,
  type User,
} from '../lib/types'

const reasonLabel: Record<string, string> = {
  blocker: 'Needs help',
  overdue: 'Overdue',
  at_risk: 'At risk',
  follow_up: 'Follow-up',
}

export default function TodayPage() {
  const { me, isManager } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()
  const today = useAsync<TodayData>(
    () => api.get('/today?attention_limit=25&work_limit=6'),
    [],
  )
  const users = useAsync<User[]>(() => api.get('/users'), [])

  const [extraAttention, setExtraAttention] = useState<AttentionItem[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [updateTask, setUpdateTask] = useState<Task | null>(null)
  const [helpTask, setHelpTask] = useState<Pick<Task, 'id' | 'title'> | null | undefined>(undefined)
  const [resolveBlocker, setResolveBlocker] = useState<{ id: string; description: string } | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const [draft, setDraft] = useState('')
  const [linkTaskId, setLinkTaskId] = useState('')
  const [showNext, setShowNext] = useState(false)
  const [nextSteps, setNextSteps] = useState('')
  const [receipt, setReceipt] = useState<string | null>(null)
  const [editingUpdate, setEditingUpdate] = useState(false)
  const [savingUpdate, setSavingUpdate] = useState(false)

  const attention = useMemo(
    () => [...(today.data?.attention.items ?? []), ...extraAttention],
    [today.data, extraAttention],
  )
  const attentionTaskIds = useMemo(
    () => new Set(attention.map((item) => item.task_id).filter(Boolean) as string[]),
    [attention],
  )
  const allPreviewTasks = today.data?.current_work.items ?? []
  const currentWork = allPreviewTasks.filter((task) => !attentionTaskIds.has(task.id))
  const totalAttention = today.data?.attention.total ?? 0

  function refresh() {
    setExtraAttention([])
    today.refresh()
  }

  async function loadMoreAttention() {
    setLoadingMore(true)
    try {
      const offset = attention.length
      const page = await api.get<Page<AttentionItem>>(
        `/today?attention_limit=25&attention_offset=${offset}&work_limit=1`,
      )
      setExtraAttention((current) => [...current, ...page.items])
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  async function startStandup() {
    setStarting(true)
    try {
      const session = await api.post<{ id: string }>('/standups/sessions', {})
      navigate(`/standups/${session.id}/live`)
    } catch (caught) {
      push((caught as Error).message, 'error')
      today.refresh()
    } finally {
      setStarting(false)
    }
  }

  async function openUpdate(taskId: string) {
    try {
      const task = await api.get<TaskDetail>(`/tasks/${taskId}`)
      setUpdateTask(task)
    } catch (caught) {
      push((caught as Error).message, 'error')
    }
  }

  async function changeStatus(task: Task, status: TaskStatus) {
    if (status === task.status) return
    setBusyAction(task.id)
    try {
      await api.patch(`/tasks/${task.id}/status`, {
        status,
        expected_version: task.version,
      })
      refresh()
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      setBusyAction(null)
    }
  }

  async function completeAction(itemId: string) {
    setBusyAction(itemId)
    try {
      await api.patch(`/action-items/${itemId}`, { status: 'completed' })
      push('Follow-up completed.')
      refresh()
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      setBusyAction(null)
    }
  }

  async function saveDailyUpdate() {
    if (!draft.trim()) return
    setSavingUpdate(true)
    try {
      if (linkTaskId) {
        const task = allPreviewTasks.find((item) => item.id === linkTaskId)
        await api.post(`/tasks/${linkTaskId}/updates`, {
          progress: draft.trim(),
          next_steps: showNext && nextSteps.trim() ? nextSteps.trim() : null,
        })
        setReceipt(task ? `${draft.trim()} — ${task.title}` : draft.trim())
      } else {
        await api.put('/daily-updates/today', {
          progress: draft.trim(),
          next_steps: showNext && nextSteps.trim() ? nextSteps.trim() : null,
        })
        setReceipt(draft.trim())
      }
      setDraft('')
      setNextSteps('')
      setLinkTaskId('')
      setShowNext(false)
      setEditingUpdate(false)
      push('Update saved.')
      refresh()
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      setSavingUpdate(false)
    }
  }

  const savedDaily = today.data?.daily_update?.progress ?? null
  const showReceipt = receipt ?? (editingUpdate ? null : savedDaily)

  const standupAction = isManager ? (
    !today.data?.session ? (
      <button type="button" className="btn btn-primary" onClick={startStandup} disabled={starting}>
        {starting ? <Spinner /> : <Icon name="play" />} Start standup
      </button>
    ) : today.data.session.status === 'completed' ? (
      <Link to={`/standups/${today.data.session.id}`} className="btn btn-primary">
        <Icon name="check" /> View outcomes
      </Link>
    ) : (
      <Link to={`/standups/${today.data.session.id}/live`} className="btn btn-primary">
        <Icon name="play" /> Resume standup
      </Link>
    )
  ) : today.data?.session ? (
    today.data.session.status === 'completed' ? (
      <Link to={`/standups/${today.data.session.id}`} className="text-sm text-slate-500 hover:text-slate-700">
        Standup completed · view outcomes
      </Link>
    ) : (
      <span className="text-sm text-slate-500">Standup in progress</span>
    )
  ) : null

  return (
    <div>
      <PageHeader
        title="Today"
        subtitle={
          <span>
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            {' · '}
            <Link to="/standups" className="link">Past standups</Link>
          </span>
        }
        actions={
          <>
            {standupAction}
            <Link to="/work" className="btn btn-secondary">
              View all work
            </Link>
          </>
        }
      />

      {today.loading ? (
        <Loading label="Loading today…" />
      ) : today.error ? (
        <ErrorBox message={today.error} onRetry={today.refresh} />
      ) : (
        <div className="mx-auto max-w-3xl space-y-8">
          <section aria-labelledby="attention-heading">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 id="attention-heading" className="text-base font-semibold text-slate-900">
                {isManager ? 'Team attention' : 'Needs attention'}
              </h2>
              {totalAttention > 0 && (
                <span className="text-sm text-slate-500">{totalAttention} open</span>
              )}
            </div>

            {attention.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                Nothing needs attention right now.
              </p>
            ) : (
              <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                {attention.map((item) => (
                  <AttentionRow
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    isManager={isManager}
                    meId={me?.id ?? null}
                    busy={busyAction === item.id}
                    onOpenTask={() => item.task_id && setSelectedTaskId(item.task_id)}
                    onUpdate={() => item.task_id && openUpdate(item.task_id)}
                    onHelp={() => setHelpTask(item.task_id ? { id: item.task_id, title: item.title } : null)}
                    onResolve={() => setResolveBlocker({ id: item.id, description: item.title })}
                    onDone={() => completeAction(item.id)}
                  />
                ))}
              </div>
            )}

            {attention.length < totalAttention && (
              <button
                type="button"
                className="btn btn-secondary btn-sm mt-2"
                onClick={loadMoreAttention}
                disabled={loadingMore}
              >
                {loadingMore ? <Spinner /> : null} Show {Math.min(25, totalAttention - attention.length)} more
              </button>
            )}
          </section>

          {!isManager && (
            <section aria-labelledby="work-heading">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 id="work-heading" className="text-base font-semibold text-slate-900">
                  My current work
                </h2>
                <Link to="/work" className="link text-sm">
                  View all{today.data?.current_work.total ? ` ${today.data.current_work.total}` : ''}
                </Link>
              </div>
              {currentWork.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                  No other current work. Check Work for backlog or completed tasks.
                </p>
              ) : (
                <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                  {currentWork.map((task) => (
                    <div key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left text-sm font-medium text-slate-900 hover:text-emerald-700"
                        onClick={() => setSelectedTaskId(task.id)}
                      >
                        {task.title}
                      </button>
                      <select
                        className="select w-auto py-1 text-sm"
                        aria-label={`Status for ${task.title}`}
                        value={task.status}
                        disabled={busyAction === task.id}
                        onChange={(event) => changeStatus(task, event.target.value as TaskStatus)}
                      >
                        {TASK_STATUSES.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openUpdate(task.id)}>
                        Update
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {today.data && today.data.current_work.total > currentWork.length && (
                <p className="mt-2 text-sm text-slate-500">
                  Showing {currentWork.length} of {today.data.current_work.total}.{' '}
                  <Link to="/work" className="link">Open Work</Link>
                </p>
              )}
            </section>
          )}

          {!isManager && (
            <section aria-labelledby="update-heading">
              <h2 id="update-heading" className="mb-2 text-base font-semibold text-slate-900">
                Anything changed?
              </h2>
              {showReceipt ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-emerald-900">{showReceipt}</p>
                    <button
                      type="button"
                      className="shrink-0 text-sm font-medium text-emerald-800 hover:underline"
                      onClick={() => {
                        setReceipt(null)
                        setEditingUpdate(true)
                        setDraft(showReceipt)
                      }}
                    >
                      Edit
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-emerald-700">
                    Saved. Your manager sees this in the standup automatically.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <textarea
                    className="textarea min-h-[88px] text-base"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Optional: one short update about what changed."
                    aria-label="Anything changed?"
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select
                      className="select w-auto text-sm"
                      aria-label="Link update to a task"
                      value={linkTaskId}
                      onChange={(event) => setLinkTaskId(event.target.value)}
                    >
                      <option value="">General update (no task)</option>
                      {allPreviewTasks.map((task) => (
                        <option key={task.id} value={task.id}>{task.title}</option>
                      ))}
                    </select>
                    {showNext ? (
                      <input
                        className="input w-56 text-sm"
                        placeholder="Next steps (optional)"
                        aria-label="Next steps"
                        value={nextSteps}
                        onChange={(event) => setNextSteps(event.target.value)}
                      />
                    ) : (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowNext(true)}>
                        Add next steps
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-primary ml-auto"
                      onClick={saveDailyUpdate}
                      disabled={savingUpdate || !draft.trim()}
                    >
                      {savingUpdate ? <Spinner /> : <Icon name="send" />} Save update
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    No change? Nothing to submit. Linking a task is optional.
                  </p>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {selectedTaskId && (
        <TaskDialog
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
          onChanged={refresh}
        />
      )}
      {updateTask && (
        <UpdateDialog
          task={updateTask}
          attributedToUserId={isManager ? updateTask.assignee?.id : me?.id}
          onClose={() => setUpdateTask(null)}
          onSaved={(progress) => {
            setReceipt(progress)
            setUpdateTask(null)
            refresh()
          }}
        />
      )}
      {helpTask !== undefined && (
        <NeedsHelpDialog
          task={helpTask}
          tasks={allPreviewTasks}
          users={users.data ?? []}
          onClose={() => setHelpTask(undefined)}
          onSaved={() => {
            setHelpTask(undefined)
            refresh()
          }}
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

function AttentionRow({
  item,
  isManager,
  meId,
  busy,
  onOpenTask,
  onUpdate,
  onHelp,
  onResolve,
  onDone,
}: {
  item: AttentionItem
  isManager: boolean
  meId: string | null
  busy: boolean
  onOpenTask: () => void
  onUpdate: () => void
  onHelp: () => void
  onResolve: () => void
  onDone: () => void
}) {
  const label = reasonLabel[item.reason] ?? 'Attention'
  const extra = item.reasons.length - 1
  const owner = item.owner?.full_name
  const canResolve = isManager || (item.owner?.id != null && item.owner.id === meId)
  const canComplete = isManager || (item.owner?.id != null && item.owner.id === meId)

  return (
    <div className="flex flex-wrap items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {item.kind === 'task' ? (
            <button
              type="button"
              className="text-left text-sm font-semibold text-slate-900 hover:text-emerald-700"
              onClick={onOpenTask}
            >
              {item.title}
            </button>
          ) : (
            <span className="text-sm font-semibold text-slate-900">{item.title}</span>
          )}
          <span className={`text-xs font-medium ${item.reason === 'at_risk' || item.reason === 'follow_up' ? 'text-amber-700' : 'text-rose-700'}`}>
            {label}
          </span>
          {extra > 0 && <span className="text-xs text-slate-400">+{extra} more</span>}
        </div>
        {item.detail && <p className="mt-1 text-sm text-slate-600">{item.detail}</p>}
        <p className="mt-1 text-xs text-slate-500">
          {owner ? `${owner}` : 'Unassigned'}
          {item.due_date ? ` · ${relativeDay(item.due_date)}` : ''}
          {item.age_days > 0 ? ` · ${item.age_days}d open` : ''}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {item.kind === 'task' && (
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onUpdate} disabled={busy}>
              Update
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onHelp} disabled={busy}>
              Needs help
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenTask}>
              Open
            </button>
          </>
        )}
        {item.kind === 'blocker' && canResolve && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onResolve}>
            Resolve
          </button>
        )}
        {item.kind === 'action_item' && canComplete && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onDone} disabled={busy}>
            Done
          </button>
        )}
        {item.kind === 'action_item' && item.task_id && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenTask}>
            Open task
          </button>
        )}
      </div>
    </div>
  )
}
