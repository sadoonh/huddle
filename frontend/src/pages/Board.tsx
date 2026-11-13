import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../components/icons'
import {
  Avatar,
  DueDate,
  EmptyState,
  ErrorBox,
  Loading,
  Modal,
  PageHeader,
  PriorityBadge,
  Spinner,
  StatusBadge,
} from '../components/ui'
import { api, query } from '../lib/api'
import { formatDate, humanize, relativeDay } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import {
  PRIORITIES,
  TASK_STATUSES,
  type Page,
  type Priority,
  type Project,
  type Task,
  type TaskDetail,
  type TaskStatus,
  type User,
} from '../lib/types'

const columns: { status: TaskStatus; label: string; tone: string }[] = [
  { status: 'backlog', label: 'Backlog', tone: 'bg-slate-400' },
  { status: 'todo', label: 'To Do', tone: 'bg-sky-500' },
  { status: 'in_progress', label: 'In Progress', tone: 'bg-indigo-500' },
  { status: 'done', label: 'Done', tone: 'bg-emerald-500' },
  { status: 'canceled', label: 'Canceled', tone: 'bg-slate-300' },
]

const priorityBorder: Record<Priority, string> = {
  urgent: 'border-l-rose-500',
  high: 'border-l-amber-400',
  medium: 'border-l-sky-400',
  low: 'border-l-slate-300',
}

export default function BoardPage() {
  const { isManager } = useAuth()
  const { push } = useToast()
  const [params, setParams] = useSearchParams()
  const [projectId, setProjectId] = useState(params.get('project') ?? '')
  const [assigneeId, setAssigneeId] = useState('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [blockedOnly, setBlockedOnly] = useState(false)
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const [moving, setMoving] = useState<string | null>(null)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(search), 250)
    return () => window.clearTimeout(timeout)
  }, [search])

  useEffect(() => {
    if (projectId) setParams({ project: projectId }, { replace: true })
    else setParams({}, { replace: true })
  }, [projectId, setParams])

  const projects = useAsync<Project[]>(() => api.get('/projects'), [])
  const users = useAsync<User[]>(() => api.get('/users'), [])
  const tasks = useAsync<Page<Task>>(
    () =>
      api.get(
        `/tasks${query({
          project_id: projectId,
          assignee_id: assigneeId,
          q: debounced,
          blocked: blockedOnly || undefined,
          overdue: overdueOnly || undefined,
          limit: 200,
        })}`,
      ),
    [projectId, assigneeId, debounced, blockedOnly, overdueOnly],
  )

  const grouped = useMemo(() => {
    const result: Record<TaskStatus, Task[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      done: [],
      canceled: [],
    }
    for (const task of tasks.data?.items ?? []) result[task.status].push(task)
    return result
  }, [tasks.data])

  async function move(taskId: string, status: TaskStatus) {
    const task = tasks.data?.items.find((item) => item.id === taskId)
    if (!task || task.status === status) return
    setMoving(taskId)
    try {
      await api.patch(`/tasks/${taskId}/status`, { status })
      tasks.refresh()
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      setMoving(null)
      setDragging(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="Task board"
        subtitle="A secondary, at-a-glance view. The standup workspace remains the primary experience."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> New task
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className="select w-auto" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          <option value="">All projects</option>
          {(projects.data ?? []).map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <select className="select w-auto" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
          <option value="">Everyone</option>
          {(users.data ?? []).map((user) => (
            <option key={user.id} value={user.id}>
              {user.full_name}
            </option>
          ))}
        </select>
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
            <Icon name="search" className="h-4 w-4" />
          </span>
          <input
            className="input w-56 pl-8"
            placeholder="Search task titles…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            checked={blockedOnly}
            onChange={(event) => setBlockedOnly(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          Blocked
        </label>
        <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(event) => setOverdueOnly(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          Overdue
        </label>
        <span className="ml-auto text-[11px] text-slate-400">{tasks.data?.total ?? 0} tasks</span>
      </div>

      {tasks.loading ? (
        <Loading />
      ) : tasks.error ? (
        <ErrorBox message={tasks.error} onRetry={tasks.refresh} />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {columns.map((column) => (
            <div
              key={column.status}
              className="flex w-60 shrink-0 flex-col rounded-xl border border-slate-200 bg-slate-50/80"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                if (dragging) void move(dragging, column.status)
              }}
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${column.tone}`} />
                  <h2 className="text-xs font-semibold text-slate-700">{column.label}</h2>
                </div>
                <span className="rounded bg-white px-1.5 text-[10px] font-semibold text-slate-500">
                  {grouped[column.status].length}
                </span>
              </div>

              <div className="flex-1 space-y-2 p-2">
                {grouped[column.status].length === 0 && (
                  <p className="px-1 py-6 text-center text-[11px] text-slate-400">Drop tasks here</p>
                )}
                {grouped[column.status].map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => setDragging(task.id)}
                    onDragEnd={() => setDragging(null)}
                    className={`card cursor-grab rounded-lg border-l-4 p-2.5 active:cursor-grabbing ${
                      priorityBorder[task.priority]
                    } ${dragging === task.id ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left text-xs font-semibold leading-snug text-slate-800 hover:text-emerald-700"
                        onClick={() => setSelectedTaskId(task.id)}
                      >
                        {task.title}
                      </button>
                      {moving === task.id && <Spinner className="h-3 w-3 text-slate-400" />}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <PriorityBadge priority={task.priority} />
                      {task.is_blocked && <span className="badge badge-rose">Blocked</span>}
                      {task.is_at_risk && <span className="badge badge-amber">At risk</span>}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-1">
                      <DueDate date={task.due_date} overdue={task.is_overdue} />
                      {task.assignee && (
                        <span title={task.assignee.full_name}>
                          <Avatar name={task.assignee.full_name} size="sm" />
                        </span>
                      )}
                    </div>
                    {task.project_name && (
                      <p className="mt-1 truncate text-[10px] text-slate-400">{task.project_name}</p>
                    )}
                    <select
                      className="mt-1.5 w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-500"
                      value={task.status}
                      onChange={(event) => void move(task.id, event.target.value as TaskStatus)}
                      aria-label="Move task"
                    >
                      {TASK_STATUSES.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedTaskId && (
        <TaskEditor
          taskId={selectedTaskId}
          isManager={isManager}
          projects={projects.data ?? []}
          users={users.data ?? []}
          onClose={() => setSelectedTaskId(null)}
          onSaved={() => {
            tasks.refresh()
            projects.refresh()
          }}
        />
      )}

      {creating && (
        <TaskCreateModal
          projects={projects.data ?? []}
          users={users.data ?? []}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            tasks.refresh()
          }}
        />
      )}
    </div>
  )
}

function TaskEditor({
  taskId,
  isManager,
  projects,
  users,
  onClose,
  onSaved,
}: {
  taskId: string
  isManager: boolean
  projects: Project[]
  users: User[]
  onClose: () => void
  onSaved: () => void
}) {
  const { push } = useToast()
  const detail = useAsync<TaskDetail>(() => api.get(`/tasks/${taskId}`), [taskId])
  const [form, setForm] = useState({
    title: '',
    description: '',
    status: 'todo' as TaskStatus,
    priority: 'medium' as Priority,
    assignee_id: '',
    project_id: '',
    due_date: '',
    is_at_risk: false,
    at_risk_reason: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!detail.data) return
    setForm({
      title: detail.data.title,
      description: detail.data.description ?? '',
      status: detail.data.status,
      priority: detail.data.priority,
      assignee_id: detail.data.assignee?.id ?? '',
      project_id: detail.data.project_id,
      due_date: detail.data.due_date ?? '',
      is_at_risk: detail.data.is_at_risk,
      at_risk_reason: detail.data.at_risk_reason ?? '',
    })
  }, [detail.data])

  async function save() {
    if (!detail.data) return
    setSaving(true)
    setError(null)
    try {
      await api.patch(`/tasks/${taskId}`, {
        title: form.title,
        description: form.description || null,
        status: form.status,
        priority: form.priority,
        assignee_id: form.assignee_id || null,
        project_id: isManager ? form.project_id : undefined,
        due_date: form.due_date || null,
        is_at_risk: form.is_at_risk,
        at_risk_reason: form.is_at_risk ? form.at_risk_reason || null : null,
        expected_version: detail.data.version,
      })
      push('Task updated.')
      detail.refresh()
      onSaved()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Task details"
      description={detail.data ? `v${detail.data.version} · updated ${formatDate(detail.data.updated_at)}` : undefined}
      wide
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !detail.data}>
            {saving ? <Spinner /> : <Icon name="check" />} Save changes
          </button>
        </>
      }
    >
      {detail.loading ? (
        <Loading />
      ) : detail.error ? (
        <ErrorBox message={detail.error} onRetry={detail.refresh} />
      ) : (
        <div className="space-y-3">
          {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
          <div>
            <label className="label">Title</label>
            <input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea
              className="textarea"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Status</label>
              <select
                className="select"
                value={form.status}
                onChange={(event) => setForm({ ...form, status: event.target.value as TaskStatus })}
              >
                {TASK_STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Priority</label>
              <select
                className="select"
                value={form.priority}
                onChange={(event) => setForm({ ...form, priority: event.target.value as Priority })}
              >
                {PRIORITIES.map((priority) => (
                  <option key={priority.value} value={priority.value}>
                    {priority.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Assignee</label>
              <select
                className="select"
                value={form.assignee_id}
                disabled={!isManager}
                onChange={(event) => setForm({ ...form, assignee_id: event.target.value })}
              >
                <option value="">Unassigned</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Due date</label>
              <input
                type="date"
                className="input"
                value={form.due_date}
                onChange={(event) => setForm({ ...form, due_date: event.target.value })}
              />
            </div>
            <div>
              <label className="label">Project</label>
              <select
                className="select"
                value={form.project_id}
                disabled={!isManager}
                onChange={(event) => setForm({ ...form, project_id: event.target.value })}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                <input
                  type="checkbox"
                  checked={form.is_at_risk}
                  onChange={(event) => setForm({ ...form, is_at_risk: event.target.checked })}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Flag as at risk
              </label>
              {form.is_at_risk && (
                <input
                  className="input mt-1.5"
                  placeholder="Why is it at risk?"
                  value={form.at_risk_reason}
                  onChange={(event) => setForm({ ...form, at_risk_reason: event.target.value })}
                />
              )}
            </div>
          </div>

          {(detail.data?.blockers.length ?? 0) > 0 && (
            <div>
              <p className="label">Blockers</p>
              <div className="space-y-1">
                {detail.data!.blockers.map((blocker) => (
                  <div key={blocker.id} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className={blocker.status === 'open' ? 'text-rose-700' : 'text-slate-400'}>
                        {blocker.description}
                      </span>
                      <span className={`badge ${blocker.status === 'open' ? 'badge-rose' : 'badge-emerald'}`}>
                        {humanize(blocker.status)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(detail.data?.updates.length ?? 0) > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                Progress history · {detail.data!.updates.length}
              </summary>
              <div className="mt-2 space-y-1">
                {detail.data!.updates
                  .slice()
                  .reverse()
                  .map((update) => (
                    <div key={update.id} className="rounded-md bg-slate-50 px-2.5 py-1.5 text-[11px]">
                      <p className="text-slate-700">{update.progress}</p>
                      <p className="text-[9px] text-slate-400">
                        {update.attributed_to?.full_name ?? update.author?.full_name ?? '—'} ·{' '}
                        {formatDate(update.created_at)} · {humanize(update.source)}
                      </p>
                    </div>
                  ))}
              </div>
            </details>
          )}

          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
            <StatusBadge status={detail.data!.status} />
            <span>{detail.data!.open_action_item_count} open follow-ups</span>
            {detail.data!.latest_update && <span>Updated {relativeDay(detail.data!.latest_update.created_at)}</span>}
          </div>
        </div>
      )}
    </Modal>
  )
}

function TaskCreateModal({
  projects,
  users,
  onClose,
  onCreated,
}: {
  projects: Project[]
  users: User[]
  onClose: () => void
  onCreated: () => void
}) {
  const { push } = useToast()
  const [form, setForm] = useState({
    project_id: projects[0]?.id ?? '',
    title: '',
    description: '',
    assignee_id: '',
    priority: 'medium' as Priority,
    status: 'todo' as TaskStatus,
    due_date: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setSaving(true)
    setError(null)
    try {
      await api.post('/tasks', {
        ...form,
        assignee_id: form.assignee_id || null,
        description: form.description || null,
        due_date: form.due_date || null,
      })
      push('Task created.')
      onCreated()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New task"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={create} disabled={saving || !form.title || !form.project_id}>
            {saving ? <Spinner /> : <Icon name="plus" />} Create task
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        <div>
          <label className="label">Title</label>
          <input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea
            className="textarea"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Project</label>
            <select
              className="select"
              value={form.project_id}
              onChange={(event) => setForm({ ...form, project_id: event.target.value })}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Assignee</label>
            <select
              className="select"
              value={form.assignee_id}
              onChange={(event) => setForm({ ...form, assignee_id: event.target.value })}
            >
              <option value="">Unassigned</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Priority</label>
            <select
              className="select"
              value={form.priority}
              onChange={(event) => setForm({ ...form, priority: event.target.value as Priority })}
            >
              {PRIORITIES.map((priority) => (
                <option key={priority.value} value={priority.value}>
                  {priority.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select
              className="select"
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value as TaskStatus })}
            >
              {TASK_STATUSES.filter((status) => status.value !== 'done').map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Due date</label>
            <input
              type="date"
              className="input"
              value={form.due_date}
              onChange={(event) => setForm({ ...form, due_date: event.target.value })}
            />
          </div>
        </div>
      </div>
    </Modal>
  )
}
