import { type ReactNode } from 'react'
import { Icon } from '../icons'
import MorphSelect from '../MorphSelect'
import { ErrorBox, Skeleton, Spinner } from '../ui'
import { formatDateTime } from '../../lib/format'
import { priorityLabel, priorityTextClass, shortUpdate, statusTextClass } from '../../lib/taskDisplay'
import { TASK_STATUS_OPTIONS, type Task, type TaskStatus, type User } from '../../lib/types'
import { displayStatus } from '../../lib/taskDisplay'

const PAGE_SIZE = 25
const HEAD_CELL = 'px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-muted'

function SortHeader({
  label,
  field,
  sort,
  onSort,
  className = '',
}: {
  label: string
  field: string
  sort: string
  onSort: (next: string) => void
  className?: string
}): ReactNode {
  const ascending = sort === field
  const descending = sort === `-${field}`
  const active = ascending || descending
  return (
    <th
      scope="col"
      aria-sort={active ? (ascending ? 'ascending' : 'descending') : 'none'}
      className={`whitespace-nowrap ${HEAD_CELL} ${className}`}
    >
      <button
        type="button"
        className={`-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors duration-140 ${
          active ? 'text-accent' : 'text-ink-muted hover:text-ink'
        }`}
        onClick={(event) => {
          event.stopPropagation()
          onSort(ascending ? `-${field}` : field)
        }}
      >
        {label}
        <Icon
          name="chevronDown"
          className={`h-3 w-3 transition-transform duration-140 ${
            descending ? 'rotate-180' : ''
          } ${active ? 'text-accent opacity-100' : 'opacity-30'}`}
        />
      </button>
    </th>
  )
}

export interface TaskTableProps {
  tasks: Task[]
  total: number
  loading: boolean
  error: string | null
  page: number
  sort: string
  isManager: boolean
  users: User[]
  pendingIds: Set<string>
  onSort: (next: string) => void
  onPage: (next: number) => void
  onRetry: () => void
  onOpen: (task: Task) => void
  onChangeStatus: (task: Task, status: TaskStatus) => void
  onChangeOwner: (task: Task, ownerId: string) => void
}

export default function TaskTable({
  tasks,
  total,
  loading,
  error,
  page,
  sort,
  isManager,
  users,
  pendingIds,
  onSort,
  onPage,
  onRetry,
  onOpen,
  onChangeStatus,
  onChangeOwner,
}: TaskTableProps): ReactNode {
  const shownFrom = total === 0 ? 0 : page * PAGE_SIZE + 1
  const shownTo = Math.min((page + 1) * PAGE_SIZE, total)
  const ownerOptionsFor = (assignee: Task['assignee']) => {
    const options = [
      { value: '', label: 'Unassigned' },
      ...users.map((user) => ({ value: user.id, label: user.full_name })),
    ]
    // A task can remain assigned to a user who is no longer in the active
    // people list. Keep that owner selectable/visible instead of showing an
    // empty “Select…” trigger.
    if (assignee && !options.some((option) => option.value === assignee.id)) {
      options.push({ value: assignee.id, label: assignee.full_name })
    }
    return options
  }
  const columns = isManager ? 7 : 6

  return (
    <div className="rounded-card border border-hairline bg-raised shadow-panel">
      <div className="overflow-x-auto rounded-t-card xl:overflow-visible">
        <table className="w-full min-w-[1160px] border-collapse text-sm xl:min-w-0" aria-label="Tasks table">
          <caption className="sr-only">
            Tasks. Sort by clicking a column heading. Click a row to open its updates.
          </caption>
          <thead className="sticky top-0 z-10 border-b border-hairline bg-recessed/95 backdrop-blur-md lg:top-[73px]">
            <tr>
              <SortHeader label="Task" field="title" sort={sort} onSort={onSort} className="w-[21%]" />
              <th scope="col" className={HEAD_CELL}>
                Project
              </th>
              {isManager && (
                <SortHeader
                  label="Owner"
                  field="owner"
                  sort={sort}
                  onSort={onSort}
                  className="w-[180px]"
                />
              )}
              <SortHeader label="Status" field="status" sort={sort} onSort={onSort} className="w-[148px]" />
              <th scope="col" className={`${HEAD_CELL} w-[96px]`}>
                Priority
              </th>
              <th scope="col" className={`${HEAD_CELL} w-[200px]`}>
                Blocked by
              </th>
              <th scope="col" className={`${HEAD_CELL} w-[25%]`}>
                Latest update
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline/80">
            {error ? (
              <tr>
                <td colSpan={columns} className="px-4 py-8">
                  <ErrorBox message={error} onRetry={onRetry} />
                </td>
              </tr>
            ) : loading && tasks.length === 0 ? (
              Array.from({ length: 6 }).map((_, index) => (
                <tr key={index}>
                  <td colSpan={columns} className="px-4 py-4">
                    <Skeleton className="h-11 w-full" />
                  </td>
                </tr>
              ))
            ) : tasks.length === 0 ? (
              <tr>
                <td colSpan={columns} className="px-4 py-14 text-center text-sm text-ink-muted">
                  No tasks match these filters.
                </td>
              </tr>
            ) : (
              tasks.map((task) => {
                const pending = pendingIds.has(task.id)
                const person =
                  task.latest_update?.attributed_to?.full_name ??
                  task.latest_update?.author?.full_name ??
                  null
                return (
                  <tr
                    key={task.id}
                    data-task-id={task.id}
                    tabIndex={0}
                    className={`group/row cursor-pointer align-middle transition-colors duration-140 hover:bg-recessed/50 focus-visible:bg-recessed/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/25 ${
                      pending ? 'opacity-70' : ''
                    }`}
                    onClick={() => onOpen(task)}
                    onKeyDown={(event) => {
                      if ((event.target as HTMLElement).closest('button, input, select, textarea')) return
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onOpen(task)
                      }
                    }}
                  >
                    <td className="max-w-[340px] px-4 py-3.5">
                      <p className="text-left text-[13.5px] font-semibold leading-snug tracking-[-0.01em] text-ink">
                        {task.title}
                      </p>
                      <p className="mt-1 font-mono text-[10.5px] tracking-[0.02em] text-ink-subtle/80">
                        {task.public_id}
                      </p>
                    </td>
                    <td className="max-w-[170px] px-4 py-3.5">
                      <span className="block truncate text-xs text-ink-muted" title={task.project_name ?? 'No project'}>
                        {task.project_name ?? 'No project'}
                      </span>
                    </td>
                    {isManager && (
                      <td className="w-[180px] px-4 py-3.5" onClick={(event) => event.stopPropagation()}>
                        <MorphSelect
                          className="w-full max-w-[164px]"
                          size="sm"
                          variant="quiet"
                          value={task.assignee?.id ?? ''}
                          options={ownerOptionsFor(task.assignee)}
                          onChange={(value) => onChangeOwner(task, value)}
                          label={`Owner for ${task.title}`}
                          avatar
                          searchable={users.length > 8}
                          searchPlaceholder="Search people…"
                          disabled={pending}
                          title={task.assignee?.full_name ?? 'Unassigned'}
                        />
                      </td>
                    )}
                    <td className="w-[148px] px-4 py-3.5" onClick={(event) => event.stopPropagation()}>
                      <MorphSelect
                        className="w-[132px]"
                        valueClassName={statusTextClass(task.status)}
                        size="sm"
                        variant="quiet"
                        value={displayStatus(task.status)}
                        options={TASK_STATUS_OPTIONS.map((status) => ({ value: status.value, label: status.label }))}
                        onChange={(value) => onChangeStatus(task, value as TaskStatus)}
                        label={`Status for ${task.title}`}
                        disabled={pending || !task.can_move}
                      />
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`text-[11px] font-medium ${priorityTextClass(task.priority)}`}>
                        {priorityLabel(task.priority)}
                      </span>
                    </td>
                    <td className="max-w-[200px] px-4 py-3.5">
                      {task.blocked_by ? (
                        <p className="whitespace-pre-wrap text-xs leading-relaxed text-danger">{task.blocked_by}</p>
                      ) : (
                        <span className="text-xs text-ink-subtle/70" aria-label="Not blocked">
                          —
                        </span>
                      )}
                    </td>
                    <td className="max-w-[260px] px-4 py-3.5">
                      {pending ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                          <Spinner className="h-3 w-3" /> Saving…
                        </span>
                      ) : task.latest_update ? (
                        <div>
                          <p className="text-[12.5px] leading-relaxed text-ink">
                            {shortUpdate(task.latest_update.progress)}
                          </p>
                          <p className="mt-1 text-[10.5px] tracking-wide text-ink-subtle">
                            {person ?? '—'} <span className="text-ink-subtle/60">·</span>{' '}
                            {formatDateTime(task.latest_update.created_at)}
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-ink-subtle/80">No update yet</p>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-4 py-2.5 text-xs text-ink-muted">
        <span className="tabular-nums">
          {total === 0 ? 'No tasks' : `${shownFrom}–${shownTo} of ${total}`}
          {loading && <span className="ml-2 text-[11px] text-ink-subtle">Refreshing…</span>}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={page === 0 || loading}
            onClick={() => onPage(page - 1)}
          >
            <Icon name="chevronLeft" className="h-3 w-3" /> Previous
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={shownTo >= total || loading}
            onClick={() => onPage(page + 1)}
          >
            Next <Icon name="chevronRight" className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  )
}

export { PAGE_SIZE }
