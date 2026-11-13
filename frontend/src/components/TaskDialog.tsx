import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import { formatDate, formatDateTime, formatDueDateForStatus, formatOpenAge, humanize } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import {
  PRIORITIES,
  TASK_STATUSES,
  type Priority,
  type Project,
  type TaskDetail,
  type TaskStatus,
  type User,
} from '../lib/types'
import { Icon } from './icons'
import { ErrorBox, Loading, Modal, Spinner } from './ui'

interface FormState {
  title: string
  description: string
  status: TaskStatus
  priority: Priority
  assignee_id: string
  project_id: string
  due_date: string
  is_at_risk: boolean
  at_risk_reason: string
}

function formFromTask(task: TaskDetail): FormState {
  return {
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    priority: task.priority,
    assignee_id: task.assignee?.id ?? '',
    project_id: task.project_id,
    due_date: task.due_date ?? '',
    is_at_risk: task.is_at_risk,
    at_risk_reason: task.at_risk_reason ?? '',
  }
}

export default function TaskDialog({
  taskId,
  onClose,
  onChanged,
}: {
  taskId: string
  onClose: () => void
  onChanged?: () => void
}) {
  const { me, isManager } = useAuth()
  const { push } = useToast()
  const confirm = useConfirm()
  const detail = useAsync<TaskDetail>(() => api.get(`/tasks/${taskId}`), [taskId])
  const users = useAsync<User[]>(() => api.get('/users'), [])
  const projects = useAsync<Project[]>(() => api.get('/projects'), [])
  const [view, setView] = useState<'detail' | 'edit'>('detail')
  const [form, setForm] = useState<FormState | null>(null)
  const [baseline, setBaseline] = useState<FormState | null>(null)
  const initializedFor = useRef<string | null>(null)
  const dirtyRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [editBaseVersion, setEditBaseVersion] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [updateOpen, setUpdateOpen] = useState(false)
  const [updateText, setUpdateText] = useState('')
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateOperationId, setUpdateOperationId] = useState(() => crypto.randomUUID())
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [resolution, setResolution] = useState('')
  const [busyItem, setBusyItem] = useState<string | null>(null)

  const dirty = useMemo(
    () => Boolean(form && baseline && JSON.stringify(form) !== JSON.stringify(baseline)),
    [form, baseline],
  )
  dirtyRef.current = dirty

  useEffect(() => {
    if (!detail.data) return
    const next = formFromTask(detail.data)
    if (initializedFor.current !== detail.data.id) {
      initializedFor.current = detail.data.id
      setForm(next)
      setBaseline(next)
      return
    }
    // Same-record background refresh: never clobber unsaved edits.
    if (!dirtyRef.current) {
      setForm(next)
      setBaseline(next)
    }
  }, [detail.data])

  async function requestClose() {
    if (saving || updateBusy) {
      push('A save is in progress. Wait for it to finish.', 'info')
      return
    }
    if (dirty || (updateOpen && updateText.trim())) {
      const discard = await confirm({
        title: 'Discard your changes?',
        description: 'Your edits to this task have not been saved.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        tone: 'danger',
      })
      if (!discard) return
    }
    onClose()
  }

  async function save() {
    if (!form || !detail.data || saving) return
    const errors: Record<string, string> = {}
    if (!form.title.trim()) errors.title = 'Title is required.'
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return
    setSaving(true)
    setError(null)
    setInfo(null)
    setConflict(false)
    try {
      await api.patch(`/tasks/${taskId}`, {
        title: form.title.trim(),
        description: form.description || null,
        status: form.status,
        priority: form.priority,
        ...(isManager
          ? { assignee_id: form.assignee_id || null, project_id: form.project_id }
          : {}),
        due_date: form.due_date || null,
        is_at_risk: form.is_at_risk,
        at_risk_reason: form.is_at_risk ? form.at_risk_reason || null : null,
        expected_version: editBaseVersion ?? detail.data.version,
      })
      push('Task changes saved.')
      setBaseline(form)
      setView('detail')
      detail.refresh()
      onChanged?.()
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.status === 409) {
          setConflict(true)
          setError('This task changed while you were editing. Load the latest state and review your changes.')
        } else {
          setError(caught.message)
        }
      } else {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      setSaving(false)
    }
  }

  async function loadLatest() {
    try {
      const latest = await api.get<TaskDetail>(`/tasks/${taskId}`)
      setEditBaseVersion(latest.version)
      setConflict(false)
      setError(null)
      setInfo('Latest task state loaded. Review your edits, then save again.')
      setView('edit')
      detail.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  async function saveUpdate() {
    if (!updateText.trim() || !detail.data || updateBusy) return
    setUpdateBusy(true)
    setUpdateError(null)
    const operationId = updateOperationId
    try {
      await api.post(`/tasks/${taskId}/updates`, {
        progress: updateText.trim(),
        client_operation_id: operationId,
      })
      push('Update saved.')
      setUpdateText('')
      setUpdateOpen(false)
      setUpdateOperationId(crypto.randomUUID())
      detail.refresh()
      onChanged?.()
    } catch (caught) {
      setUpdateError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setUpdateBusy(false)
    }
  }

  async function resolve(blockerId: string) {
    if (!resolution.trim()) return
    setBusyItem(blockerId)
    try {
      await api.patch(`/blockers/${blockerId}/resolve`, {
        resolution_details: resolution.trim(),
      })
      push('Help request resolved.')
      setResolvingId(null)
      setResolution('')
      detail.refresh()
      onChanged?.()
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      setBusyItem(null)
    }
  }

  async function completeAction(actionId: string) {
    setBusyItem(actionId)
    try {
      await api.patch(`/action-items/${actionId}`, { status: 'completed' })
      push('Follow-up completed.')
      detail.refresh()
      onChanged?.()
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      setBusyItem(null)
    }
  }

  const data = detail.data
  const canResolve = (blocker: TaskDetail['blockers'][number]) =>
    isManager || blocker.owner?.id === me?.id || blocker.reported_by?.id === me?.id
  const canComplete = (ownerId: string | null) => isManager || ownerId === me?.id
  const openBlockers = data?.blockers.filter((blocker) => blocker.status === 'open') ?? []
  const openActions = data?.action_items.filter((item) => item.status === 'open') ?? []
  const closedBlockers = data?.blockers.filter((blocker) => blocker.status !== 'open') ?? []
  const closedActions = data?.action_items.filter((item) => item.status !== 'open') ?? []

  return (
    <Modal
      open
      onClose={requestClose}
      title={view === 'edit' ? 'Edit task details' : 'Task'}
      description={
        data
          ? `${data.project_name ?? 'No project'} · ${humanize(data.status)}`
          : undefined
      }
      wide
      footer={
        view === 'edit' ? (
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                if (form) setForm(baseline)
                setView('detail')
                setError(null)
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={save}
              disabled={saving || !dirty}
            >
              {saving ? <Spinner /> : <Icon name="check" />} Save changes
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={requestClose}>
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setEditBaseVersion(data?.version ?? null)
                setView('edit')
              }}
              disabled={!data}
            >
              <Icon name="arrowRight" /> Edit details
            </button>
          </>
        )
      }
    >
      {detail.loading && !data ? (
        <Loading />
      ) : detail.error || !data || !form ? (
        <ErrorBox message={detail.error ?? 'Task not found'} onRetry={detail.refresh} />
      ) : view === 'edit' ? (
        <EditView
          form={form}
          setForm={setForm}
          fieldErrors={fieldErrors}
          isManager={isManager}
          users={users.data ?? []}
          projects={projects.data ?? []}
        />
      ) : (
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold leading-snug text-slate-900">{data.title}</h2>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
              <span>Status: <span className="font-medium text-slate-800">{humanize(data.status)}</span></span>
              <span>Owner: <span className="font-medium text-slate-800">{data.assignee?.full_name ?? 'Unassigned'}</span></span>
              <span>
                Due: <span className="font-medium text-slate-800">
                  {data.due_date ? formatDueDateForStatus(data.due_date, data.status === 'done' || data.status === 'canceled') : 'None'}
                </span>
              </span>
            </div>
            {data.description && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{data.description}</p>}
          </div>

          <section>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900">Latest update</h3>
              {!updateOpen && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setUpdateOpen(true)}>
                  <Icon name="plus" /> Add update
                </button>
              )}
            </div>
            {data.updates.length > 0 ? (
              <div className="mt-2 rounded-lg bg-slate-50 p-3">
                <p className="text-sm text-slate-700">{data.updates[data.updates.length - 1].progress}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {data.updates[data.updates.length - 1].attributed_to?.full_name ??
                    data.updates[data.updates.length - 1].author?.full_name ??
                    '—'}{' '}
                  · {formatDateTime(data.updates[data.updates.length - 1].created_at)}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-500">No updates yet.</p>
            )}
            {updateOpen && (
              <div className="mt-2 rounded-lg border border-slate-200 p-3">
                <label className="label" htmlFor="task-inline-update">What changed?</label>
                <textarea
                  id="task-inline-update"
                  className="textarea text-base"
                  value={updateText}
                  onChange={(event) => setUpdateText(event.target.value)}
                  autoFocus
                />
                {updateError && <p className="mt-1 text-sm text-rose-700">{updateError}</p>}
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setUpdateOpen(false)
                      setUpdateError(null)
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={saveUpdate}
                    disabled={updateBusy || !updateText.trim()}
                  >
                    {updateBusy ? <Spinner /> : <Icon name="send" />} Save update
                  </button>
                </div>
              </div>
            )}
          </section>

          <section>
            <h3 className="text-base font-semibold text-slate-900">Help needed</h3>
            {openBlockers.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No open help requests.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {openBlockers.map((blocker) => (
                  <div key={blocker.id} className="rounded-lg border border-rose-200 bg-rose-50/40 p-3">
                    <p className="text-sm text-slate-800">{blocker.description}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Help owner: {blocker.owner?.full_name ?? 'Unassigned — needs an owner'} · {formatOpenAge(blocker.age_days)}
                    </p>
                    {canResolve(blocker) && (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm mt-2"
                          onClick={() => setResolvingId(resolvingId === blocker.id ? null : blocker.id)}
                        >
                          {resolvingId === blocker.id ? 'Cancel' : 'Resolve'}
                        </button>
                        {resolvingId === blocker.id && (
                          <div className="mt-2 space-y-2">
                            <textarea
                              className="textarea min-h-[56px]"
                              placeholder="How was it resolved?"
                              value={resolution}
                              onChange={(event) => setResolution(event.target.value)}
                            />
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={busyItem === blocker.id || !resolution.trim()}
                              onClick={() => resolve(blocker.id)}
                            >
                              Save resolution
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-base font-semibold text-slate-900">Follow-ups</h3>
            {openActions.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No open follow-ups.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {openActions.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-800">{item.description}</p>
                      <p className="text-xs text-slate-500">
                        {item.owner?.full_name ?? 'Unassigned'}
                        {item.due_date ? ` · ${formatDueDateForStatus(item.due_date, item.status === 'completed' || item.status === 'canceled')}` : ''}
                      </p>
                    </div>
                    {canComplete(item.owner?.id ?? null) && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busyItem === item.id}
                        onClick={() => completeAction(item.id)}
                      >
                        Mark done
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {(closedBlockers.length > 0 || closedActions.length > 0 || data.updates.length > 1) && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                History
              </summary>
              <div className="mt-2 space-y-2">
                {data.updates.slice(0, -1).reverse().map((update) => (
                  <div key={update.id} className="rounded-lg bg-slate-50 p-3">
                    <p className="text-sm text-slate-700">{update.progress}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {update.attributed_to?.full_name ?? update.author?.full_name ?? '—'} ·{' '}
                      {formatDate(update.created_at)}
                    </p>
                  </div>
                ))}
                {closedBlockers.map((blocker) => (
                  <p key={blocker.id} className="text-sm text-slate-500">
                    Resolved help request: {blocker.description}
                    {blocker.resolution_details ? ` — ${blocker.resolution_details}` : ''}
                  </p>
                ))}
                {closedActions.map((item) => (
                  <p key={item.id} className="text-sm text-slate-500 line-through">
                    Follow-up completed: {item.description}
                  </p>
                ))}
              </div>
            </details>
          )}

        </div>
      )}
      {error && (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <p>{error}</p>
          {conflict && (
            <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={loadLatest}>
              Load latest state
            </button>
          )}
        </div>
      )}
      {info && (
        <p className="mt-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">{info}</p>
      )}
    </Modal>
  )
}

function EditView({
  form,
  setForm,
  fieldErrors,
  isManager,
  users,
  projects,
}: {
  form: FormState
  setForm: (next: FormState) => void
  fieldErrors: Record<string, string>
  isManager: boolean
  users: User[]
  projects: Project[]
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="label" htmlFor="task-title">Title</label>
        <input
          id="task-title"
          className="input text-base"
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          autoFocus
        />
        {fieldErrors.title && <p className="mt-1 text-sm text-rose-700">{fieldErrors.title}</p>}
      </div>
      <div>
        <label className="label" htmlFor="task-description">Description</label>
        <textarea
          id="task-description"
          className="textarea"
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="task-status">Status</label>
          <select id="task-status" className="select" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as TaskStatus })}>
            {TASK_STATUSES.map((status) => (
              <option key={status.value} value={status.value}>{status.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="task-due">Due date</label>
          <input id="task-due" type="date" className="input" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="task-owner">Owner</label>
          <select
            id="task-owner"
            className="select"
            value={form.assignee_id}
            disabled={!isManager}
            onChange={(event) => setForm({ ...form, assignee_id: event.target.value })}
          >
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.full_name}</option>
            ))}
          </select>
          {!isManager && <p className="mt-1 text-sm text-slate-500">Only a manager can reassign work.</p>}
        </div>
        <div>
          <label className="label" htmlFor="task-project">Project</label>
          <select
            id="task-project"
            className="select"
            value={form.project_id}
            disabled={!isManager}
            onChange={(event) => setForm({ ...form, project_id: event.target.value })}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="task-priority">Priority</label>
          <select id="task-priority" className="select" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as Priority })}>
            {PRIORITIES.map((priority) => (
              <option key={priority.value} value={priority.value}>{priority.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col justify-end">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.is_at_risk}
              onChange={(event) => setForm({ ...form, is_at_risk: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300"
            />
            Flag as at risk
          </label>
          {form.is_at_risk && (
            <input
              className="input mt-1.5"
              placeholder="What is the risk?"
              value={form.at_risk_reason}
              onChange={(event) => setForm({ ...form, at_risk_reason: event.target.value })}
            />
          )}
        </div>
      </div>
    </div>
  )
}
