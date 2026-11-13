import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useAction } from '../../lib/hooks'
import { TASK_STATUSES, type Participant, type TaskStatus, type UserBrief, type WorkspaceTask } from '../../lib/types'
import { Icon } from '../icons'
import { Drawer, Spinner } from '../ui'

export type CaptureType = 'progress' | 'blocker' | 'action' | 'decision' | 'note'

const titles: Record<CaptureType, string> = {
  progress: 'Update work',
  blocker: 'Needs help',
  action: 'Add follow-up',
  decision: 'Record decision',
  note: 'General note',
}

export default function CaptureDrawer({
  open,
  sessionId,
  type,
  taskId,
  participantUserId,
  participants,
  ownerOptions,
  tasks,
  onClose,
  onSaved,
  onDirtyChange,
}: {
  open: boolean
  sessionId: string
  type: CaptureType
  taskId: string | null
  participantUserId: string | null
  participants: Participant[]
  ownerOptions: UserBrief[]
  tasks: WorkspaceTask[]
  onClose: () => void
  onSaved: (message: string) => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const { run, busy, error } = useAction()
  const [text, setText] = useState('')
  const [nextSteps, setNextSteps] = useState('')
  const [showNext, setShowNext] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState(taskId ?? '')
  const [ownerId, setOwnerId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [rationale, setRationale] = useState('')
  const [status, setStatus] = useState<TaskStatus>('todo')

  const participant = participants.find((item) => item.user.id === participantUserId)
  const selectedTask = tasks.find((task) => task.id === selectedTaskId)

  useEffect(() => {
    if (!open) return
    setText('')
    setNextSteps('')
    setShowNext(false)
    setSelectedTaskId(taskId ?? '')
    setOwnerId(type === 'action' ? participantUserId ?? '' : '')
    setDueDate('')
    setRationale('')
    setStatus(selectedTask?.status ?? 'todo')
    onDirtyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type, taskId, participantUserId])

  useEffect(() => {
    if (selectedTask) setStatus(selectedTask.status)
  }, [selectedTask?.id])

  useEffect(() => {
    const dirty = Boolean(text.trim() || rationale.trim() || nextSteps.trim())
    onDirtyChange(dirty)
  }, [text, rationale, nextSteps, onDirtyChange])

  async function save() {
    if (!text.trim()) return
    if (type === 'progress' && !selectedTaskId) return
    const saved = await run(async () => {
      if (type === 'progress') {
        await api.post(`/standups/sessions/${sessionId}/updates`, {
          task_id: selectedTaskId,
          progress: text.trim(),
          next_steps: showNext && nextSteps.trim() ? nextSteps.trim() : null,
          attributed_to_user_id: participantUserId,
        })
        if (selectedTask && status !== selectedTask.status) {
          await api.patch(`/standups/sessions/${sessionId}/tasks/${selectedTask.id}/status`, {
            status,
          })
        }
        return 'Update saved.'
      }
      if (type === 'blocker') {
        await api.post(`/standups/sessions/${sessionId}/blockers`, {
          description: text.trim(),
          task_id: selectedTaskId || null,
          owner_id: ownerId || null,
          attributed_to_user_id: participantUserId,
        })
        return 'Help request saved.'
      }
      if (type === 'action') {
        await api.post(`/standups/sessions/${sessionId}/action-items`, {
          description: text.trim(),
          owner_id: ownerId || null,
          task_id: selectedTaskId || null,
          due_date: dueDate || null,
        })
        return 'Follow-up added.'
      }
      if (type === 'decision') {
        await api.post(`/standups/sessions/${sessionId}/decisions`, {
          description: text.trim(),
          rationale: rationale.trim() || null,
          task_id: selectedTaskId || null,
          responsible_user_id: participantUserId,
        })
        return 'Decision recorded.'
      }
      await api.post(`/standups/sessions/${sessionId}/notes`, { body: text.trim() })
      return 'Note saved.'
    })
    if (saved !== undefined) onSaved(saved)
  }

  const canSave = text.trim().length > 0 && (type !== 'progress' || Boolean(selectedTaskId))

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={titles[type]}
      description={
        participant
          ? `For ${participant.user.full_name}${selectedTask ? ` · ${selectedTask.title}` : ''}`
          : undefined
      }
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !canSave}>
            {busy ? <Spinner /> : <Icon name="check" />} Save
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

        {(type === 'progress' || type === 'blocker' || type === 'action' || type === 'decision') && (
          <div>
            <label className="label" htmlFor="capture-task">Task</label>
            <select
              id="capture-task"
              className="select"
              value={selectedTaskId}
              onChange={(event) => setSelectedTaskId(event.target.value)}
            >
              <option value="">{type === 'progress' ? 'Select a task…' : 'Not tied to a task'}</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>{task.title}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="label" htmlFor="capture-text">
            {type === 'progress' && 'What changed?'}
            {type === 'blocker' && 'What is blocking progress?'}
            {type === 'action' && 'What needs to happen?'}
            {type === 'decision' && 'What was decided?'}
            {type === 'note' && 'Note'}
          </label>
          <textarea
            id="capture-text"
            className="textarea min-h-[110px] text-base"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={
              type === 'blocker'
                ? 'What do you need, and from whom?'
                : type === 'action'
                  ? 'A commitment with an owner.'
                  : 'One short entry is enough.'
            }
            autoFocus
          />
        </div>

        {type === 'progress' && selectedTask && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="capture-status">Status</label>
              <select
                id="capture-status"
                className="select"
                value={status}
                onChange={(event) => setStatus(event.target.value as TaskStatus)}
              >
                {TASK_STATUSES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              {showNext ? (
                <div className="w-full">
                  <label className="label" htmlFor="capture-next">Next steps (optional)</label>
                  <input
                    id="capture-next"
                    className="input"
                    value={nextSteps}
                    onChange={(event) => setNextSteps(event.target.value)}
                  />
                </div>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowNext(true)}>
                  <Icon name="plus" /> Add next steps
                </button>
              )}
            </div>
          </div>
        )}

        {type === 'blocker' && (
          <div>
            <label className="label" htmlFor="capture-owner">Who can help? (optional)</label>
            <select
              id="capture-owner"
              className="select"
              value={ownerId}
              onChange={(event) => setOwnerId(event.target.value)}
            >
              <option value="">Not sure yet</option>
              {ownerOptions.map((user) => (
                <option key={user.id} value={user.id}>{user.full_name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              This creates a durable help request that carries forward until resolved.
            </p>
          </div>
        )}

        {type === 'action' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="capture-action-owner">Owner</label>
              <select
                id="capture-action-owner"
                className="select"
                value={ownerId}
                onChange={(event) => setOwnerId(event.target.value)}
              >
                <option value="">Unassigned</option>
                {ownerOptions.map((user) => (
                  <option key={user.id} value={user.id}>{user.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="capture-due">Due date (optional)</label>
              <input
                id="capture-due"
                type="date"
                className="input"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
          </div>
        )}

        {type === 'decision' && (
          <div>
            <label className="label" htmlFor="capture-rationale">Rationale (optional)</label>
            <textarea
              id="capture-rationale"
              className="textarea min-h-[64px]"
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
            />
          </div>
        )}
      </div>
    </Drawer>
  )
}
