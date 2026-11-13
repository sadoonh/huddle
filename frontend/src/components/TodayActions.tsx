import { useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import { useToast } from '../lib/toast'
import { TASK_STATUSES, type Task, type TaskStatus, type TaskUpdate, type User } from '../lib/types'
import { Icon } from './icons'
import { Modal, Spinner } from './ui'

export function UpdateDialog({
  task,
  attributedToUserId,
  onClose,
  onSaved,
}: {
  task: Task
  attributedToUserId?: string
  onClose: () => void
  onSaved: (update: TaskUpdate) => void
}) {
  const { push } = useToast()
  const confirm = useConfirm()
  const [progress, setProgress] = useState('')
  const [nextSteps, setNextSteps] = useState('')
  const [showNext, setShowNext] = useState(false)
  const [status, setStatus] = useState<TaskStatus>(task.status)
  const [latest, setLatest] = useState<Task>(task)
  const [saving, setSaving] = useState(false)
  const [loadingLatest, setLoadingLatest] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [operationId] = useState(() => crypto.randomUUID())

  const dirty = Boolean(progress.trim() || nextSteps.trim() || status !== latest.status)

  async function requestClose() {
    if (saving || loadingLatest) {
      push('The update is still saving. Wait for it to finish.', 'info')
      return
    }
    if (dirty) {
      const discard = await confirm({
        title: 'Discard this update?',
        description: 'Your text has not been saved.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        tone: 'danger',
      })
      if (!discard) return
    }
    onClose()
  }

  async function save() {
    if (saving) return
    if (!progress.trim()) {
      setFieldError('Write a short update before saving.')
      return
    }
    setFieldError(null)
    setError(null)
    setConflict(false)
    setSaving(true)
    try {
      const update = await api.post<TaskUpdate>(`/tasks/${task.id}/updates`, {
        progress: progress.trim(),
        next_steps: showNext && nextSteps.trim() ? nextSteps.trim() : null,
        status,
        expected_version: latest.version,
        attributed_to_user_id: attributedToUserId ?? null,
        client_operation_id: operationId,
      })
      push('Update saved.')
      onSaved(update)
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.status === 409) {
          setConflict(true)
          setError('This task changed since you opened it. Load the latest state, review your text, then save again.')
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
    if (loadingLatest) return
    setLoadingLatest(true)
    try {
      const latestTask = await api.get<Task>(`/tasks/${task.id}`)
      setLatest(latestTask)
      setConflict(false)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoadingLatest(false)
    }
  }

  return (
    <Modal
      open
      onClose={requestClose}
      title="Update work"
      description={task.title}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={requestClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || loadingLatest || !progress.trim()}>
            {saving ? <Spinner /> : <Icon name="send" />} Save update
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <p>{error}</p>
            {conflict && (
              <button
                type="button"
                className="btn btn-secondary btn-sm mt-2"
                onClick={loadLatest}
                disabled={loadingLatest}
              >
                {loadingLatest ? <Spinner className="h-3 w-3" /> : null} Load latest state
              </button>
            )}
          </div>
        )}
        <div>
          <label className="label" htmlFor="update-progress">What changed?</label>
          <textarea
            id="update-progress"
            className="textarea min-h-[96px] text-base"
            value={progress}
            onChange={(event) => {
              setProgress(event.target.value)
              setFieldError(null)
            }}
            placeholder="One short update is enough."
            autoFocus
          />
          {fieldError && <p className="mt-1 text-sm text-rose-700">{fieldError}</p>}
        </div>
        <div>
          <label className="label" htmlFor="update-status">Status</label>
          <select
            id="update-status"
            className="select"
            value={status}
            onChange={(event) => setStatus(event.target.value as TaskStatus)}
          >
            {TASK_STATUSES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        {showNext ? (
          <div>
            <label className="label" htmlFor="update-next">Next steps (optional)</label>
            <input
              id="update-next"
              className="input"
              value={nextSteps}
              onChange={(event) => setNextSteps(event.target.value)}
              placeholder="What comes next?"
            />
            <button type="button" className="mt-1 text-sm text-slate-500 hover:text-slate-700" onClick={() => setShowNext(false)}>
              Hide next steps
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowNext(true)}>
            <Icon name="plus" /> Add next steps
          </button>
        )}
        <p className="text-sm text-slate-500">
          This is saved to the task immediately. It appears in the standup as the latest task update; it is not a separate daily note.
        </p>
      </div>
    </Modal>
  )
}

export function NeedsHelpDialog({
  task,
  tasks,
  users,
  onClose,
  onSaved,
}: {
  task?: Pick<Task, 'id' | 'title'> | null
  tasks: Task[]
  users: User[]
  onClose: () => void
  onSaved: () => void
}) {
  const { push } = useToast()
  const confirm = useConfirm()
  const [description, setDescription] = useState('')
  const [taskId, setTaskId] = useState(task?.id ?? '')
  const [ownerId, setOwnerId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [operationId] = useState(() => crypto.randomUUID())

  const [initialTaskId] = useState(task?.id ?? '')
  const dirty = Boolean(description.trim() || taskId !== initialTaskId || ownerId)
  const canSave = description.trim().length > 0

  async function requestClose() {
    if (saving) {
      push('The help request is still saving.', 'info')
      return
    }
    if (dirty) {
      const discard = await confirm({
        title: 'Discard this help request?',
        description: 'It has not been saved.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        tone: 'danger',
      })
      if (!discard) return
    }
    onClose()
  }

  async function save() {
    if (!canSave || saving) return
    setSaving(true)
    setError(null)
    try {
      await api.post('/blockers', {
        description: description.trim(),
        task_id: taskId || null,
        owner_id: ownerId || null,
        client_operation_id: operationId,
      })
      push(ownerId ? 'Help request saved.' : 'Help request saved. No owner assigned yet.')
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={requestClose}
      title="Ask for help"
      description={task ? task.title : 'Ask for help without picking a task.'}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={requestClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !canSave}>
            {saving ? <Spinner /> : <Icon name="alert" />} Create help request
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div>
          <label className="label" htmlFor="help-description">What is blocking you?</label>
          <textarea
            id="help-description"
            className="textarea min-h-[96px] text-base"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What do you need, and from whom?"
            autoFocus
          />
        </div>
        {!task && (
          <div>
            <label className="label" htmlFor="help-task">Related work (optional)</label>
            <select id="help-task" className="select" value={taskId} onChange={(event) => setTaskId(event.target.value)}>
              <option value="">Not tied to a specific task</option>
              {tasks.map((item) => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label" htmlFor="help-owner">Who can help? (optional)</label>
          <select id="help-owner" className="select" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
            <option value="">Leave unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.full_name}</option>
            ))}
          </select>
          <p className="mt-1 text-sm text-slate-500">This stays open until it is resolved.</p>
        </div>
      </div>
    </Modal>
  )
}

export function ResolveBlockerDialog({
  blockerId,
  description,
  onClose,
  onSaved,
}: {
  blockerId: string
  description: string
  onClose: () => void
  onSaved: () => void
}) {
  const { push } = useToast()
  const confirm = useConfirm()
  const [resolution, setResolution] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function requestClose() {
    if (saving) return
    if (resolution.trim()) {
      const discard = await confirm({
        title: 'Discard this resolution?',
        description: 'The help request is still open.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        tone: 'danger',
      })
      if (!discard) return
    }
    onClose()
  }

  async function save() {
    if (!resolution.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await api.patch(`/blockers/${blockerId}/resolve`, {
        resolution_details: resolution.trim(),
      })
      push('Help request resolved.')
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={requestClose}
      title="Resolve help request"
      description={description}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={requestClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !resolution.trim()}>
            {saving ? <Spinner /> : <Icon name="check" />} Resolve
          </button>
        </>
      }
    >
      {error && <p className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <label className="label" htmlFor="resolution">What resolved it?</label>
      <textarea
        id="resolution"
        className="textarea min-h-[96px] text-base"
        value={resolution}
        onChange={(event) => setResolution(event.target.value)}
        autoFocus
      />
    </Modal>
  )
}
