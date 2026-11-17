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

export function formatLongDate(value: string | null | undefined): string {
  if (!value) return ''
  const date = parseDateOnly(value)
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}


