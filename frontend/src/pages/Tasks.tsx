import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import MorphSelect from '../components/MorphSelect'
import TaskCreateDialog from '../components/TaskCreateDialog'
import TaskDialog from '../components/TaskDialog'
import ProjectCreateDialog from '../components/ProjectCreateDialog'
import { Icon } from '../components/icons'
import { SegmentedControl, Spinner, type SegmentItem } from '../components/ui'
import FiltersPanel, { type TaskFilterValues } from '../components/tasks/FiltersPanel'
import TaskTable, { PAGE_SIZE } from '../components/tasks/TaskTable'
import KanbanColumn from '../components/work/KanbanColumn'
import { DragOverlay, useBoardDrag } from '../components/work/BoardDrag'
import { useBoardData } from '../components/work/useBoardData'
import { api, ApiError, query } from '../lib/api'
import { humanize } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { displayStatus, statusLabel } from '../lib/taskDisplay'
import {
  PRIORITIES,
  TASK_STATUSES,
  type Page,
  type Priority,
  type Project,
  type Task,
  type TaskStatus,
  type TodayData,
  type User,
} from '../lib/types'

const BOARD_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done']
const BOARD_CANCELED_STATUSES: TaskStatus[] = [...BOARD_STATUSES, 'canceled']
const TABLE_STATUSES: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'done']
const NARROW_QUERY = '(max-width: 899px)'
const SORT_KEYS = new Set(['title', 'owner', 'status', 'updated'])

type Layout = 'board' | 'table'

function parseStatuses(values: string[]): TaskStatus[] {
  const normalized = values.map((value) => (value === 'backlog' ? 'todo' : value))
  return Array.from(
    new Set(
      normalized.filter((value): value is TaskStatus =>
        TASK_STATUSES.some((status) => status.value === value),
      ),
    ),
  )
}

function parsePage(value: string | null): number {
  const parsed = Number(value ?? '0')
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0
}

function normalizeSort(value: string | null): string {
  if (!value) return '-updated'
  const key = value.startsWith('-') ? value.slice(1) : value
  // Legacy due-date links land on the active default ordering.
  if (key === 'due') return '-updated'
  return SORT_KEYS.has(key) ? value : '-updated'
}

function storedLayoutKey(userId: string | undefined): string {
  return `nex.tasks.layout:${userId ?? 'anonymous'}`
}

export default function TasksPage() {
  const { me, isManager } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [searchInput, setSearchInput] = useState(params.get('q') ?? '')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [creating, setCreating] = useState<{ status: TaskStatus } | null>(null)
  const [creatingProject, setCreatingProject] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [storedLayout, setStoredLayout] = useState<Layout>(() => {
    const value = window.localStorage.getItem(storedLayoutKey(me?.id))
    return value === 'table' ? 'table' : 'board'
  })
  const filtersButtonRef = useRef<HTMLButtonElement | null>(null)

  const layoutParam = params.get('layout')
  const layout: Layout =
    layoutParam === 'table' || layoutParam === 'board'
      ? layoutParam
      : storedLayout
  const projectId = params.get('project') ?? ''
  const assigneeId = isManager ? params.get('assignee') ?? '' : ''
  const priority = (params.get('priority') ?? '') as Priority | ''
  const blockedOnly = params.get('blocked') === '1'
  const canceledVisible = params.get('canceled') === '1'
  const statusFilter = useMemo(() => parseStatuses(params.getAll('status')), [params])
  const search = params.get('q') ?? ''
  const sort = normalizeSort(params.get('sort'))
  const page = parsePage(params.get('page'))
  const selectedTaskId = params.get('task')
  const mobileLane = (params.get('lane') ?? 'todo') as TaskStatus
  const visibleStatuses =
    canceledVisible || statusFilter.includes('canceled') ? BOARD_CANCELED_STATUSES : BOARD_STATUSES

  const projects = useAsync<Project[]>(() => api.get('/projects'), [])
  const users = useAsync<User[]>(() => api.get('/users'), [])
  const today = useAsync<TodayData>(() => api.get('/today'), [])
  const [startingStandup, setStartingStandup] = useState(false)

  const adHoc = useMemo(
    () => projects.data?.find((project) => project.system_key === 'ad_hoc') ?? null,
    [projects.data],
  )

  function updateParams(mutate: (next: URLSearchParams) => void, replace = true) {
    const next = new URLSearchParams(params)
    mutate(next)
    setParams(next, { replace })
  }

  function setFilter(key: string, value: string | null) {
    updateParams((next) => {
      if (value) next.set(key, value)
      else next.delete(key)
      next.delete('page')
    })
  }

  function setLayout(nextLayout: Layout) {
    window.localStorage.setItem(storedLayoutKey(me?.id), nextLayout)
    setStoredLayout(nextLayout)
    // Switching presentations should not reset filters, search, sort or the
    // current table page; only the presentation changes.
    updateParams((next) => next.set('layout', nextLayout))
  }

  // On the Tasks page, plain Tab switches the two presentations only. It
  // never walks focus; use Shift+Tab to resume normal focus navigation.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Tab' ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing ||
        event.keyCode === 229
      ) {
        return
      }
      const active = document.activeElement
      if (
        active instanceof HTMLElement &&
        (active.isContentEditable ||
          active.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'))
      ) {
        return
      }
      if (
        document.body.hasAttribute('data-popover-open') ||
        document.body.hasAttribute('data-board-keyboard-drag') ||
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-morph-tray]',
        )
      ) {
        return
      }
      // Eligible plain Tab is always consumed so held Tab cannot focus-walk.
      event.preventDefault()
      if (event.repeat) return
      const next = layout === 'board' ? 'table' : 'board'
      setLayout(next)
      window.setTimeout(() => {
        document
          .querySelector<HTMLElement>(
            '[role="tablist"][aria-label="Task presentation"] [role="tab"][aria-selected="true"]',
          )
          ?.focus()
      }, 0)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, params])

  // Normalize the old list-era and Team/My work URL contracts once.
  useEffect(() => {
    if (!params.has('view') && !params.has('scope')) return
    const next = new URLSearchParams(params)
    const view = next.get('view')
    next.delete('view')
    const scope = next.get('scope')
    next.delete('scope')
    if (scope === 'mine' && me?.id) next.set('assignee', me.id)
    if (!next.has('status')) {
      if (view === 'completed') next.set('status', 'done')
      if (view === 'active') {
        next.append('status', 'todo')
        next.append('status', 'in_progress')
      }
    }
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  useEffect(() => {
    if (!layoutParam) {
      updateParams((next) => next.set('layout', layout))
      window.localStorage.setItem(storedLayoutKey(me?.id), layout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutParam, layout, me?.id])

  const filterValues: TaskFilterValues = {
    project: projectId,
    assignee: assigneeId,
    priority,
    blocked: blockedOnly,
    canceled: canceledVisible || statusFilter.includes('canceled'),
    statuses: statusFilter,
  }

  const filterCount =
    (projectId ? 1 : 0) +
    (isManager && assigneeId ? 1 : 0) +
    (priority ? 1 : 0) +
    (blockedOnly ? 1 : 0) +
    statusFilter.length +
    (canceledVisible ? 1 : 0)

  const chips = useMemo(() => {
    const result: { key: string; label: string; clear: () => void }[] = []
    if (projectId) {
      result.push({
        key: 'project',
        label: projects.data?.find((project) => project.id === projectId)?.name ?? 'Project',
        clear: () => setFilter('project', null),
      })
    }
    if (isManager && assigneeId) {
      result.push({
        key: 'assignee',
        label:
          assigneeId === 'unassigned'
            ? 'Unassigned'
            : assigneeId === me?.id
              ? 'Assigned to me'
              : users.data?.find((user) => user.id === assigneeId)?.full_name ?? 'Owner',
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
    if (blockedOnly) result.push({ key: 'blocked', label: 'Blocked', clear: () => setFilter('blocked', null) })
    if (statusFilter.length > 0) {
      result.push({
        key: 'status',
        label: statusFilter.map(statusLabel).join(', '),
        clear: () =>
          updateParams((next) => {
            next.delete('status')
            next.delete('page')
          }),
      })
    }
    if (canceledVisible) {
      result.push({
        key: 'canceled',
        label: 'Includes canceled',
        clear: () => setFilter('canceled', null),
      })
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, assigneeId, priority, blockedOnly, statusFilter, canceledVisible, projects.data, users.data, me?.id, isManager])

  function applyFilters(nextValues: TaskFilterValues) {
    updateParams((next) => {
      ;['project', 'assignee', 'priority', 'blocked', 'status', 'canceled', 'page'].forEach(
        (key) => next.delete(key),
      )
      if (nextValues.project) next.set('project', nextValues.project)
      if (isManager && nextValues.assignee) next.set('assignee', nextValues.assignee)
      if (nextValues.priority) next.set('priority', nextValues.priority)
      if (nextValues.blocked) next.set('blocked', '1')
      if (nextValues.canceled) next.set('canceled', '1')
      nextValues.statuses.forEach((status) => next.append('status', status))
    })
    setFiltersOpen(false)
  }

  function clearFilters() {
    updateParams((next) => {
      ;['project', 'assignee', 'priority', 'blocked', 'status', 'canceled', 'page'].forEach(
        (key) => next.delete(key),
      )
    })
  }

  function openTask(taskOrId: Task | string) {
    const id = typeof taskOrId === 'string' ? taskOrId : taskOrId.id
    updateParams((next) => next.set('task', id), false)
  }

  function closeTask() {
    updateParams((next) => next.delete('task'), false)
  }

  async function startStandup() {
    setStartingStandup(true)
    try {
      const created = await api.post<{ id: string }>('/standups/sessions', {})
      navigate(`/standups/${created.id}/live`)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        const sessionId = caught.details?.session_id
        if (typeof sessionId === 'string') {
          navigate(`/standups/${sessionId}/live`)
          return
        }
      }
      push(caught instanceof Error ? caught.message : 'Could not start the Huddle.', 'error')
      today.refresh()
    } finally {
      setStartingStandup(false)
    }
  }

  const session = today.data?.session ?? null

  async function openStandup() {
    if (session) {
      navigate(`/standups/${session.id}/live`)
      return
    }
    // No loaded session state (or none today): create/open through the API.
    await startStandup()
  }

  const standupAction = isManager ? (
    <button
      type="button"
      className="btn btn-secondary px-2.5 sm:px-4"
      onClick={() => void openStandup()}
      disabled={startingStandup}
    >
      {startingStandup ? <Spinner /> : <Icon name="play" />} Huddle
    </button>
  ) : null

  const matchesCurrentFilters = useCallback(
    (task: Task) => {
      const lane = displayStatus(task.status)
      if (!visibleStatuses.includes(lane)) return false
      if (statusFilter.length > 0 && !statusFilter.includes(lane)) return false
      if (projectId && task.project_id !== projectId) return false
      if (
        assigneeId &&
        (assigneeId === 'unassigned'
          ? task.assignee !== null
          : task.assignee?.id !== assigneeId)
      ) {
        return false
      }
      if (priority && task.priority !== priority) return false
      if (blockedOnly && !task.is_blocked) return false
      if (
        search &&
        !task.title.toLowerCase().includes(search.toLowerCase()) &&
        !task.public_id.toLowerCase().includes(search.toLowerCase())
      ) {
        return false
      }
      return true
    },
    [
      visibleStatuses,
      statusFilter,
      projectId,
      assigneeId,
      priority,
      blockedOnly,
      search,
    ],
  )

  const defaultProjectId = projectId || adHoc?.id || undefined

  return (
    <div className="min-w-0">
      <h1 className="sr-only">Tasks</h1>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <SegmentedControl
            items={[
              { value: 'board', label: 'Board' },
              { value: 'table', label: 'Table' },
            ]}
            value={layout}
            onChange={(value) => setLayout(value as Layout)}
            label="Task presentation"
            role="tablist"
          />
          <div className="relative w-[30%] min-w-[180px] flex-none">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle">
              <Icon name="search" className="h-4 w-4" />
            </span>
            <input
              className="input pl-9 pr-9"
              placeholder="Search tasks…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label="Search tasks"
            />
            {searchInput && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-subtle hover:bg-recessed hover:text-ink"
                aria-label="Clear search"
                onClick={() => setSearchInput('')}
              >
                <Icon name="x" className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            ref={filtersButtonRef}
            type="button"
            className="btn btn-secondary"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((value) => !value)}
          >
            <Icon name="filter" /> Filters
            {filterCount > 0 && (
              <span className="tabular rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-foreground">
                {filterCount}
              </span>
            )}
          </button>
        </div>

        <div aria-hidden="true" className="mx-1 hidden h-7 w-px shrink-0 bg-hairline sm:block" />

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {isManager && (
            <button
              type="button"
              className="btn btn-secondary px-2.5 sm:px-4"
              onClick={() => setCreatingProject(true)}
              aria-label="New project"
              title="New project"
            >
              <Icon name="folder" /> New project
            </button>
          )}
          {standupAction}
          <button
            type="button"
            className="btn btn-primary px-2.5 sm:px-4"
            onClick={() => setCreating({ status: 'todo' })}
          >
            <Icon name="plus" /> New task
          </button>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {chips.map((chip) => (
              <span key={chip.key} className="chip">
                <button type="button" className="hover:text-ink" onClick={() => setFiltersOpen(true)}>
                  {chip.label}
                </button>
                <button
                  type="button"
                  className="rounded p-0.5 text-ink-subtle hover:bg-recessed hover:text-ink"
                  aria-label={`Remove filter ${chip.label}`}
                  onClick={chip.clear}
                >
                  <Icon name="x" className="h-3 w-3" />
                </button>
              </span>
            ))}
            <button
              type="button"
              className="rounded-full px-2 py-1 text-xs font-medium text-ink-muted hover:text-ink"
              onClick={clearFilters}
            >
              Clear filters
            </button>
        </div>
      )}

      {layout === 'board' ? (
        <BoardPresentation
          key={me?.id}
          filters={{
            projectId,
            assigneeId,
            priority,
            blockedOnly,
            search,
            statuses: visibleStatuses,
            statusFilter,
          }}
          isManager={isManager}
          selectedTaskId={selectedTaskId}
          refreshToken={refreshToken}
          matchesCurrentFilters={matchesCurrentFilters}
          mobileLane={mobileLane}
          onMobileLane={(status) => setFilter('lane', status)}
          openTask={openTask}
          onCreate={(status) => setCreating({ status })}
        />
      ) : (
        <TablePresentation
          filters={{
            projectId,
            assigneeId,
            priority,
            blockedOnly,
            canceledVisible,
            statusFilter,
            search,
          }}
          sort={sort}
          page={page}
          isManager={isManager}
          users={users.data ?? []}
          refreshToken={refreshToken}
          onSort={(next) => {
            updateParams((paramsNext) => {
              paramsNext.set('sort', next)
              paramsNext.delete('page')
            })
          }}
          onPage={(next) => updateParams((paramsNext) => paramsNext.set('page', String(next)))}
          onOpen={(task) => openTask(task)}
          onClampPage={() => updateParams((paramsNext) => paramsNext.delete('page'))}
        />
      )}

      <FiltersPanel
        open={filtersOpen}
        anchor={filtersButtonRef.current}
        values={filterValues}
        projects={projects.data ?? []}
        users={users.data ?? []}
        isManager={isManager}
        meId={me?.id ?? null}
        projectsLoading={projects.loading && !projects.data}
        projectsError={projects.error}
        usersError={users.error}
        onRetryOptions={projects.refresh}
        onRetryUsers={users.refresh}
        onApply={applyFilters}
        onClose={() => {
          setFiltersOpen(false)
          filtersButtonRef.current?.focus()
        }}
      />

      {selectedTaskId && (
        <TaskDialog
          key={selectedTaskId}
          taskId={selectedTaskId}
          onClose={closeTask}
          onChanged={() => setRefreshToken((value) => value + 1)}
        />
      )}

      {creatingProject && (
        <ProjectCreateDialog
          users={users.data ?? []}
          onClose={() => setCreatingProject(false)}
          onCreated={(project) => {
            setCreatingProject(false)
            projects.refresh()
            push('Project created.', 'success', {
              action: { label: 'Filter', onClick: () => setFilter('project', project.id) },
            })
          }}
        />
      )}

      {creating && (
        <TaskCreateDialog
          projects={projects.data ?? []}
          users={users.data ?? []}
          projectsLoading={projects.loading}
          projectsError={projects.error}
          onRetryOptions={projects.refresh}
          defaultProjectId={defaultProjectId}
          defaultStatus={creating.status}
          onClose={() => setCreating(null)}
          onCreated={(task) => {
            setCreating(null)
            projects.refresh()
            setRefreshToken((value) => value + 1)
            if (matchesCurrentFilters(task)) {
              push('Task created.')
            } else {
              push('Created — outside the current filters.', 'info', {
                action: { label: 'View task', onClick: () => openTask(task) },
                duration: 8000,
              })
            }
          }}
        />
      )}
    </div>
  )
}

interface PresentationFilters {
  projectId: string
  assigneeId: string
  priority: string
  blockedOnly: boolean
  search: string
}

function BoardPresentation({
  filters,
  isManager,
  selectedTaskId,
  refreshToken,
  matchesCurrentFilters,
  mobileLane,
  onMobileLane,
  openTask,
  onCreate,
}: {
  filters: PresentationFilters & { statuses: TaskStatus[]; statusFilter: TaskStatus[] }
  isManager: boolean
  selectedTaskId: string | null
  refreshToken: number
  matchesCurrentFilters: (task: Task) => boolean
  mobileLane: TaskStatus
  onMobileLane: (status: TaskStatus) => void
  openTask: (taskOrId: Task | string) => void
  onCreate: (status: TaskStatus) => void
}) {
  const { push } = useToast()
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const pendingIdsRef = useRef(new Set<string>())
  const [announcement, setAnnouncement] = useState('')
  const [lifted, setLifted] = useState<{ task: Task; target: TaskStatus } | null>(null)
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches,
  )
  const board = useBoardData({
    projectId: filters.projectId,
    assigneeId: filters.assigneeId,
    priority: filters.priority,
    blockedOnly: filters.blockedOnly,
    search: filters.search,
    statuses: filters.statuses,
    statusFilter: filters.statusFilter,
  })

  useEffect(() => {
    const media = window.matchMedia(NARROW_QUERY)
    const update = () => setIsNarrow(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (refreshToken > 0) board.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken])

  async function moveTask(task: Task, to: TaskStatus) {
    if (task.status === to) return
    if (!task.can_move) {
      push('You do not have permission to change this task.', 'error')
      return
    }
    if (pendingIdsRef.current.has(task.id)) {
      push('This task is already being moved.', 'info')
      return
    }
    pendingIdsRef.current.add(task.id)
    setPendingIds(new Set(pendingIdsRef.current))
    board.applyMove(task, to)
    setAnnouncement(`Moving ${task.title} to ${statusLabel(to)}.`)
    try {
      const updated = await api.patch<Task>(`/tasks/${task.id}/status`, {
        status: to,
        expected_version: task.version,
      })
      pendingIdsRef.current.delete(task.id)
      setPendingIds(new Set(pendingIdsRef.current))
      board.patchLocal(updated)
      board.refresh(displayStatus(task.status))
      board.refresh(to)
      if (!matchesCurrentFilters(updated)) {
        board.removeLocal(updated.id)
        push(`Moved to ${statusLabel(to)} — outside the current filters.`, 'success', {
          action: { label: 'View task', onClick: () => openTask(updated.id) },
          duration: 8000,
        })
      } else {
        push(`Moved to ${statusLabel(to)}`, 'success', {
          action: {
            label: 'Undo',
            onClick: () => undoMove(updated.id, task.status, updated.version),
          },
          duration: 8000,
        })
      }
      setAnnouncement(`Moved ${task.title} to ${statusLabel(to)}.`)
    } catch (caught) {
      pendingIdsRef.current.delete(task.id)
      setPendingIds(new Set(pendingIdsRef.current))
      board.refresh(displayStatus(task.status))
      board.refresh(to)
      if (caught instanceof ApiError && caught.status === 409) {
        try {
          const latest = await api.get<Task>(`/tasks/${task.id}`)
          board.patchLocal(latest)
          board.refresh(displayStatus(latest.status))
          push(
            'This task changed since it was loaded, so the move was not applied. The latest state is shown.',
            'error',
            { action: { label: 'View task', onClick: () => openTask(latest.id) }, duration: 9000 },
          )
        } catch {
          push('This task changed since it was loaded. Reload the board and try again.', 'error')
        }
      } else {
        push(caught instanceof Error ? caught.message : 'The move failed.', 'error', {
          action: { label: 'View task', onClick: () => openTask(task.id) },
          duration: 9000,
        })
      }
      setAnnouncement(`Move failed. ${task.title} was restored.`)
    }
  }

  async function undoMove(taskId: string, from: TaskStatus, version: number) {
    try {
      const updated = await api.patch<Task>(`/tasks/${taskId}/status`, {
        status: from,
        expected_version: version,
      })
      board.patchLocal(updated)
      board.refresh(displayStatus(from))
      board.refresh(displayStatus(updated.status))
      push(`Moved back to ${statusLabel(from)}`)
    } catch {
      board.refresh()
      push('Undo is no longer safe — this task changed again. The latest state is loaded.', 'error', {
        action: { label: 'View task', onClick: () => openTask(taskId) },
        duration: 9000,
      })
    }
  }

  function handleKeyboardMove(event: ReactKeyboardEvent<HTMLElement>, task: Task) {
    if (!task.can_move) return
    if (!lifted || lifted.task.id !== task.id) {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        setLifted({ task, target: task.status })
        setAnnouncement(
          `Picked up ${task.title} from ${statusLabel(task.status)}. Use left and right arrows to choose a column, Enter to drop, Escape to cancel.`,
        )
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setAnnouncement(`Move canceled. ${task.title} stays in ${statusLabel(task.status)}.`)
      setLifted(null)
      return
    }
    if (event.key === 'Tab') {
      setLifted(null)
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const order = filters.statuses
      const index = order.indexOf(lifted.target)
      const nextIndex =
        event.key === 'ArrowRight' ? Math.min(index + 1, order.length - 1) : Math.max(index - 1, 0)
      const target = order[nextIndex]
      setLifted({ task, target })
      setAnnouncement(`${statusLabel(target)} selected. Enter to drop, Escape to cancel.`)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const target = lifted.target
      setLifted(null)
      void moveTask(task, target)
    }
  }

  useEffect(() => {
    if (!lifted) {
      document.body.removeAttribute('data-board-keyboard-drag')
      return
    }
    document.body.setAttribute('data-board-keyboard-drag', '')
    return () => document.body.removeAttribute('data-board-keyboard-drag')
  }, [lifted])

  useEffect(() => {
    if (!lifted) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setAnnouncement(`Move canceled. ${lifted.task.title} stays in ${statusLabel(lifted.task.status)}.`)
        setLifted(null)
        document
          .querySelector<HTMLElement>(`[data-task-id="${lifted.task.id}"] button[aria-label^="Move "]`)
          ?.focus()
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => document.removeEventListener('keydown', handleKey, true)
  }, [lifted])

  const { drag, overStatus, beginPointerDrag } = useBoardDrag({ onCommit: moveTask, enabled: true })
  const laneItems: SegmentItem<TaskStatus>[] = filters.statuses.map((status) => ({
    value: status,
    label: statusLabel(status),
    count: board.lanes[status]?.total ?? 0,
  }))
  const narrowLane =
    filters.statusFilter.length > 0 && !filters.statusFilter.includes(mobileLane)
      ? filters.statusFilter[0]
      : mobileLane

  return (
    <div>
      <p aria-live="assertive" className="sr-only">
        {announcement}
      </p>

      {isNarrow ? (
        <div>
          <div className="mb-2.5 overflow-x-auto pb-1">
            <SegmentedControl
              items={laneItems}
              value={narrowLane}
              onChange={onMobileLane}
              label="Choose a column"
              role="tablist"
            />
          </div>
          <KanbanColumn
            lane={board.lanes[narrowLane] ?? board.lanes.todo}
            showProject={!filters.projectId}
            canCreate
            isDropTarget={false}
            isLiftTarget={false}
            pendingIds={pendingIds}
            selectedTaskId={selectedTaskId}
            liftedTaskId={null}
            liftedTargetStatus={null}
            onCreate={onCreate}
            onOpen={(task) => openTask(task)}
            onLoadMore={board.loadMore}
            onRetry={board.refresh}
            onPointerDragStart={beginPointerDrag}
            onKeyboardKeyDown={handleKeyboardMove}
          />
        </div>
      ) : (
        <div className="overflow-x-auto pb-3">
          <div className="flex min-w-full items-stretch gap-4">
            {filters.statuses.map((status) => (
              <div key={status} className="flex min-w-[280px] max-w-[360px] flex-1 flex-col">
                <KanbanColumn
                  lane={board.lanes[status]}
                  showProject={!filters.projectId}
                  canCreate
                  isDropTarget={overStatus === status && drag?.task.status !== status}
                  isLiftTarget={lifted?.target === status && lifted.task.status !== status}
                  pendingIds={pendingIds}
                  selectedTaskId={selectedTaskId}
                  liftedTaskId={lifted?.task.id ?? null}
                  liftedTargetStatus={lifted?.target ?? null}
                  draggingTaskId={drag?.task.id ?? null}
                  onCreate={onCreate}
                  onOpen={(task) => openTask(task)}
                  onLoadMore={board.loadMore}
                  onRetry={board.refresh}
                  onPointerDragStart={beginPointerDrag}
                  onKeyboardKeyDown={handleKeyboardMove}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      <DragOverlay drag={drag} overStatus={overStatus} />
    </div>
  )
}

function TablePresentation({
  filters,
  sort,
  page,
  isManager,
  users,
  refreshToken,
  onSort,
  onPage,
  onOpen,
  onClampPage,
}: {
  filters: PresentationFilters & {
    canceledVisible: boolean
    statusFilter: TaskStatus[]
  }
  sort: string
  page: number
  isManager: boolean
  users: User[]
  refreshToken: number
  onSort: (next: string) => void
  onPage: (next: number) => void
  onOpen: (task: Task) => void
  onClampPage: () => void
}) {
  const { push } = useToast()
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const baseStatuses = filters.statusFilter.length ? filters.statusFilter : TABLE_STATUSES
  const expanded = baseStatuses.includes('todo') && !baseStatuses.includes('backlog')
    ? [...baseStatuses, 'backlog']
    : baseStatuses
  const statusParam =
    filters.canceledVisible && !expanded.includes('canceled')
      ? [...expanded, 'canceled']
      : expanded
  const table = useAsync<Page<Task>>(
    () =>
      api.get(
        `/tasks${query({
          project_id: filters.projectId || undefined,
          assignee_id: filters.assigneeId || undefined,
          priority: filters.priority || undefined,
          blocked: filters.blockedOnly || undefined,
          q: filters.search || undefined,
          status: statusParam,
          sort,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        })}`,
      ),
    [
      filters.projectId,
      filters.assigneeId,
      filters.priority,
      filters.blockedOnly,
      filters.search,
      statusParam?.join(','),
      sort,
      page,
      refreshToken,
    ],
  )

  useEffect(() => {
    if (
      page > 0 &&
      !table.loading &&
      table.data &&
      table.data.items.length === 0 &&
      table.data.total > 0
    ) {
      onClampPage()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, table.loading, table.data?.items.length, table.data?.total])

  async function patchTask(
    task: Task,
    payload: Record<string, unknown>,
    message?: string,
  ) {
    setPendingIds((current) => new Set(current).add(task.id))
    try {
      const updated = await api.patch<Task>(`/tasks/${task.id}`, {
        ...payload,
        expected_version: task.version,
      })
      if (message) push(message)
      table.refresh()
      return updated
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        push('This task changed since it was loaded. The latest state is shown.', 'error', {
          action: { label: 'View task', onClick: () => onOpen(task) },
          duration: 9000,
        })
      } else {
        push(caught instanceof Error ? caught.message : 'The update failed.', 'error')
      }
      table.refresh()
      return undefined
    } finally {
      setPendingIds((current) => {
        const next = new Set(current)
        next.delete(task.id)
        return next
      })
    }
  }

  async function changeStatus(task: Task, status: TaskStatus) {
    if (displayStatus(task.status) === status) return
    if (!task.can_move) {
      push('You do not have permission to change this task.', 'error')
      return
    }
    const updated = await patchTask(task, { status })
    if (updated) {
      push(`Moved to ${statusLabel(status)}`, 'success', {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await api.patch<Task>(`/tasks/${task.id}/status`, {
                status: task.status,
                expected_version: updated.version,
              })
              push(`Moved back to ${statusLabel(task.status)}`)
              table.refresh()
            } catch {
              push('Undo is no longer safe — this task changed again.', 'error')
              table.refresh()
            }
          },
        },
        duration: 8000,
      })
    }
  }

  async function changeOwner(task: Task, ownerId: string) {
    if ((task.assignee?.id ?? '') === ownerId) return
    await patchTask(task, { assignee_id: ownerId || null }, 'Owner updated.')
  }

  return (
    <TaskTable
      tasks={table.data?.items ?? []}
      total={table.data?.total ?? 0}
      loading={table.loading}
      error={table.error}
      page={page}
      sort={sort}
      isManager={isManager}
      users={users}
      pendingIds={pendingIds}
      onSort={onSort}
      onPage={onPage}
      onRetry={table.refresh}
      onOpen={onOpen}
      onChangeStatus={(task, status) => void changeStatus(task, status)}
      onChangeOwner={(task, ownerId) => void changeOwner(task, ownerId)}
    />
  )
}

