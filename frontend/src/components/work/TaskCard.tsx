import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { Icon } from '../icons'
import { Avatar, Spinner } from '../ui'
import type { Task, TaskStatus } from '../../lib/types'
import { PRIORITY_BADGE_CLASS, priorityLabel, statusLabel } from '../../lib/taskDisplay'

export interface TaskCardProps {
  task: Task
  showProject: boolean
  canMove: boolean
  pending: boolean
  selected: boolean
  lifted: boolean
  dragging?: boolean
  liftingStatus?: TaskStatus | null
  onOpen: (task: Task) => void
  onPointerDragStart: (event: ReactPointerEvent<HTMLElement>, task: Task) => void
  onKeyboardKeyDown: (event: ReactKeyboardEvent<HTMLElement>, task: Task) => void
}

/**
 * Board card. The whole card opens the centered updates view; dragging still
 * wins when the pointer moves, because the drag helper swallows the click.
 */
export default function TaskCard({
  task,
  showProject,
  canMove,
  pending,
  selected,
  lifted,
  dragging = false,
  liftingStatus,
  onOpen,
  onPointerDragStart,
  onKeyboardKeyDown,
}: TaskCardProps): ReactNode {
  return (
    <article
      aria-label={task.title}
      aria-busy={pending || undefined}
      data-task-id={task.id}
      data-selected={selected || undefined}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('[data-no-drag], button, a, input, textarea, select, [role="menu"]')) {
          return
        }
        onOpen(task)
      }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('[data-no-drag], a, input, textarea, select, [role="menu"]')) return
        onPointerDragStart(event, task)
      }}
      className={`group relative cursor-pointer rounded-card border bg-raised p-3.5 text-left transition-[box-shadow,border-color,transform,opacity] duration-140 ease-settle ${
        selected
          ? 'border-accent/60 ring-2 ring-accent/30 shadow-card'
          : 'border-hairline shadow-card hover:-translate-y-px hover:border-accent/40 hover:shadow-card-hover'
      } ${pending ? 'opacity-70' : ''} ${dragging ? 'opacity-40' : ''} ${lifted ? 'border-accent/70 shadow-card-hover' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-3 text-left text-[14px] font-medium leading-snug text-ink sm:text-[14.5px]">
            {task.title}
          </p>
          <p className="mt-1 truncate text-xs text-ink-muted">
            <span className="font-mono text-[11px]">{task.public_id}</span>
            {showProject && task.project_name ? ` · ${task.project_name}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canMove && (
            <button
              type="button"
              data-no-drag
              aria-label={`Move ${task.title}`}
              aria-pressed={lifted}
              onKeyDown={(event) => onKeyboardKeyDown(event, task)}
              onClick={(event) => event.stopPropagation()}
              className={`inline-flex h-7 w-6 items-center justify-center rounded text-ink-subtle transition-opacity duration-140 hover:bg-recessed hover:text-ink focus-visible:opacity-100 ${
                lifted ? 'opacity-100 text-accent' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                <circle cx="9" cy="6" r="1.4" />
                <circle cx="15" cy="6" r="1.4" />
                <circle cx="9" cy="12" r="1.4" />
                <circle cx="15" cy="12" r="1.4" />
                <circle cx="9" cy="18" r="1.4" />
                <circle cx="15" cy="18" r="1.4" />
              </svg>
            </button>
          )}
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold leading-4 ${PRIORITY_BADGE_CLASS[task.priority] ?? PRIORITY_BADGE_CLASS.medium}`}
            title={`Priority: ${priorityLabel(task.priority)}`}
            aria-label={`Priority: ${priorityLabel(task.priority)}`}
          >
            {priorityLabel(task.priority)}
          </span>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2 text-xs text-ink-muted">
        <span className="flex min-w-0 items-center gap-1.5">
          {task.assignee ? (
            <>
              <Avatar name={task.assignee.full_name} size="sm" />
              <span className="truncate">{task.assignee.full_name}</span>
            </>
          ) : (
            <>
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-hairline text-ink-subtle">
                <Icon name="user" className="h-3 w-3" />
              </span>
              <span className="truncate text-ink-subtle">Unassigned</span>
            </>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {pending && <Spinner className="h-3 w-3 text-ink-subtle" />}
          {(task.blocked_by || task.is_blocked) && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-danger-tint px-1.5 py-0.5 text-[11px] font-semibold text-danger"
              title={task.blocked_by ?? 'Blocked'}
              aria-label={task.blocked_by ? `Blocked: ${task.blocked_by}` : 'Blocked'}
            >
              <Icon name="alert" className="h-3 w-3" strokeWidth={2} />
              Blocked
            </span>
          )}
        </span>
      </div>

      {liftingStatus && (
        <p className="mt-2 rounded-md bg-accent-tint px-2 py-1 text-[11px] font-medium text-accent">
          Move to {statusLabel(liftingStatus)} with ← →, Enter to drop, Esc to cancel
        </p>
      )}
    </article>
  )
}
