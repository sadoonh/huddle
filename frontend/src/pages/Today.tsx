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
} from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDueDate, formatLongDate, formatOpenAge, formatTime } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import {
  TASK_STATUSES,
  type AttentionItem,
  type DailyUpdate,
  type Task,
  type TaskDetail,
  type TaskStatus,
  type TaskUpdate,
  type TodayData,
  type User,
} from '../lib/types'

const reasonLabel: Record<string, string> = {
  blocker: 'Needs help',
  overdue: 'Overdue',
  at_risk: 'At risk',
  follow_up: 'Follow-up',
}

function attentionKey(item: AttentionItem): string {
  return `${item.kind}:${item.id}`
}

function dedupe(items: AttentionItem[]): AttentionItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = attentionKey(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

type TaskReceipt = {
  kind: 'task'
  taskId: string
  taskTitle: string
  updateId: string
  progress: string
  savedAt: string
}

export default function TodayPage() {
  const { me, isManager } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()
  const today = useAsync<TodayData>(() => api.get('/today?attention_limit=10&work_limit=6'), [])
  const users = useAsync<User[]>(() => api.get('/users'), [])

  const [extraAttention, setExtraAttention] = useState<AttentionItem[]>([])
  const [totalAttention, setTotalAttention] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [updateTask, setUpdateTask] = useState<Task | null>(null)
  const [helpTask, setHelpTask] = useState<Pick<Task, 'id' | 'title'> | null | undefined>(undefined)
  const [resolveBlocker, setResolveBlocker] = useState<{ id: string; description: string } | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const [dailyDraft, setDailyDraft] = useState('')
  const [dailyNext, setDailyNext] = useState('')
  const [showDailyNext, setShowDailyNext] = useState(false)
  const [dailyReceipt, setDailyReceipt] = useState<DailyUpdate | null>(null)
  const [editingDaily, setEditingDaily] = useState(false)
  const [savingDaily, setSavingDaily] = useState(false)
  const [dailyError, setDailyError] = useState<string | null>(null)
  const [taskReceipt, setTaskReceipt] = useState<TaskReceipt | null>(null)

  const attention = useMemo(
    () => dedupe([...(today.data?.attention.items ?? []), ...extraAttention]),
    [today.data, extraAttention],
  )
  const total = totalAttention ?? today.data?.attention.total ?? 0
  const allCurrentWork = today.data?.current_work.items ?? []
  const attentionTaskIds = useMemo(
    () => new Set(attention.map((item) => item.task_id).filter(Boolean) as string[]),
    [attention],
  )
  const currentWork = allCurrentWork.filter((task) => !attentionTaskIds.has(task.id))
  const hiddenCurrent = allCurrentWork.filter((task) => attentionTaskIds.has(task.id)).length
  const shownDaily = dailyReceipt ?? today.data?.daily_update ?? null

  function refresh() {
    setExtraAttention([])
    setTotalAttention(null)
    today.refresh()
  }

  async function loadMoreAttention() {
    if (!today.data || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await api.get<TodayData>(
        `/today?attention_limit=10&attention_offset=${attention.length}&work_limit=1`,
      )
      setExtraAttention((current) => dedupe([...current, ...page.attention.items]))
      setTotalAttention(page.attention.total)
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
      if (caught instanceof ApiError && caught.status === 409) {
        const sessionId = caught.details?.session_id
        if (typeof sessionId === 'string') {
          today.refresh()
          navigate(`/standups/${sessionId}/live`)
          return
        }
      }
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
      await api.patch(`/tasks/${task.id}/status`, { status, expected_version: task.version })
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

  async function saveDaily() {
    if (!dailyDraft.trim() || savingDaily) return
    setSavingDaily(true)
    setDailyError(null)
    try {
      const saved = await api.put<DailyUpdate>('/daily-updates/today', {
        progress: dailyDraft.trim(),
        next_steps: showDailyNext && dailyNext.trim() ? dailyNext.trim() : null,
      })
      setDailyReceipt(saved)
      setDailyDraft('')
      setDailyNext('')
      setShowDailyNext(false)
      setEditingDaily(false)
      push('Daily update saved.')
      refresh()
    } catch (caught) {
      setDailyError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSavingDaily(false)
    }
  }

  function editDaily() {
    const source = shownDaily
    setDailyDraft(source?.progress ?? '')
    setDailyNext(source?.next_steps ?? '')
    setShowDailyNext(Boolean(source?.next_steps))
    setEditingDaily(true)
    setDailyError(null)
  }

  const standupAction = isManager && today.data && !today.loading && !today.error ? (
    !today.data.session ? (
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
  ) : null

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Today"
        subtitle={
          today.data?.business_date
            ? formatLongDate(today.data.business_date)
            : new Date().toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })
        }
        actions={
          <>
            <Link to="/standups" className="text-sm font-medium text-slate-600 underline-offset-2 hover:underline">
              Past standups
            </Link>
            {standupAction}
          </>
        }
      />

      {today.loading && !today.data ? (
        <Loading label="Loading today…" />
      ) : today.error && !today.data ? (
        <ErrorBox message={today.error} onRetry={today.refresh} />
      ) : (
        <div className="space-y-8">
          {today.error && <ErrorBox message={today.error} onRetry={today.refresh} />}

          <section aria-labelledby="attention-heading">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 id="attention-heading" className="text-base font-semibold text-slate-900">
                {isManager ? 'Team needs attention' : 'Needs attention'}
              </h2>
              <span className="text-sm text-slate-500">
                {total} item{total === 1 ? '' : 's'} need attention
              </span>
            </div>

            {attention.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                Nothing needs attention right now.
              </p>
            ) : (
              <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                {attention.map((item) => (
                  <AttentionRow
                    key={attentionKey(item)}
                    item={item}
                    isManager={isManager}
                    meId={me?.id ?? null}
                    busy={busyAction === item.id}
                    onOpenTask={() => item.task_id && setSelectedTaskId(item.task_id)}
                    onUpdate={() => item.task_id && openUpdate(item.task_id)}
                    onHelp={() => setHelpTask(item.task_id ? { id: item.task_id, title: item.title } : null)}
                    onResolve={(blockerId, description) => setResolveBlocker({ id: blockerId, description })}
                    onDone={completeAction}
                  />
                ))}
              </div>
            )}

            {attention.length < total && (
              <button
                type="button"
                className="btn btn-secondary btn-sm mt-2"
                onClick={loadMoreAttention}
                disabled={loadingMore}
              >
                {loadingMore ? <Spinner /> : null} View all {total} attention items
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
                  {hiddenCurrent > 0
                    ? `${hiddenCurrent} other task${hiddenCurrent === 1 ? ' is' : 's are'} shown in Needs attention above.`
                    : 'No current work. Check Work for backlog or completed tasks.'}
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
                        className="select w-auto py-1.5 text-sm"
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
              {hiddenCurrent > 0 && currentWork.length > 0 && (
                <p className="mt-2 text-sm text-slate-500">
                  {hiddenCurrent} other task{hiddenCurrent === 1 ? ' is' : 's are'} shown in Needs attention above.
                </p>
              )}
            </section>
          )}

          {!isManager && (
            <section aria-labelledby="update-heading">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 id="update-heading" className="text-base font-semibold text-slate-900">
                  Anything changed?
                </h2>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setHelpTask(null)}>
                  <Icon name="alert" /> Ask for help
                </button>
              </div>

              {taskReceipt && (
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  <p className="min-w-0 flex-1 text-slate-700">
                    Task update saved to <span className="font-medium">{taskReceipt.taskTitle}</span>
                    {' · '}{formatTime(taskReceipt.savedAt)}
                  </p>
                  <div className="flex gap-2">
                    <button type="button" className="text-sm font-medium text-emerald-700 hover:underline" onClick={() => setSelectedTaskId(taskReceipt.taskId)}>
                      View update
                    </button>
                    <button type="button" className="text-sm font-medium text-emerald-700 hover:underline" onClick={() => openUpdate(taskReceipt.taskId)}>
                      Add correction
                    </button>
                  </div>
                </div>
              )}

              {shownDaily && !editingDaily ? (
                <div className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap text-sm text-slate-700">{shownDaily.progress}</p>
                    {shownDaily.next_steps && (
                      <p className="mt-1 text-sm text-slate-500">Next: {shownDaily.next_steps}</p>
                    )}
                    <p className="mt-1 text-xs text-slate-500">Saved at {formatTime(shownDaily.updated_at)}</p>
                  </div>
                  <button type="button" className="text-sm font-medium text-emerald-700 hover:underline" onClick={editDaily}>
                    Edit
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <textarea
                    className="textarea min-h-[88px] text-base"
                    value={dailyDraft}
                    onChange={(event) => setDailyDraft(event.target.value)}
                    placeholder="Optional: one short update about what changed."
                    aria-label="Anything changed?"
                  />
                  {dailyError && <p className="mt-1 text-sm text-rose-700">{dailyError}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {showDailyNext ? (
                      <input
                        className="input w-56 text-sm"
                        placeholder="Next steps (optional)"
                        aria-label="Next steps"
                        value={dailyNext}
                        onChange={(event) => setDailyNext(event.target.value)}
                      />
                    ) : (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowDailyNext(true)}>
                        Add next steps
                      </button>
                    )}
                    {shownDaily && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingDaily(false)}>
                        Cancel edit
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-primary ml-auto"
                      onClick={saveDaily}
                      disabled={savingDaily || !dailyDraft.trim()}
                    >
                      {savingDaily ? <Spinner /> : <Icon name="send" />} Save update
                    </button>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    One optional daily note. No change? Nothing to submit. Task progress is saved from the task itself.
                  </p>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {selectedTaskId && (
        <TaskDialog taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} onChanged={refresh} />
      )}
      {updateTask && (
        <UpdateDialog
          task={updateTask}
          attributedToUserId={isManager ? updateTask.assignee?.id : me?.id}
          onClose={() => setUpdateTask(null)}
          onSaved={(update: TaskUpdate) => {
            setTaskReceipt({
              kind: 'task',
              taskId: update.task_id,
              taskTitle: update.task_title ?? updateTask.title,
              updateId: update.id,
              progress: update.progress,
              savedAt: update.created_at,
            })
            setUpdateTask(null)
            refresh()
          }}
        />
      )}
      {helpTask !== undefined && (
        <NeedsHelpDialog
          task={helpTask}
          tasks={allCurrentWork}
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
  onResolve: (blockerId: string, description: string) => void
  onDone: (itemId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const label = reasonLabel[item.reason] ?? 'Attention'
  const ownerLabel =
    item.reason === 'blocker' ? 'Help owner' : item.reason === 'follow_up' ? 'Assigned to' : 'Task owner'
  const ownerText = item.owner
    ? `${ownerLabel}: ${item.owner.full_name}`
    : `${ownerLabel}: Unassigned — needs an owner`
  const canResolve =
    isManager || (item.owner?.id != null && item.owner.id === meId) || (item.reporter?.id != null && item.reporter.id === meId)
  const canComplete = isManager || (item.owner?.id != null && item.owner.id === meId)
  const blockerIssue = item.issues.find((issue) => issue.kind === 'blocker')
  const actionIssue = item.issues.find((issue) => issue.kind === 'action_item')
  const otherIssues = Math.max(item.issues.length - 1, 0)

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {item.kind === 'task' && item.task_id ? (
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
          {item.detail && <p className="mt-1 text-sm text-slate-600">{item.detail}</p>}
          <p className="mt-1 text-xs text-slate-500">
            {ownerText}
            {item.due_date ? ` · ${formatDueDate(item.due_date)}` : ''}
            {item.age_days > 0 ? ` · ${formatOpenAge(item.age_days)}` : ''}
          </p>

          {expanded && (
            <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2.5">
              {item.issues.map((issue) => (
                <div key={issue.id} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                  <div>
                    <p className="text-slate-700">{issue.detail ?? issue.label}</p>
                    <p className="text-xs text-slate-500">
                      {issue.label}
                      {issue.owner ? ` · ${issue.owner.full_name}` : ' · Unassigned'}
                      {issue.due_date ? ` · ${formatDueDate(issue.due_date)}` : ''}
                      {issue.age_days > 0 ? ` · ${formatOpenAge(issue.age_days)}` : ''}
                    </p>
                  </div>
                  {issue.kind === 'blocker' &&
                    (isManager ||
                      issue.owner?.id === meId ||
                      (blockerIssue?.id === issue.id && item.reporter?.id === meId)) && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onResolve(issue.id, issue.detail ?? issue.label)}
                      >
                        Resolve
                      </button>
                    )}
                  {issue.kind === 'action_item' && (isManager || issue.owner?.id === meId) && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onDone(issue.id)}>
                      Mark done
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:shrink-0">
          {item.kind === 'blocker' && (
            <>
              {canResolve && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => onResolve(item.id, item.detail ?? item.title)}>
                  Resolve
                </button>
              )}
              {item.task_id && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenTask}>
                  Review help
                </button>
              )}
            </>
          )}
          {item.kind === 'action_item' && canComplete && (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onDone(item.id)}>
              Mark done
            </button>
          )}
          {item.kind === 'task' && item.reason === 'blocker' && (
            <>
              {blockerIssue && canResolve && item.issues.filter((issue) => issue.kind === 'blocker').length === 1 ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => onResolve(blockerIssue.id, blockerIssue.detail ?? blockerIssue.label)}>
                  Resolve
                </button>
              ) : (
                <button type="button" className="btn btn-primary btn-sm" onClick={onOpenTask}>
                  Review help
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={onHelp}>
                Report another issue
              </button>
            </>
          )}
          {item.kind === 'task' && item.reason === 'follow_up' && actionIssue && (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onDone(actionIssue.id)}>
              Mark done
            </button>
          )}
          {item.kind === 'task' && (item.reason === 'overdue' || item.reason === 'at_risk') && (
            <button type="button" className="btn btn-primary btn-sm" onClick={onUpdate}>
              Update
            </button>
          )}
          {item.kind === 'task' && item.reason !== 'blocker' && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onHelp}>
              Ask for help
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
