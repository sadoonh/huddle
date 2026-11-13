import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import {
  TASK_STATUSES,
  type Participant,
  type Task,
  type TaskStatus,
  type TaskUpdate,
  type UserBrief,
  type WorkspaceTask,
} from '../../lib/types'
import { Icon } from '../icons'
import { Drawer, Spinner } from '../ui'

export type CaptureType = 'progress' | 'blocker' | 'action' | 'decision' | 'note'

const titles: Record<CaptureType, string> = {
  progress: 'Update work',
  blocker: 'Ask for help',
  action: 'Add follow-up',
  decision: 'Record decision',
  note: 'General note',
}

const saveLabels: Record<CaptureType, string> = {
  progress: 'Save update',
  blocker: 'Create help request',
  action: 'Create follow-up',
  decision: 'Record decision',
  note: 'Add note',
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
  onBusyChange,
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
  onBusyChange: (busy: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [loadingLatest, setLoadingLatest] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [conflictVersion, setConflictVersion] = useState<number | null>(null)
  const [latestTask, setLatestTask] = useState<Task | null>(null)
  const [text, setText] = useState('')
  const [nextSteps, setNextSteps] = useState('')
  const [showNext, setShowNext] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState(taskId ?? '')
  const [changeTask, setChangeTask] = useState(false)
  const [ownerId, setOwnerId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [rationale, setRationale] = useState('')
  const [showRationale, setShowRationale] = useState(false)
  const [status, setStatus] = useState<TaskStatus>('todo')
  const [baseVersion, setBaseVersion] = useState<number | null>(null)
  const [operationId] = useState(() => crypto.randomUUID())
  const [baseline, setBaseline] = useState({
    text: '',
    nextSteps: '',
    selectedTaskId: taskId ?? '',
    ownerId: '',
    dueDate: '',
    rationale: '',
    status: 'todo' as TaskStatus,
  })

  const participant = participants.find((item) => item.user.id === participantUserId)
  const selectedTask = latestTask ?? tasks.find((task) => task.id === selectedTaskId) ?? null

  useEffect(() => {
    if (!open) return
    const initialOwner = type === 'action' ? participantUserId ?? '' : ''
    const initialTaskId = taskId ?? ''
    const initialTask = tasks.find((task) => task.id === initialTaskId)
    const initialStatus = initialTask?.status ?? 'todo'
    setText('')
    setNextSteps('')
    setShowNext(false)
    setSelectedTaskId(initialTaskId)
    setChangeTask(!taskId)
    setOwnerId(initialOwner)
    setDueDate('')
    setRationale('')
    setShowRationale(false)
    setStatus(initialStatus)
    setBaseVersion(initialTask?.version ?? null)
    setBaseline({
      text: '',
      nextSteps: '',
      selectedTaskId: initialTaskId,
      ownerId: initialOwner,
      dueDate: '',
      rationale: '',
      status: initialStatus,
    })
    setError(null)
    setInfo(null)
    setConflictVersion(null)
    setLatestTask(null)
    setBusy(false)
    setLoadingLatest(false)
    onDirtyChange(false)
    onBusyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type, taskId, participantUserId])

  useEffect(() => {
    const task = tasks.find((item) => item.id === selectedTaskId)
    setBaseVersion(task?.version ?? null)
    if (task) setStatus(task.status)
    // Only when the task selection changes; background refreshes must not
    // silently move the expected version under an open draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId])

  useLayoutEffect(() => {
    const dirty =
      text !== baseline.text ||
      nextSteps !== baseline.nextSteps ||
      selectedTaskId !== baseline.selectedTaskId ||
      ownerId !== baseline.ownerId ||
      dueDate !== baseline.dueDate ||
      rationale !== baseline.rationale ||
      status !== baseline.status
    onDirtyChange(dirty)
  }, [
    text,
    nextSteps,
    selectedTaskId,
    ownerId,
    dueDate,
    rationale,
    status,
    baseline,
    onDirtyChange,
  ])

  useEffect(() => {
    onBusyChange(busy || loadingLatest)
  }, [busy, loadingLatest, onBusyChange])

  const canSave =
    text.trim().length > 0 &&
    (type !== 'progress' || Boolean(selectedTaskId)) &&
    (type !== 'blocker' || Boolean(text.trim()))

  async function save() {
    if (!canSave || busy) return
    setBusy(true)
    setError(null)
    setInfo(null)
    setConflictVersion(null)
    try {
      if (type === 'progress') {
        await api.post<TaskUpdate>(`/standups/sessions/${sessionId}/updates`, {
          task_id: selectedTaskId,
          progress: text.trim(),
          next_steps: showNext && nextSteps.trim() ? nextSteps.trim() : null,
          attributed_to_user_id: participantUserId,
          status,
          expected_version: baseVersion,
          client_operation_id: operationId,
        })
        onSaved('Update saved.')
      } else if (type === 'blocker') {
        await api.post(`/standups/sessions/${sessionId}/blockers`, {
          description: text.trim(),
          task_id: selectedTaskId || null,
          owner_id: ownerId || null,
          attributed_to_user_id: participantUserId,
          client_operation_id: operationId,
        })
        onSaved(
          ownerId
            ? 'Help request saved.'
            : 'Help request saved. No owner assigned yet.',
        )
      } else if (type === 'action') {
        await api.post(`/standups/sessions/${sessionId}/action-items`, {
          description: text.trim(),
          owner_id: ownerId || null,
          task_id: selectedTaskId || null,
          due_date: dueDate || null,
          client_operation_id: operationId,
        })
        onSaved(ownerId ? 'Follow-up added.' : 'Follow-up added. No owner assigned yet.')
      } else if (type === 'decision') {
        await api.post(`/standups/sessions/${sessionId}/decisions`, {
          description: text.trim(),
          rationale: showRationale && rationale.trim() ? rationale.trim() : null,
          task_id: selectedTaskId || null,
          responsible_user_id: participantUserId,
          client_operation_id: operationId,
        })
        onSaved('Decision recorded.')
      } else {
        await api.post(`/standups/sessions/${sessionId}/notes`, {
          body: text.trim(),
          client_operation_id: operationId,
        })
        onSaved('Note saved.')
      }
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.status === 409 && typeof caught.details?.current_version === 'number') {
          setConflictVersion(caught.details.current_version)
          setError('This task changed since you opened it. Load the latest state, review, then save again.')
        } else {
          setError(caught.message)
        }
      } else {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      setBusy(false)
    }
  }

  async function loadLatest() {
    if (!selectedTaskId || loadingLatest) return
    setLoadingLatest(true)
    try {
      const latest = await api.get<Task>(`/tasks/${selectedTaskId}`)
      setLatestTask(latest)
      setBaseVersion(latest.version)
      setConflictVersion(null)
      setError(null)
      setInfo('Latest state loaded. Review your text and save again.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoadingLatest(false)
    }
  }

  const taskOptions = useMemo(
    () => tasks.map((task) => ({ id: task.id, title: task.title })),
    [tasks],
  )

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
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || loadingLatest || !canSave}>
            {busy ? <Spinner /> : <Icon name="check" />} {saveLabels[type]}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <p>{error}</p>
            {conflictVersion !== null && (
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
        {info && (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
            {info}
          </div>
        )}

        {(type === 'progress' || type === 'blocker' || type === 'action' || type === 'decision') && (
          <div>
            <label className="label" htmlFor="capture-task">Task</label>
            {selectedTask && !changeTask ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="min-w-0 truncate text-sm text-slate-700">{selectedTask.title}</span>
                <button type="button" className="text-sm font-medium text-emerald-700 hover:underline" onClick={() => setChangeTask(true)}>
                  Change
                </button>
              </div>
            ) : (
              <select
                id="capture-task"
                className="select"
                value={selectedTaskId}
                onChange={(event) => setSelectedTaskId(event.target.value)}
              >
                <option value="">{type === 'progress' ? 'Select a task…' : 'Not tied to a task'}</option>
                {taskOptions.map((task) => (
                  <option key={task.id} value={task.id}>{task.title}</option>
                ))}
              </select>
            )}
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
          {type === 'progress' && !selectedTaskId && (
            <p className="mt-1 text-sm text-rose-700">Choose a task for this update.</p>
          )}
        </div>

        {type === 'progress' && selectedTask && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="capture-status">Status</label>
              <select id="capture-status" className="select" value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)}>
                {TASK_STATUSES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              {showNext ? (
                <div className="w-full">
                  <label className="label" htmlFor="capture-next">Next steps (optional)</label>
                  <input id="capture-next" className="input" value={nextSteps} onChange={(event) => setNextSteps(event.target.value)} />
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
            <select id="capture-owner" className="select" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
              <option value="">Leave unassigned</option>
              {ownerOptions.map((user) => (
                <option key={user.id} value={user.id}>{user.full_name}</option>
              ))}
            </select>
            <p className="mt-1 text-sm text-slate-500">This stays open until it is resolved.</p>
          </div>
        )}

        {type === 'action' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="capture-action-owner">Owner</label>
              <select id="capture-action-owner" className="select" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
                <option value="">Leave unassigned</option>
                {ownerOptions.map((user) => (
                  <option key={user.id} value={user.id}>{user.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="capture-due">Due date (optional)</label>
              <input id="capture-due" type="date" className="input" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </div>
          </div>
        )}

        {type === 'decision' && (
          <div>
            {showRationale ? (
              <>
                <label className="label" htmlFor="capture-rationale">Rationale (optional)</label>
                <textarea id="capture-rationale" className="textarea min-h-[64px]" value={rationale} onChange={(event) => setRationale(event.target.value)} />
              </>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowRationale(true)}>
                <Icon name="plus" /> Add rationale
              </button>
            )}
          </div>
        )}
      </div>
    </Drawer>
  )
}
