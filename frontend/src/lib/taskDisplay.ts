import { PRIORITIES, TASK_STATUSES, type Priority, type Task, type TaskStatus } from './types'

export interface TaskException {
  label: string
  detail: string | null
  tone: string
}

/** The compact exception indicators shared by cards, tables and Today. */
export function taskExceptions(task: Task): TaskException[] {
  const issues: TaskException[] = []
  if (task.is_blocked) {
    issues.push({ label: 'Blocked', detail: task.blocked_by, tone: 'text-danger' })
  }
  return issues
}

/** Status is always represented by text colour, never a chrome-heavy badge. */
export const STATUS_TEXT_CLASS: Record<string, string> = {
  backlog: 'text-lavender',
  todo: 'text-info',
  in_progress: 'text-warning',
  done: 'text-success',
  canceled: 'text-ink-subtle',
}

/** Backlog and To Do share one visible category. */
export function displayStatus(status: TaskStatus): TaskStatus {
  return status === 'backlog' ? 'todo' : status
}

export function statusLabel(status: TaskStatus): string {
  const value = displayStatus(status)
  return TASK_STATUSES.find((item) => item.value === value)?.label ?? 'To Do'
}

export function statusTextClass(status: string): string {
  return STATUS_TEXT_CLASS[status] ?? 'text-ink'
}

export function shortUpdate(value: string, length = 84): string {
  return value.length > length ? `${value.slice(0, length)}…` : value
}


/** Priority is a compact label, not a second status system. */
export const PRIORITY_BADGE_CLASS: Record<string, string> = {
  urgent: 'bg-danger-tint text-danger',
  high: 'bg-warning-tint text-warning',
  medium: 'bg-recessed text-ink-muted',
  low: 'bg-recessed text-ink-subtle',
}

export function priorityLabel(priority: Priority | string): string {
  return PRIORITIES.find((item) => item.value === priority)?.label ?? 'Medium'
}

export function priorityTextClass(priority: Priority | string): string {
  return priority === 'urgent'
    ? 'text-danger'
    : priority === 'high'
      ? 'text-warning'
      : priority === 'low'
        ? 'text-ink-subtle'
        : 'text-ink-muted'
}
