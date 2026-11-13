import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import TaskCreateDialog from '../components/TaskCreateDialog'
import TaskDialog from '../components/TaskDialog'
import { Icon } from '../components/icons'
import { EmptyState, ErrorBox, Loading, Modal, PageHeader } from '../components/ui'
import { api, query } from '../lib/api'
import { formatDueDateForStatus } from '../lib/format'
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
const PAGE_SIZE = 25

function parsePage(value: string | null): number {
  const parsed = Number(value ?? '0')
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0
}

export default function WorkPage() {
  const { me, isManager } = useAuth()
  const { push } = useToast()
  const [params, setParams] = useSearchParams()
  const [searchInput, setSearchInput] = useState(params.get('q') ?? '')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busyTask, setBusyTask] = useState<string | null>(null)

  const view = (params.get('view') ?? 'active') as 'active' | 'completed' | 'all'
  const statusKey = params.getAll('status').join(',')
  const statusParams = useMemo<TaskStatus[]>(
    () => (statusKey ? (statusKey.split(',') as TaskStatus[]) : []),
    [statusKey],
  )
  const statuses = useMemo<TaskStatus[]>(() => {
    if (statusParams.length > 0) return statusParams
    if (view === 'completed') return ['done']
    if (view === 'all') return []
    return DEFAULT_STATUSES
  }, [statusParams, view])
  const projectId = params.get('project') ?? ''
  const assigneeId = params.get('assignee') ?? ''
  const priority = (params.get('priority') ?? '') as Priority | ''
  const blockedOnly = params.get('blocked') === '1'
  const overdueOnly = params.get('overdue') === '1'
  const page = parsePage(params.get('page'))
  const selectedTaskId = params.get('task')

  function updateParams(mutate: (next: URLSearchParams) => void, replace = true) {
    const next = new URLSearchParams(params)
    mutate(next)
    setParams(next, { replace })
  }

  function setFilter(key: string, value: string | null, replace = true) {
    updateParams((next) => {
      if (value) next.set(key, value)
      else next.delete(key)
      next.delete('page')
    }, replace)
  }

  function setView(nextView: 'active' | 'completed' | 'all') {
    updateParams((next) => {
      next.set('view', nextView)
      next.delete('status')
      next.delete('page')
    })
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchInput !== (params.get('q') ?? '')) {
        updateParams((next) => {
          if (searchInput.trim()) next.set('q', searchInput.trim())
          else next.delete('q')
          next.delete('page')
        })
      }
    }, 250)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  useEffect(() => {
    setSearchInput(params.get('q') ?? '')
  }, [params.get('q')])

  const projects = useAsync<Project[]>(() => api.get('/projects'), [])
  const users = useAsync<User[]>(() => api.get('/users'), [])

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
          q: params.get('q') || undefined,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        })}`,
      ),
    [
      projectId,
      assigneeId,
      statuses,
      priority,
      blockedOnly,
      overdueOnly,
      params.get('q'),
      page,
      isManager,
    ],
  )

  useEffect(() => {
    if (page > 0 && tasks.data && tasks.data.items.length === 0 && !tasks.loading) {
      updateParams((next) => next.delete('page'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.data, tasks.loading, page])

  const canManageProjects =
    isManager || (projects.data ?? []).some((project) => project.owner?.id === me?.id)
  const total = tasks.data?.total ?? 0
  const shownFrom = total === 0 ? 0 : page * PAGE_SIZE + 1
  const shownTo = Math.min((page + 1) * PAGE_SIZE, total)
  const hasFilters =
    Boolean(projectId || assigneeId || priority || blockedOnly || overdueOnly || statusParams.length)
  const search = params.get('q') ?? ''

  const chips = useMemo(() => {
    const result: { key: string; label: string; clear: () => void }[] = []
    if (projectId) {
      result.push({
        key: 'project',
        label: projects.data?.find((project) => project.id === projectId)?.name ?? 'Project',
        clear: () => setFilter('project', null),
      })
    }
    if (assigneeId) {
      result.push({
        key: 'assignee',
        label: users.data?.find((user) => user.id === assigneeId)?.full_name ?? 'Owner',
        clear: () => setFilter('assignee', null),
      })
    }
    if (priority) {
      result.push({
        key: 'priority',
        label: PRIORITIES.find((item) => item.value === priority)?.label ?? 'Priority',
        clear: () => setFilter('priority', null),
      })
    }
    if (blockedOnly) result.push({ key: 'blocked', label: 'Needs help', clear: () => setFilter('blocked', null) })
    if (overdueOnly) result.push({ key: 'overdue', label: 'Overdue', clear: () => setFilter('overdue', null) })
    if (statusParams.length > 0) {
      result.push({
        key: 'status',
        label: statusParams.map((status) => TASK_STATUSES.find((item) => item.value === status)?.label ?? status).join(', '),
        clear: () => updateParams((next) => {
          next.delete('status')
          next.delete('page')
        }),
      })
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, assigneeId, priority, blockedOnly, overdueOnly, statusParams, projects.data, users.data])

  function clearAll() {
    updateParams((next) => {
      ;['project', 'assignee', 'priority', 'blocked', 'overdue', 'status', 'q', 'page', 'view'].forEach((key) =>
        next.delete(key),
      )
    })
  }

  async function changeStatus(task: Task, status: TaskStatus) {
    if (status === task.status) return
    setBusyTask(task.id)
    try {
      await api.patch(`/tasks/${task.id}/status`, {
        status,
        expected_version: task.version,
      })
      push(`Marked ${TASK_STATUSES.find((item) => item.value === status)?.label ?? status}.`)
      tasks.refresh()
    } catch (caught) {
      push((caught as Error).message, 'error')
      tasks.refresh()
    } finally {
      setBusyTask(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Work"
        subtitle={isManager ? 'Team work' : 'My work'}
        actions={
          <>
            {canManageProjects && (
              <Link to="/settings/projects" className="btn btn-ghost">
                <Icon name="folder" /> Project settings
              </Link>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => setFiltersOpen(true)}>
              <Icon name="filter" /> Filters
              {chips.length > 0 && (
                <span className="rounded bg-slate-900 px-1.5 text-[11px] font-semibold text-white">
                  {chips.length}
                </span>
              )}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> New task
            </button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5" role="group" aria-label="Work scope">
          {([
            ['active', 'Active'],
            ['completed', 'Completed'],
            ['all', 'All'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              aria-pressed={statusParams.length === 0 && view === value}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                statusParams.length === 0 && view === value
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
          {statusParams.length > 0 && (
            <span className="px-3 py-1.5 text-sm text-slate-500">Custom statuses</span>
          )}
        </div>
        <div className="relative min-w-[220px] flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <Icon name="search" className="h-4 w-4" />
          </span>
          <input
            className="input pl-9"
            placeholder="Search tasks…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            aria-label="Search tasks"
          />
        </div>
        <span className="text-sm text-slate-500">
          {total} task{total === 1 ? '' : 's'}
        </span>
      </div>

      {chips.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.clear}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
            >
              {chip.label}
              <Icon name="x" className="h-3 w-3" />
            </button>
          ))}
          <button type="button" className="px-2 py-1 text-sm font-medium text-slate-500 hover:text-slate-800" onClick={clearAll}>
            Clear all
          </button>
        </div>
      )}

      {tasks.loading && !tasks.data ? (
        <Loading />
      ) : tasks.error && !tasks.data ? (
        <ErrorBox message={tasks.error} onRetry={tasks.refresh} />
      ) : !tasks.data?.items.length ? (
        <EmptyState
          icon="inbox"
          title={
            search
              ? 'No tasks match your search'
              : hasFilters
                ? 'No tasks match these filters'
                : view === 'active'
                  ? 'No active work'
                  : 'No work yet'
          }
          description={
            search
              ? 'Try a different search, or clear it to see the current scope.'
              : hasFilters
                ? 'Remove a filter to widen the list.'
                : view === 'active'
                  ? 'Nothing is in To do or In progress for this scope.'
                  : isManager
                    ? 'Create a task or assign work to get started.'
                    : 'Work assigned to you will appear here.'
          }
          action={
            search ? (
              <button type="button" className="btn btn-secondary" onClick={() => setSearchInput('')}>
                Clear search
              </button>
            ) : hasFilters ? (
              <button type="button" className="btn btn-secondary" onClick={clearAll}>
                Reset filters
              </button>
            ) : view === 'active' ? (
              <button type="button" className="btn btn-secondary" onClick={() => setView('completed')}>
                View completed
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                <Icon name="plus" /> New task
              </button>
            )
          }
        />
      ) : (
        <>
          {tasks.loading && <p className="mb-1 text-sm text-slate-500">Refreshing…</p>}
          <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {tasks.data.items.map((task) => (
              <div key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="block max-w-full truncate text-left text-sm font-medium text-slate-900 hover:text-emerald-700"
                    onClick={() => updateParams((next) => next.set('task', task.id), false)}
                  >
                    {task.title}
                  </button>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-slate-500">
                    {isManager && <span>{task.assignee?.full_name ?? 'Unassigned'}</span>}
                    {isManager && <span aria-hidden="true">·</span>}
                    <span>{task.project_name ?? 'No project'}</span>
                    {taskException(task) ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className={`font-medium ${taskException(task)!.tone}`}>{taskException(task)!.label}</span>
                      </>
                    ) : task.due_date ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{formatDueDateForStatus(task.due_date, task.status === 'done' || task.status === 'canceled')}</span>
                      </>
                    ) : null}
                  </p>
                </div>
                <select
                  className="select w-auto py-1.5 text-sm"
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

          {total > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
              <span>{shownFrom}–{shownTo} of {total}</span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={page === 0}
                  onClick={() => updateParams((next) => next.set('page', String(page - 1)))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={shownTo >= total}
                  onClick={() => updateParams((next) => next.set('page', String(page + 1)))}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {filtersOpen && (
        <FiltersModal
          projects={projects.data ?? []}
          users={users.data ?? []}
          isManager={isManager}
          values={{ projectId, assigneeId, statuses, priority, blockedOnly, overdueOnly }}
          onClose={() => setFiltersOpen(false)}
          onApply={(next) => {
            updateParams((paramsNext) => {
              ;['project', 'assignee', 'priority', 'blocked', 'overdue', 'status'].forEach((key) =>
                paramsNext.delete(key),
              )
              if (next.projectId) paramsNext.set('project', next.projectId)
              if (next.assigneeId) paramsNext.set('assignee', next.assigneeId)
              if (next.priority) paramsNext.set('priority', next.priority)
              if (next.blockedOnly) paramsNext.set('blocked', '1')
              if (next.overdueOnly) paramsNext.set('overdue', '1')
              const defaultSet =
                next.statuses.length === DEFAULT_STATUSES.length &&
                next.statuses.every((status) => DEFAULT_STATUSES.includes(status))
              if (defaultSet) paramsNext.delete('view')
              else if (next.statuses.length === 0) paramsNext.set('view', 'all')
              else if (next.statuses.length === 1 && next.statuses[0] === 'done') paramsNext.set('view', 'completed')
              else {
                paramsNext.set('view', 'custom')
                next.statuses.forEach((status) => paramsNext.append('status', status))
              }
              paramsNext.delete('page')
            })
            setFiltersOpen(false)
          }}
          onReset={() => {
            clearAll()
            setFiltersOpen(false)
          }}
        />
      )}

      {selectedTaskId && (
        <TaskDialog
          taskId={selectedTaskId}
          onClose={() => updateParams((next) => next.delete('task'))}
          onChanged={() => tasks.refresh()}
        />
      )}
      {creating && (
        <TaskCreateDialog
          projects={projects.data ?? []}
          users={users.data ?? []}
          projectsLoading={projects.loading}
          projectsError={projects.error}
          onRetryOptions={projects.refresh}
          defaultProjectId={projectId || undefined}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            tasks.refresh()
            projects.refresh()
          }}
        />
      )}
    </div>
  )
}

function taskException(task: Task): { label: string; tone: string } | null {
  if (task.is_blocked) return { label: 'Needs help', tone: 'text-rose-700' }
  if (task.is_overdue) return { label: 'Overdue', tone: 'text-rose-700' }
  if (task.is_at_risk) return { label: 'At risk', tone: 'text-amber-700' }
  return null
}

function FiltersModal({
  projects,
  users,
  isManager,
  values,
  onClose,
  onApply,
  onReset,
}: {
  projects: Project[]
  users: User[]
  isManager: boolean
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
          <select id="filter-project" className="select" value={draft.projectId} onChange={(event) => setDraft({ ...draft, projectId: event.target.value })}>
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </div>
        {isManager && (
          <div>
            <label className="label" htmlFor="filter-assignee">Owner</label>
            <select id="filter-assignee" className="select" value={draft.assigneeId} onChange={(event) => setDraft({ ...draft, assigneeId: event.target.value })}>
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
              <label key={status.value} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
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
          <p className="mt-1 text-sm text-slate-500">No selection means all statuses.</p>
        </div>
        <div>
          <label className="label" htmlFor="filter-priority">Priority</label>
          <select id="filter-priority" className="select" value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority | '' })}>
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
