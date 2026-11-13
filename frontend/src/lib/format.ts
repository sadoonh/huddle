export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value.endsWith('Z') ? value : `${value}Z`)
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value.endsWith('Z') ? value : `${value}Z`)
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function relativeDay(value: string | null | undefined): string {
  if (!value) return '—'
  const target = new Date(`${value.slice(0, 10)}T12:00:00`)
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff < 0) return `${Math.abs(diff)}d overdue`
  return `in ${diff}d`
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')
}

export function humanize(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function truncate(value: string, length = 120): string {
  return value.length > length ? `${value.slice(0, length)}…` : value
}

export function todayISO(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}


let businessDate: string | null = null

/** Set by the app from GET /meta. Keeps date math on the team's server day. */
export function setBusinessDate(value: string | null): void {
  businessDate = value
}

function parseDateOnly(value: string): Date {
  return new Date(`${value.slice(0, 10)}T12:00:00`)
}

function referenceDate(): Date {
  return businessDate ? parseDateOnly(businessDate) : new Date()
}

export function todayISOValue(): string {
  const now = referenceDate()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function formatDueDate(value: string | null | undefined): string {
  if (!value) return 'No due date'
  const target = parseDateOnly(value)
  const reference = referenceDate()
  reference.setHours(12, 0, 0, 0)
  target.setHours(12, 0, 0, 0)
  const diff = Math.round((target.getTime() - reference.getTime()) / 86_400_000)
  if (diff === 0) return 'Due today'
  if (diff === 1) return 'Due tomorrow'
  if (diff === -1) return '1 day overdue'
  if (diff < -1) return `${Math.abs(diff)} days overdue`
  if (diff <= 7) return `Due in ${diff} days`
  return `Due ${formatDate(value)}`
}

export function formatAge(value: string | null | undefined): string {
  if (!value) return ''
  const created = parseDateOnly(value)
  const reference = referenceDate()
  reference.setHours(12, 0, 0, 0)
  created.setHours(12, 0, 0, 0)
  const days = Math.max(Math.round((reference.getTime() - created.getTime()) / 86_400_000), 0)
  if (days === 0) return 'Opened today'
  if (days === 1) return 'Opened yesterday'
  return `Opened ${days} days ago`
}

export function formatSessionDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = parseDateOnly(value)
  const currentYear = new Date().getFullYear()
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== currentYear ? { year: 'numeric' } : {}),
  })
}

export function formatDueDateShort(value: string | null | undefined): string {
  return value ? formatDueDate(value) : 'No due date'
}


export function formatLongDate(value: string | null | undefined): string {
  if (!value) return ''
  const date = parseDateOnly(value)
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}


export function formatDueDateForStatus(
  value: string | null | undefined,
  closed: boolean,
): string {
  if (!value) return 'No due date'
  if (closed && value.slice(0, 10) < todayISOValue()) return `Due ${formatDate(value)}`
  return formatDueDate(value)
}


export function formatOpenAge(days: number): string {
  if (days <= 0) return 'Opened today'
  if (days === 1) return '1 day open'
  return `${days} days open`
}
