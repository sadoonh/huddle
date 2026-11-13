import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { formatDateTime, humanize, truncate } from '../../lib/format'
import { useToast } from '../../lib/toast'
import type { Participant, SessionCaptures, WorkspaceTask } from '../../lib/types'
import { Icon, type IconName } from '../icons'
import { Spinner } from '../ui'
import type { CaptureTab } from './WorkspaceTaskCard'

export interface CaptureRequest {
  tab: CaptureTab
  taskId?: string
  nonce: number
}

const tabs: { value: CaptureTab; label: string; icon: IconName }[] = [
  { value: 'progress', label: 'Progress', icon: 'message' },
  { value: 'action', label: 'Action', icon: 'flag' },
  { value: 'decision', label: 'Decision', icon: 'check' },
  { value: 'blocker', label: 'Blocker', icon: 'alert' },
  { value: 'note', label: 'Note', icon: 'inbox' },
]

export default function MeetingCapture({
  sessionId,
  participants,
  tasks,
  selectedUserId,
  captures,
  request,
  onCaptured,
  onRequestComplete,
}: {
  sessionId: string
  participants: Participant[]
  tasks: WorkspaceTask[]
  selectedUserId: string | null
  captures: SessionCaptures | undefined
  request: CaptureRequest
  onCaptured: () => void
  onRequestComplete: () => void
}) {
  const [tab, setTab] = useState<CaptureTab>(request.tab)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { push } = useToast()

  const [progress, setProgress] = useState({ taskId: '', text: '', next: '', attributedTo: '' })
  const [action, setAction] = useState({ taskId: '', text: '', ownerId: '', dueDate: '' })
  const [decision, setDecision] = useState({ taskId: '', text: '', rationale: '', responsibleId: '' })
  const [blocker, setBlocker] = useState({ taskId: '', text: '', ownerId: '' })
  const [note, setNote] = useState({ text: '' })

  // Apply capture context during render so the selected task is visible in
  // the same commit as the click that requested it (no effect-timing gap).
  const [lastRequestNonce, setLastRequestNonce] = useState(request.nonce)
  if (request.nonce !== lastRequestNonce) {
    setLastRequestNonce(request.nonce)
    setTab(request.tab)
    if (request.taskId) {
      setProgress((value) => ({ ...value, taskId: request.taskId! }))
      setAction((value) => ({ ...value, taskId: request.taskId! }))
      setDecision((value) => ({ ...value, taskId: request.taskId! }))
      setBlocker((value) => ({ ...value, taskId: request.taskId! }))
    }
  }

  useEffect(() => {
    if (!selectedUserId) return
    setProgress((value) => ({ ...value, attributedTo: selectedUserId }))
    setAction((value) => ({ ...value, ownerId: selectedUserId }))
    setBlocker((value) => ({ ...value, ownerId: selectedUserId }))
    setDecision((value) => ({ ...value, responsibleId: selectedUserId }))
  }, [selectedUserId])

  const capturedItems = useMemo(() => {
    const items: { id: string; kind: string; text: string; meta: string; at: string }[] = []
    for (const update of captures?.updates ?? []) {
      items.push({
        id: update.id,
        kind: 'update',
        text: update.progress,
        meta: `${update.attributed_to?.full_name ?? update.author?.full_name ?? '—'} · ${humanize(update.source)}`,
        at: update.created_at,
      })
    }
    for (const item of captures?.blockers ?? []) {
      items.push({
        id: item.id,
        kind: 'blocker',
        text: item.description,
        meta: `${humanize(item.status)} · ${item.owner?.full_name ?? 'unassigned'}`,
        at: item.updated_at,
      })
    }
    for (const item of captures?.action_items ?? []) {
      items.push({
        id: item.id,
        kind: 'action',
        text: item.description,
        meta: `${humanize(item.status)} · ${item.owner?.full_name ?? 'unassigned'}`,
        at: item.created_at,
      })
    }
    for (const item of captures?.decisions ?? []) {
      items.push({ id: item.id, kind: 'decision', text: item.description, meta: 'Decision', at: item.created_at })
    }
    for (const item of captures?.notes ?? []) {
      items.push({ id: item.id, kind: 'note', text: item.body, meta: 'Note', at: item.created_at })
    }
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 7)
  }, [captures])

  const totalCaptured =
    (captures?.updates.length ?? 0) +
    (captures?.blockers.length ?? 0) +
    (captures?.action_items.length ?? 0) +
    (captures?.decisions.length ?? 0) +
    (captures?.notes.length ?? 0)

  async function submit(kind: CaptureTab, path: string, body: Record<string, unknown>) {
    setBusy(kind)
    setError(null)
    try {
      await api.post(`/standups/sessions/${sessionId}/${path}`, body)
      push(`Recorded ${kind === 'action' ? 'action item' : kind}.`)
      if (kind === 'progress') setProgress((value) => ({ ...value, text: '', next: '' }))
      if (kind === 'action') setAction((value) => ({ ...value, text: '', dueDate: '' }))
      if (kind === 'decision') setDecision((value) => ({ ...value, text: '', rationale: '' }))
      if (kind === 'blocker') setBlocker((value) => ({ ...value, text: '' }))
      if (kind === 'note') setNote({ text: '' })
      onCaptured()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const taskOptions = tasks.map((task) => (
    <option key={task.id} value={task.id}>
      {truncate(task.title, 42)} · {humanize(task.status)}
    </option>
  ))
  const ownerOptions = participants.map((participant) => (
    <option key={participant.user.id} value={participant.user.id}>
      {participant.user.full_name}
    </option>
  ))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 px-3 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Meeting capture</h2>
          <span className="badge badge-slate">{totalCaptured} recorded</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {tabs.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setTab(item.value)}
              className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold ${
                tab === item.value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              <Icon name={item.icon} className="h-3 w-3" />
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'progress' && (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!progress.taskId || !progress.text.trim()) return
              void submit('progress', 'updates', {
                task_id: progress.taskId,
                progress: progress.text.trim(),
                next_steps: progress.next.trim() || null,
                attributed_to_user_id: progress.attributedTo || null,
              })
            }}
          >
            <div>
              <label className="label">Task</label>
              <select
                className="select text-xs"
                value={progress.taskId}
                onChange={(event) => setProgress({ ...progress, taskId: event.target.value })}
                required
              >
                <option value="">Select a task…</option>
                {taskOptions}
              </select>
            </div>
            <div>
              <label className="label">What changed?</label>
              <textarea
                className="textarea min-h-[64px] text-xs"
                value={progress.text}
                onChange={(event) => setProgress({ ...progress, text: event.target.value })}
                placeholder="Progress since the last standup…"
                required
              />
            </div>
            <div>
              <label className="label">Next steps</label>
              <input
                className="input text-xs"
                value={progress.next}
                onChange={(event) => setProgress({ ...progress, next: event.target.value })}
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="label">About</label>
              <select
                className="select text-xs"
                value={progress.attributedTo}
                onChange={(event) => setProgress({ ...progress, attributedTo: event.target.value })}
              >
                <option value="">Task assignee</option>
                {ownerOptions}
              </select>
            </div>
            <SubmitButton busy={busy === 'progress'} label="Record progress" />
          </form>
        )}

        {tab === 'action' && (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!action.text.trim()) return
              void submit('action', 'action-items', {
                description: action.text.trim(),
                owner_id: action.ownerId || null,
                task_id: action.taskId || null,
                due_date: action.dueDate || null,
              })
            }}
          >
            <div>
              <label className="label">Required action</label>
              <textarea
                className="textarea min-h-[64px] text-xs"
                value={action.text}
                onChange={(event) => setAction({ ...action, text: event.target.value })}
                placeholder="What needs to happen?"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Owner</label>
                <select
                  className="select text-xs"
                  value={action.ownerId}
                  onChange={(event) => setAction({ ...action, ownerId: event.target.value })}
                >
                  <option value="">Unassigned</option>
                  {ownerOptions}
                </select>
              </div>
              <div>
                <label className="label">Due</label>
                <input
                  type="date"
                  className="input text-xs"
                  value={action.dueDate}
                  onChange={(event) => setAction({ ...action, dueDate: event.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="label">Related task</label>
              <select
                className="select text-xs"
                value={action.taskId}
                onChange={(event) => setAction({ ...action, taskId: event.target.value })}
              >
                <option value="">General follow-up</option>
                {taskOptions}
              </select>
            </div>
            <SubmitButton busy={busy === 'action'} label="Create follow-up" />
          </form>
        )}

        {tab === 'decision' && (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!decision.text.trim()) return
              void submit('decision', 'decisions', {
                description: decision.text.trim(),
                rationale: decision.rationale.trim() || null,
                task_id: decision.taskId || null,
                responsible_user_id: decision.responsibleId || null,
              })
            }}
          >
            <div>
              <label className="label">Decision</label>
              <textarea
                className="textarea min-h-[64px] text-xs"
                value={decision.text}
                onChange={(event) => setDecision({ ...decision, text: event.target.value })}
                placeholder="What was decided?"
                required
              />
            </div>
            <div>
              <label className="label">Rationale</label>
              <textarea
                className="textarea min-h-[44px] text-xs"
                value={decision.rationale}
                onChange={(event) => setDecision({ ...decision, rationale: event.target.value })}
                placeholder="Why? (optional)"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Related task</label>
                <select
                  className="select text-xs"
                  value={decision.taskId}
                  onChange={(event) => setDecision({ ...decision, taskId: event.target.value })}
                >
                  <option value="">General</option>
                  {taskOptions}
                </select>
              </div>
              <div>
                <label className="label">Responsible</label>
                <select
                  className="select text-xs"
                  value={decision.responsibleId}
                  onChange={(event) => setDecision({ ...decision, responsibleId: event.target.value })}
                >
                  <option value="">None</option>
                  {ownerOptions}
                </select>
              </div>
            </div>
            <SubmitButton busy={busy === 'decision'} label="Record decision" />
          </form>
        )}

        {tab === 'blocker' && (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!blocker.text.trim()) return
              void submit('blocker', 'blockers', {
                description: blocker.text.trim(),
                task_id: blocker.taskId || null,
                owner_id: blocker.ownerId || null,
                attributed_to_user_id: selectedUserId,
              })
            }}
          >
            <div>
              <label className="label">Blocker</label>
              <textarea
                className="textarea min-h-[64px] text-xs"
                value={blocker.text}
                onChange={(event) => setBlocker({ ...blocker, text: event.target.value })}
                placeholder="What is preventing progress? What is needed to unblock it?"
                required
              />
            </div>
            <div>
              <label className="label">Related task</label>
              <select
                className="select text-xs"
                value={blocker.taskId}
                onChange={(event) => setBlocker({ ...blocker, taskId: event.target.value })}
              >
                <option value="">Team-wide blocker</option>
                {taskOptions}
              </select>
            </div>
            <div>
              <label className="label">Owner / who can resolve it</label>
              <select
                className="select text-xs"
                value={blocker.ownerId}
                onChange={(event) => setBlocker({ ...blocker, ownerId: event.target.value })}
              >
                <option value="">Unassigned</option>
                {ownerOptions}
              </select>
            </div>
            <SubmitButton busy={busy === 'blocker'} label="Report blocker" />
          </form>
        )}

        {tab === 'note' && (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!note.text.trim()) return
              void submit('note', 'notes', { body: note.text.trim() })
            }}
          >
            <div>
              <label className="label">Meeting note</label>
              <textarea
                className="textarea min-h-[140px] text-xs"
                value={note.text}
                onChange={(event) => setNote({ text: event.target.value })}
                placeholder="Anything worth preserving that isn't a structured record…"
                required
              />
            </div>
            <SubmitButton busy={busy === 'note'} label="Add note" />
          </form>
        )}

        {error && <p className="mt-2 rounded-md bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">{error}</p>}

        <div className="mt-4 border-t border-slate-200 pt-3">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Captured this session
          </h3>
          {capturedItems.length === 0 ? (
            <p className="text-[11px] text-slate-400">Nothing captured yet. Records inherit the current employee context.</p>
          ) : (
            <div className="space-y-1">
              {capturedItems.map((item) => (
                <div key={`${item.kind}-${item.id}`} className="flex items-start gap-1.5 rounded-md px-1.5 py-1 odd:bg-slate-50">
                  <span
                    className={`mt-0.5 ${
                      item.kind === 'blocker'
                        ? 'text-rose-500'
                        : item.kind === 'decision'
                          ? 'text-violet-500'
                          : item.kind === 'action'
                            ? 'text-amber-500'
                            : 'text-slate-400'
                    }`}
                  >
                    <Icon
                      name={
                        item.kind === 'blocker'
                          ? 'alert'
                          : item.kind === 'decision'
                            ? 'check'
                            : item.kind === 'action'
                              ? 'flag'
                              : item.kind === 'note'
                                ? 'inbox'
                                : 'message'
                      }
                      className="h-3 w-3"
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[11px] leading-snug text-slate-700">{item.text}</p>
                    <p className="text-[9px] text-slate-400">
                      {item.meta} · {formatDateTime(item.at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-slate-200 p-2.5">
        <button type="button" className="btn btn-primary w-full" onClick={onRequestComplete}>
          <Icon name="check" /> Complete standup
        </button>
      </div>
    </div>
  )
}

function SubmitButton({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button type="submit" className="btn btn-primary w-full" disabled={busy}>
      {busy ? <Spinner /> : <Icon name="plus" />} {label}
    </button>
  )
}
