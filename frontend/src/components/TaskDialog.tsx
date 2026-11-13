import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { formatDate, humanize, relativeDay } from '../lib/format'
import { useAction, useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { PRIORITIES, TASK_STATUSES, type Priority, type TaskDetail, type TaskStatus } from '../lib/types'
import { Icon } from './icons'
import { ErrorBox, Loading, Modal, Spinner } from './ui'

export default function TaskDialog({
  taskId,
  onClose,
  onChanged,
}: {
  taskId: string
  onClose: () => void
  onChanged?: () => void
}) {
  const { isManager } = useAuth()
  const { push } = useToast()
  const detail = useAsync<TaskDetail>(() => api.get(`/tasks/${taskId}`), [taskId])
  const { run, busy, error } = useAction()
  const [form, setForm] = useState({
    title: '',
    description: '',
    status: 'todo' as TaskStatus,
    priority: 'medium' as Priority,
    assignee_id: '',
    project_id: '',
    due_date: '',
    is_at_risk: false,
    at_risk_reason: '',
  })
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [resolution, setResolution] = useState('')

  useEffect(() => {
    if (!detail.data) return
    setForm({
      title: detail.data.title,
      description: detail.data.description ?? '',
      status: detail.data.status,
      priority: detail.data.priority,
      assignee_id: detail.data.assignee?.id ?? '',
      project_id: detail.data.project_id,
      due_date: detail.data.due_date ?? '',
      is_at_risk: detail.data.is_at_risk,
      at_risk_reason: detail.data.at_risk_reason ?? '',
    })
  }, [detail.data])

  function refresh() {
    detail.refresh()
    onChanged?.()
  }

  async function save() {
    if (!detail.data) return
    const saved = await run(() =>
      api.patch(`/tasks/${taskId}`, {
        title: form.title,
        description: form.description || null,
        status: form.status,
        priority: form.priority,
        ...(isManager
          ? { assignee_id: form.assignee_id || null, project_id: form.project_id }
          : {}),
        due_date: form.due_date || null,
        is_at_risk: form.is_at_risk,
        at_risk_reason: form.is_at_risk ? form.at_risk_reason || null : null,
        expected_version: detail.data!.version,
      }),
    )
    if (saved !== undefined) {
      push('Task updated.')
      refresh()
    }
  }

  async function resolve(blockerId: string) {
    if (!resolution.trim()) return
    const result = await run(() =>
      api.patch(`/blockers/${blockerId}/resolve`, { resolution_details: resolution.trim() }),
    )
    if (result !== undefined) {
      push('Help request resolved.')
      setResolvingId(null)
      setResolution('')
      refresh()
    }
  }

  async function completeAction(actionId: string) {
    const result = await run(() =>
      api.patch(`/action-items/${actionId}`, { status: 'completed' }),
    )
    if (result !== undefined) {
      push('Follow-up completed.')
      refresh()
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Task"
      description={detail.data ? `${detail.data.project_name ?? 'No project'} · updated ${formatDate(detail.data.updated_at)}` : undefined}
      wide
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !detail.data}>
            {busy ? <Spinner /> : <Icon name="check" />} Save
          </button>
        </>
      }
    >
      {detail.loading ? (
        <Loading />
      ) : detail.error || !detail.data ? (
        <ErrorBox message={detail.error ?? 'Task not found'} onRetry={detail.refresh} />
      ) : (
        <div className="space-y-5">
          {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="task-title">Title</label>
              <input
                id="task-title"
                className="input text-base"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="task-status">Status</label>
                <select
                  id="task-status"
                  className="select"
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value as TaskStatus })}
                >
                  {TASK_STATUSES.map((status) => (
                    <option key={status.value} value={status.value}>{status.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="task-due">Due date</label>
                <input
                  id="task-due"
                  type="date"
                  className="input"
                  value={form.due_date}
                  onChange={(event) => setForm({ ...form, due_date: event.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="task-owner">Owner</label>
                <input
                  id="task-owner"
                  className="input"
                  value={detail.data.assignee?.full_name ?? 'Unassigned'}
                  disabled
                />
                {!isManager && <p className="mt-1 text-xs text-slate-400">Only a manager can reassign work.</p>}
              </div>
              <div>
                <label className="label" htmlFor="task-priority">Priority</label>
                <select
                  id="task-priority"
                  className="select"
                  value={form.priority}
                  onChange={(event) => setForm({ ...form, priority: event.target.value as Priority })}
                >
                  {PRIORITIES.map((priority) => (
                    <option key={priority.value} value={priority.value}>{priority.label}</option>
                  ))}
                </select>
              </div>
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
            <label className="flex items-center gap-2 text-sm text-slate-600">
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
                className="input"
                placeholder="What is the risk?"
                value={form.at_risk_reason}
                onChange={(event) => setForm({ ...form, at_risk_reason: event.target.value })}
              />
            )}
          </div>

          {detail.data.blockers.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-slate-900">Help needed</h3>
              <div className="mt-2 space-y-2">
                {detail.data.blockers.map((blocker) => (
                  <div key={blocker.id} className="rounded-lg border border-rose-200 bg-rose-50/50 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-slate-800">{blocker.description}</p>
                      <span className={`text-xs font-medium ${blocker.status === 'open' ? 'text-rose-700' : 'text-emerald-700'}`}>
                        {humanize(blocker.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {blocker.owner?.full_name ?? 'Unassigned'} · {blocker.age_days}d open
                    </p>
                    {blocker.status === 'open' && (
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
                              disabled={busy || !resolution.trim()}
                              onClick={() => resolve(blocker.id)}
                            >
                              Save resolution
                            </button>
                          </div>
                        )}
                      </>
                    )}
                    {blocker.resolution_details && (
                      <p className="mt-1 text-xs text-emerald-700">{blocker.resolution_details}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {detail.data.action_items.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-slate-900">Follow-ups</h3>
              <div className="mt-2 space-y-2">
                {detail.data.action_items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
                    <div className="min-w-0">
                      <p className={`text-sm ${item.status === 'open' ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
                        {item.description}
                      </p>
                      <p className="text-xs text-slate-500">
                        {item.owner?.full_name ?? 'Unassigned'}
                        {item.due_date ? ` · due ${relativeDay(item.due_date)}` : ''}
                      </p>
                    </div>
                    {item.status === 'open' && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm shrink-0"
                        disabled={busy}
                        onClick={() => completeAction(item.id)}
                      >
                        Done
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {detail.data.updates.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                Progress history ({detail.data.updates.length})
              </summary>
              <div className="mt-2 space-y-2">
                {detail.data.updates.slice().reverse().map((update) => (
                  <div key={update.id} className="rounded-lg bg-slate-50 p-3">
                    <p className="text-sm text-slate-700">{update.progress}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {update.attributed_to?.full_name ?? update.author?.full_name ?? '—'} ·{' '}
                      {formatDate(update.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </Modal>
  )
}
