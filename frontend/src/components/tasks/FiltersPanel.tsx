import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../icons'
import MorphSelect from '../MorphSelect'
import { Modal } from '../ui'
import { PRIORITIES, TASK_STATUS_OPTIONS, type Priority, type Project, type TaskStatus, type User } from '../../lib/types'

export interface TaskFilterValues {
  project: string
  assignee: string
  priority: Priority | ''
  blocked: boolean
  canceled: boolean
  statuses: TaskStatus[]
}

export const EMPTY_TASK_FILTERS: TaskFilterValues = {
  project: '',
  assignee: '',
  priority: '',
  blocked: false,
  canceled: false,
  statuses: [],
}

const NARROW = '(max-width: 899px)'

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(NARROW).matches,
  )
  useEffect(() => {
    const media = window.matchMedia(NARROW)
    const update = () => setNarrow(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return narrow
}

/**
 * The single project/owner/status/exception filter surface for Tasks.
 * Desktop: anchored popover. Mobile: accessible modal sheet. Draft-only until
 * Apply; Cancel/Escape/outside dismissal never commits partial edits.
 */
export default function FiltersPanel({
  open,
  anchor,
  values,
  projects,
  users,
  isManager,
  meId,
  projectsLoading,
  projectsError,
  usersError,
  onRetryOptions,
  onRetryUsers,
  onApply,
  onClose,
}: {
  open: boolean
  anchor: HTMLElement | null
  values: TaskFilterValues
  projects: Project[]
  users: User[]
  isManager: boolean
  meId: string | null
  projectsLoading?: boolean
  projectsError?: string | null
  usersError?: string | null
  onRetryOptions?: () => void
  onRetryUsers?: () => void
  onApply: (next: TaskFilterValues) => void
  onClose: () => void
}): ReactNode {
  const narrow = useNarrow()
  if (!open) return null
  if (narrow) {
    return (
      <Modal open onClose={onClose} title="Filters" description="The same filters apply to Board and Table.">
        <FilterControls
          values={values}
          projects={projects}
          users={users}
          isManager={isManager}
          meId={meId}
          projectsLoading={projectsLoading}
          projectsError={projectsError}
          usersError={usersError}
          onRetryOptions={onRetryOptions}
          onRetryUsers={onRetryUsers}
          onChange={onApply}
        />
      </Modal>
    )
  }
  return (
    <AnchoredFilters
      anchor={anchor}
      values={values}
      projects={projects}
      users={users}
      isManager={isManager}
      meId={meId}
      projectsLoading={projectsLoading}
      projectsError={projectsError}
      usersError={usersError}
      onRetryOptions={onRetryOptions}
      onRetryUsers={onRetryUsers}
      onApply={onApply}
      onClose={onClose}
    />
  )
}

function Controls({
  draft,
  setDraft,
  projects,
  users,
  isManager,
  meId,
  projectsLoading,
  projectsError,
  usersError,
  onRetryOptions,
  onRetryUsers,
  onApply,
}: {
  draft: TaskFilterValues
  setDraft: (next: TaskFilterValues) => void
  projects: Project[]
  users: User[]
  isManager: boolean
  meId: string | null
  projectsLoading?: boolean
  projectsError?: string | null
  usersError?: string | null
  onRetryOptions?: () => void
  onRetryUsers?: () => void
  onApply: (next: TaskFilterValues) => void
}): ReactNode {
  const projectOptions = [
    { value: '', label: 'All projects' },
    ...projects.map((project) => ({ value: project.id, label: project.name })),
  ]
  const ownerOptions = [
    { value: '', label: 'Anyone' },
    ...(meId ? [{ value: meId, label: 'Assigned to me' }] : []),
    { value: 'unassigned', label: 'Unassigned', unassigned: true },
    ...users
      .filter((user) => user.id !== meId)
      .map((user) => ({ value: user.id, label: user.full_name, description: user.role })),
  ]

  function toggleStatus(status: TaskStatus) {
    setDraft({
      ...draft,
      statuses: draft.statuses.includes(status)
        ? draft.statuses.filter((value) => value !== status)
        : [...draft.statuses, status],
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <span className="label">Project</span>
        <MorphSelect
          value={draft.project}
          options={projectOptions}
          onChange={(value) => setDraft({ ...draft, project: value })}
          label="Project"
          placeholder="All projects"
          searchable={projects.length > 6}
          searchPlaceholder="Search projects…"
          loading={projectsLoading}
          error={projectsError}
          onRetry={onRetryOptions}
        />
      </div>

      {isManager && (
        <div>
          <span className="label">Owner</span>
          <MorphSelect
            value={draft.assignee}
            options={ownerOptions}
            onChange={(value) => setDraft({ ...draft, assignee: value })}
            label="Owner"
            placeholder="Anyone"
            searchable={users.length > 8}
            searchPlaceholder="Search people…"
            avatar
            error={usersError}
            onRetry={onRetryUsers}
          />
        </div>
      )}

      <div>
        <span className="label">Status</span>
        <div className="grid grid-cols-2 gap-1.5">
          {TASK_STATUS_OPTIONS.filter((status) => status.value !== 'canceled').map((status) => (
            <label
              key={status.value}
              className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm text-ink hover:bg-recessed"
            >
              <input
                type="checkbox"
                checked={draft.statuses.includes(status.value)}
                onChange={() => toggleStatus(status.value)}
                className="h-4 w-4 rounded border-hairline"
              />
              {status.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <span className="label">Priority</span>
        <select
          className="select"
          value={draft.priority}
          onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority | '' })}
          aria-label="Priority"
        >
          <option value="">Any priority</option>
          {PRIORITIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={draft.blocked}
            onChange={(event) => setDraft({ ...draft, blocked: event.target.checked })}
            className="h-4 w-4 rounded border-hairline"
          />
          Only blocked work
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={draft.canceled}
            onChange={(event) => setDraft({ ...draft, canceled: event.target.checked })}
            className="h-4 w-4 rounded border-hairline"
          />
          Include canceled work
        </label>
      </div>

      <div className="flex justify-end gap-2 border-t border-hairline pt-3">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(EMPTY_TASK_FILTERS)}>
          Reset
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onApply(draft)}>
          Apply
        </button>
      </div>
    </div>
  )
}

function FilterControls({
  values,
  onChange,
  ...rest
}: {
  values: TaskFilterValues
  onChange: (next: TaskFilterValues) => void
  projects: Project[]
  users: User[]
  isManager: boolean
  meId: string | null
  projectsLoading?: boolean
  projectsError?: string | null
  usersError?: string | null
  onRetryOptions?: () => void
  onRetryUsers?: () => void
}): ReactNode {
  const [draft, setDraft] = useState(values)
  return (
    <Controls
      {...rest}
      draft={draft}
      setDraft={setDraft}
      onApply={onChange}
    />
  )
}

function AnchoredFilters({
  anchor,
  values,
  onApply,
  onClose,
  ...rest
}: {
  anchor: HTMLElement | null
  values: TaskFilterValues
  onApply: (next: TaskFilterValues) => void
  onClose: () => void
  projects: Project[]
  users: User[]
  isManager: boolean
  meId: string | null
  projectsLoading?: boolean
  projectsError?: string | null
  usersError?: string | null
  onRetryOptions?: () => void
  onRetryUsers?: () => void
}): ReactNode {
  const [draft, setDraft] = useState(values)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const timer = window.setTimeout(() => panelRef.current?.focus(), 0)
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || anchor?.contains(target)) return
      // Portalled picker trays belong to the panel even though they are outside it.
      if (target instanceof Element && target.closest('[data-morph-tray]')) return
      closeRef.current()
    }
    document.addEventListener('mousedown', handlePointer)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('mousedown', handlePointer)
    }
  }, [anchor])

  const width = 372
  const rect = anchor?.getBoundingClientRect()
  const left = rect ? Math.min(Math.max(rect.right - width, 8), window.innerWidth - width - 8) : 8
  const top = rect ? rect.bottom + 6 : 80
  const openUp = rect ? top + 560 > window.innerHeight && rect.top > 560 : false

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Task filters"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
      }}
      style={{
        position: 'fixed',
        left,
        width,
        ...(openUp && rect ? { bottom: window.innerHeight - rect.top + 6 } : { top }),
      }}
      className="animate-tray-in z-50 max-h-[min(80vh,680px)] overflow-y-auto rounded-control border border-hairline bg-elevated p-4 shadow-floating"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Filters</h2>
        <button type="button" className="rounded p-1 text-ink-muted hover:bg-recessed" onClick={onClose} aria-label="Close filters">
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>
      <Controls
        {...rest}
        draft={draft}
        setDraft={setDraft}
        onApply={onApply}
      />
    </div>,
    document.body,
  )
}
