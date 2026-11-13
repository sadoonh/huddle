import { useState } from 'react'
import { api } from '../lib/api'
import { useAction } from '../lib/hooks'
import { useToast } from '../lib/toast'
import { TASK_STATUSES, type Task, type TaskStatus, type User } from '../lib/types'
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
  onSaved: (progress: string) => void
}) {
  const { push } = useToast()
  const { run, busy, error } = useAction()
  const [progress, setProgress] = useState('')
  const [nextSteps, setNextSteps] = useState('')
  const [showNext, setShowNext] = useState(false)
  const [status, setStatus] = useState<TaskStatus>(task.status)

  async function save() {
    if (!progress.trim()) return
    const saved = await run(async () => {
      const update = await api.post(`/tasks/${task.id}/updates`, {
        progress: progress.trim(),
        next_steps: showNext && nextSteps.trim() ? nextSteps.trim() : null,
        attributed_to_user_id: attributedToUserId ?? null,
      })
      if (status !== task.status) {
        await api.patch(`/tasks/${task.id}/status`, {
          status,
          expected_version: task.version,
        })
      }
      return update
    })
    if (saved !== undefined) {
      push('Update saved.')
      onSaved(progress.trim())
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Update work"
      description={task.title}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !progress.trim()}>
            {busy ? <Spinner /> : <Icon name="send" />} Save update
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div>
          <label className="label" htmlFor="update-progress">What changed?</label>
          <textarea
            id="update-progress"
            className="textarea min-h-[96px] text-base"
            value={progress}
            onChange={(event) => setProgress(event.target.value)}
            placeholder="One short update is enough."
            autoFocus
          />
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
            <button type="button" className="mt-1 text-xs text-slate-500 hover:text-slate-700" onClick={() => setShowNext(false)}>
              Hide next steps
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowNext(true)}>
            <Icon name="plus" /> Add next steps
          </button>
        )}
        <p className="text-xs text-slate-500">
          Your update appears in the standup automatically; there is no second form to fill in.
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
  const { run, busy, error } = useAction()
  const [description, setDescription] = useState('')
  const [taskId, setTaskId] = useState(task?.id ?? '')
  const [ownerId, setOwnerId] = useState('')

  async function save() {
    if (!description.trim()) return
    const saved = await run(() =>
      api.post('/blockers', {
        description: description.trim(),
        task_id: taskId || null,
        owner_id: ownerId || null,
      }),
    )
    if (saved !== undefined) {
      push('Help request saved. It will carry forward until resolved.')
      onSaved()
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Needs help"
      description={task ? task.title : 'Ask for help without picking a task.'}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !description.trim()}>
            {busy ? <Spinner /> : <Icon name="alert" />} Save help request
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
            <select
              id="help-task"
              className="select"
              value={taskId}
              onChange={(event) => setTaskId(event.target.value)}
            >
              <option value="">Not tied to a specific task</option>
              {tasks.map((item) => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label" htmlFor="help-owner">Who can help? (optional)</label>
          <select
            id="help-owner"
            className="select"
            value={ownerId}
            onChange={(event) => setOwnerId(event.target.value)}
          >
            <option value="">Not sure yet</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.full_name}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            This creates an owned help request, not just a note for the meeting.
          </p>
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
  const { run, busy, error } = useAction()
  const [resolution, setResolution] = useState('')

  async function save() {
    if (!resolution.trim()) return
    const saved = await run(() =>
      api.patch(`/blockers/${blockerId}/resolve`, {
        resolution_details: resolution.trim(),
      }),
    )
    if (saved !== undefined) {
      push('Help request resolved.')
      onSaved()
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Resolve help request"
      description={description}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !resolution.trim()}>
            {busy ? <Spinner /> : <Icon name="check" />} Resolve
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
