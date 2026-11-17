import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Icon } from '../icons'
import { Skeleton } from '../ui'
import TaskCard from './TaskCard'
import { LANE_LIMIT_CAP } from './useBoardData'
import type { BoardLane } from './useBoardData'
import { statusLabel as labelForStatus } from '../../lib/taskDisplay'
import { statusTextClass } from '../../lib/taskDisplay'
import type { Task, TaskStatus } from '../../lib/types'

const statusTone: Record<TaskStatus, string> = {
  backlog: 'bg-lavender',
  todo: 'bg-info',
  in_progress: 'bg-accent',
  done: 'bg-success',
  canceled: 'bg-ink-subtle',
}

const emptyCopy: Record<TaskStatus, { title: string; description: string }> = {
  backlog: { title: 'Nothing parked', description: 'Ideas and later work land here.' },
  todo: { title: 'Nothing queued', description: 'Add the next piece of committed work.' },
  in_progress: { title: 'Nothing in flight', description: 'Drag a card here when work starts.' },
  done: { title: 'Nothing completed yet', description: 'Completed work arrives when a task is marked done.' },
  canceled: { title: 'No canceled tasks', description: 'Canceled work stays visible here, never deleted.' },
}

const addableStatuses: TaskStatus[] = ['backlog', 'todo', 'in_progress']

export interface KanbanColumnProps {
  lane: BoardLane
  showProject: boolean
  canCreate: boolean
  isDropTarget: boolean
  isLiftTarget: boolean
  pendingIds: Set<string>
  selectedTaskId: string | null
  liftedTaskId: string | null
  liftedTargetStatus: TaskStatus | null
  draggingTaskId?: string | null
  onCreate: (status: TaskStatus) => void
  onOpen: (task: Task) => void
  onLoadMore: (status: TaskStatus) => void
  onRetry: (status: TaskStatus) => void
  onPointerDragStart: (event: ReactPointerEvent<HTMLElement>, task: Task) => void
  onKeyboardKeyDown: (event: ReactKeyboardEvent<HTMLElement>, task: Task) => void
}

export default function KanbanColumn({
  lane,
  showProject,
  canCreate,
  isDropTarget,
  isLiftTarget,
  pendingIds,
  selectedTaskId,
  liftedTaskId,
  liftedTargetStatus,
  draggingTaskId = null,
  onCreate,
  onOpen,
  onLoadMore,
  onRetry,
  onPointerDragStart,
  onKeyboardKeyDown,
}: KanbanColumnProps) {
  const label = labelForStatus(lane.status)
  const copy = emptyCopy[lane.status]
  const canAdd = canCreate && addableStatuses.includes(lane.status) && !lane.filteredOut

  return (
    <section
      data-lane-status={lane.status}
      aria-label={`${label} column`}
      className={`lane w-full min-w-0 flex-1 transition-colors duration-180 ${
        isDropTarget || isLiftTarget ? 'lane-drop' : ''
      } ${lane.filteredOut ? 'opacity-80' : ''}`}
    >
      <header
        className={`flex items-center justify-between gap-2 rounded-t-card border-b px-3.5 py-2.5 ${
          isDropTarget || isLiftTarget
            ? 'border-signal/40 bg-accent-tint/90'
            : 'border-hairline bg-recessed/95'
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusTone[lane.status]}`} aria-hidden="true" />
          <h2 className={`truncate text-sm font-semibold ${statusTextClass(lane.status)}`}>{label}</h2>
          <span className="tabular rounded-full bg-raised/80 px-1.5 py-0.5 text-[11px] font-semibold text-ink-muted">
            {lane.error || lane.filteredOut
              ? '—'
              : lane.loading && lane.total === 0
                ? '–'
                : lane.total}
          </span>
        </div>
        {canAdd && (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-ink-muted transition-colors duration-140 hover:bg-raised hover:text-accent"
            onClick={() => onCreate(lane.status)}
            aria-label={`Add task to ${label}`}
          >
            <Icon name="plus" className="h-3.5 w-3.5" /> Add task
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-2.5">
        {lane.filteredOut ? (
          <div className="rounded-md border border-dashed border-hairline bg-raised/50 px-3 py-6 text-center">
            <p className="text-xs font-medium text-ink-muted">Filtered out</p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
              Cards are hidden by the status filter. Dropping here still moves a task to {label}.
            </p>
          </div>
        ) : lane.error ? (
          <div className="rounded-md border border-danger/30 bg-danger-tint px-3 py-3 text-xs text-danger">
            <p className="flex items-center gap-1.5 font-semibold">
              <Icon name="alert" className="h-3.5 w-3.5" /> This column didn’t load
            </p>
            <p className="mt-1 text-danger/80">The count is unknown — not zero.</p>
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-danger/30 bg-raised px-2 py-1 font-medium text-danger hover:bg-danger-tint"
              onClick={() => onRetry(lane.status)}
            >
              <Icon name="refresh" className="h-3 w-3" /> Retry
            </button>
          </div>
        ) : lane.loading && lane.loaded === 0 ? (
          <div className="space-y-2.5" aria-hidden="true">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-20 w-3/4" />
          </div>
        ) : lane.loaded === 0 ? (
          <div
            className={`rounded-md border border-dashed px-3 py-6 text-center transition-colors duration-180 ${
              isDropTarget || isLiftTarget
                ? 'border-accent/50 bg-accent-tint/60'
                : 'border-hairline bg-raised/40'
            }`}
          >
            <p className="text-xs font-medium text-ink-muted">
              {isDropTarget || isLiftTarget ? 'Drop here' : copy.title}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
              {isDropTarget || isLiftTarget ? `Moves this task to ${label}.` : copy.description}
            </p>
          </div>
        ) : (
          lane.items.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              showProject={showProject}
              canMove={task.can_move}
              pending={pendingIds.has(task.id)}
              selected={selectedTaskId === task.id}
              lifted={liftedTaskId === task.id}
              dragging={draggingTaskId === task.id}
              liftingStatus={liftedTaskId === task.id ? liftedTargetStatus : null}
              onOpen={onOpen}
              onPointerDragStart={onPointerDragStart}
              onKeyboardKeyDown={onKeyboardKeyDown}
            />
          ))
        )}

        {!lane.filteredOut && !lane.error && lane.loaded > 0 && lane.total > lane.loaded && (
          <button
            type="button"
            className="mt-0.5 rounded-md border border-hairline bg-raised/70 px-2 py-2 text-xs font-medium text-ink-muted transition-colors duration-140 hover:bg-raised hover:text-accent disabled:opacity-60"
            onClick={() => onLoadMore(lane.status)}
            disabled={lane.loading || lane.loaded >= LANE_LIMIT_CAP}
          >
            {lane.loaded >= LANE_LIMIT_CAP
              ? `Showing first ${LANE_LIMIT_CAP} of ${lane.total} — narrow filters to see the rest`
              : `Show more — ${lane.loaded} of ${lane.total} loaded`}
          </button>
        )}
        {lane.loaded > 0 && lane.total <= lane.loaded && lane.loaded < LANE_LIMIT_CAP && (
          <p className="px-1 pb-0.5 text-center text-[10px] text-ink-subtle">
            All {lane.total} loaded
          </p>
        )}
      </div>
    </section>
  )
}
