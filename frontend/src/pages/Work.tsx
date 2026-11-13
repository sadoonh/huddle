import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import TaskCreateDialog from '../components/TaskCreateDialog'
import TaskDialog from '../components/TaskDialog'
import { Icon } from '../components/icons'
import {
  EmptyState,
  ErrorBox,
  Loading,
  Modal,
  PageHeader,
  Spinner,
} from '../components/ui'
import { api, query } from '../lib/api'
import { relativeDay } from '../lib/format'
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
  type TaskStatus,
  type User,
} from '../lib/types'

const DEFAULT_STATUSES: TaskStatus[] = ['todo', 'in_progress']

export default function WorkPage() {
  const { me, isManager } = useAuth()
  const { push } = useToast()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [projectId, setProjectId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [statuses, setStatuses] = useState<TaskStatus[]>(DEFAULT_STATUSES)
  const [priority, setPriority] = useState<Priority | ''>('')
  const [blockedOnly, setBlockedOnly] = useState(false)
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [offset, setOffset] = useState(0)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busyTask, setBusyTask] = useState<string | null>(null)
  const limit = 25

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(search), 250)
    return () => window.clearTimeout(timeout)
  }, [search])

  const projectsQuery = useAsync<Project[]>(() => api.get('/projects'), [])
  const usersQuery = useAsync<User[]>(() => api.get('/users'), [])

  useEffect(() => {
    setProjects(projectsQuery.data ?? [])
  }, [projectsQuery.data])
  useEffect(() => {
    setUsers(usersQuery.data ?? [])
  }, [usersQuery.data])

  const tasks = useAsync<Page<Task>>(
    () =>
      api.get(
        `/tasks${query({
          project_id: projectId || undefined,
          assignee_id: isManager && assigneeId ? assigneeId : undefined,
          status: statuses,
          priority: priority || undefined,
          blocked: blockedOnly || undefined,
          overdue: overdueOnly || undefined,
          q: debounced || undefined,
          limit,
          offset,
        })}`,
      ),
    [projectId, assigneeId, statuses, priority, blockedOnly, overdueOnly, debounced, offset, isManager],
  )

  const canManageProjects = isManager || projects.some((project) => project.owner?.id === me?.id)

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (projectId) count += 1
    if (assigneeId) count += 1
    if (statuses.length !== DEFAULT_STATUSES.length || statuses.some((status) => !DEFAULT_STATUSES.includes(status))) count += 1
    if (priority) count += 1
    if (blockedOnly) count += 1
    if (overdueOnly) count += 1
    return count
  }, [projectId, assigneeId, statuses, priority, blockedOnly, overdueOnly])

  async function changeStatus(task: Task, status: TaskStatus) {
    if (status === task.status) return
    setBusyTask(task.id)
    try {
      await api.patch(`/tasks/${task.id}/status`, {
        status,
        expected_version: task.version,
      })
      tasks.refresh()
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      setBusyTask(null)
    }
  }

  function resetFilters() {
    setProjectId('')
    setAssigneeId('')
    setStatuses(DEFAULT_STATUSES)
    setPriority('')
    setBlockedOnly(false)
    setOverdueOnly(false)
    setOffset(0)
  }

  const total = tasks.data?.total ?? 0
  const shownFrom = total === 0 ? 0 : offset + 1
  const shownTo = Math.min(offset + limit, total)

  return (
    <div>
      <PageHeader
        title="Work"
        subtitle="Tasks you can act on, without a planning suite."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setFiltersOpen(true)}>
              <Icon name="search" /> Filters
              {activeFilterCount > 0 && (
                <span className="rounded bg-slate-900 px-1.5 text-[11px] font-semibold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> New task
            </button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <Icon name="search" className="h-4 w-4" />
          </span>
          <input
            className="input pl-9"
            placeholder="Search tasks…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setOffset(0)
            }}
            aria-label="Search tasks"
          />
        </div>
        {projectId && (
          <span className="text-sm text-slate-500">
            {projects.find((project) => project.id === projectId)?.name}
          </span>
        )}
        <span className="text-sm text-slate-500">
          {total} task{total === 1 ? '' : 's'}
        </span>
      </div>

      {tasks.loading ? (
        <Loading />
      ) : tasks.error ? (
        <ErrorBox message={tasks.error} onRetry={tasks.refresh} />
      ) : !tasks.data?.items.length ? (
        <EmptyState
          icon="inbox"
          title="No tasks match"
          description="Try clearing filters, or create a task if this is new work."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> New task
            </button>
          }
        />
      ) : (
        <>
          <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {tasks.data.items.map((task) => (
              <div key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="block max-w-full truncate text-left text-sm font-medium text-slate-900 hover:text-emerald-700"
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    {task.title}
                  </button>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                    {isManager && <span>{task.assignee?.full_name ?? 'Unassigned'}</span>}
                    {isManager && <span aria-hidden="true">·</span>}
                    <span>{task.project_name ?? 'No project'}</span>
                    {taskException(task) ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className={`font-medium ${taskException(task)!.tone}`}>
                          {taskException(task)!.label}
                        </span>
                      </>
                    ) : task.due_date ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{relativeDay(task.due_date)}</span>
                      </>
                    ) : null}
                  </p>
                </div>
                <select
                  className="select w-auto py-1 text-sm"
                  aria-label={`Status for ${task.title}`}
                  value={task.status}
                  disabled={busyTask === task.id}
                  onChange={(event) => changeStatus(task, event.target.value as TaskStatus)}
                >
                  {TASK_STATUSES.map((status) => (
                    <option key={status.value} value={status.value}>{status.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
            <span>
              {shownFrom}–{shownTo} of {total}
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={shownTo >= total}
                onClick={() => setOffset(offset + limit)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {filtersOpen && (
        <FiltersModal
          projects={projects}
          users={users}
          isManager={isManager}
          canManageProjects={canManageProjects}
          values={{ projectId, assigneeId, statuses, priority, blockedOnly, overdueOnly }}
          onClose={() => setFiltersOpen(false)}
          onApply={(next) => {
            setProjectId(next.projectId)
            setAssigneeId(next.assigneeId)
            setStatuses(next.statuses)
            setPriority(next.priority)
            setBlockedOnly(next.blockedOnly)
            setOverdueOnly(next.overdueOnly)
            setOffset(0)
            setFiltersOpen(false)
          }}
          onReset={() => {
            resetFilters()
            setFiltersOpen(false)
          }}
        />
      )}

      {selectedTaskId && (
        <TaskDialog
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
          onChanged={() => tasks.refresh()}
        />
      )}
      {creating && (
        <TaskCreateDialog
          projects={projects}
          users={users}
          defaultProjectId={projectId || undefined}
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

function FiltersModal({
  projects,
  users,
  isManager,
  canManageProjects,
  values,
  onClose,
  onApply,
  onReset,
}: {
  projects: Project[]
  users: User[]
  isManager: boolean
  canManageProjects: boolean
  values: {
    projectId: string
    assigneeId: string
    statuses: TaskStatus[]
    priority: Priority | ''
    blockedOnly: boolean
    overdueOnly: boolean
  }
  onClose: () => void
  onApply: (next: typeof values) => void
  onReset: () => void
}) {
  const [draft, setDraft] = useState(values)

  function toggleStatus(status: TaskStatus) {
    setDraft({
      ...draft,
      statuses: draft.statuses.includes(status)
        ? draft.statuses.filter((value) => value !== status)
        : [...draft.statuses, status],
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Filters"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onReset}>Reset</button>
          <button type="button" className="btn btn-primary" onClick={() => onApply(draft)}>Apply</button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="filter-project">Project</label>
          <select
            id="filter-project"
            className="select"
            value={draft.projectId}
            onChange={(event) => setDraft({ ...draft, projectId: event.target.value })}
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
          {canManageProjects && (
            <Link to="/settings/projects" className="mt-1 inline-block text-sm text-emerald-700 hover:underline">
              Manage projects
            </Link>
          )}
        </div>
        {isManager && (
          <div>
            <label className="label" htmlFor="filter-assignee">Owner</label>
            <select
              id="filter-assignee"
              className="select"
              value={draft.assigneeId}
              onChange={(event) => setDraft({ ...draft, assigneeId: event.target.value })}
            >
              <option value="">Everyone</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.full_name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <p className="label">Status</p>
          <div className="grid grid-cols-2 gap-1.5">
            {TASK_STATUSES.map((status) => (
              <label key={status.value} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-slate-700 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={draft.statuses.includes(status.value)}
                  onChange={() => toggleStatus(status.value)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                {status.label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">No selection means all statuses.</p>
        </div>
        <div>
          <label className="label" htmlFor="filter-priority">Priority</label>
          <select
            id="filter-priority"
            className="select"
            value={draft.priority}
            onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority | '' })}
          >
            <option value="">Any priority</option>
            {PRIORITIES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={draft.blockedOnly}
              onChange={(event) => setDraft({ ...draft, blockedOnly: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300"
            />
            Only work that needs help
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={draft.overdueOnly}
              onChange={(event) => setDraft({ ...draft, overdueOnly: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300"
            />
            Only overdue work
          </label>
        </div>
      </div>
    </Modal>
  )
}


function taskException(task: Task): { label: string; tone: string } | null {
  if (task.is_blocked) return { label: 'Needs help', tone: 'text-rose-700' }
  if (task.is_overdue) return { label: 'Overdue', tone: 'text-rose-700' }
  if (task.is_at_risk) return { label: 'At risk', tone: 'text-amber-700' }
  return null
}
