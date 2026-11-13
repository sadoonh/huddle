import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import { formatDateTime, humanize } from '../lib/format'
import { useAction } from '../lib/hooks'
import { useToast } from '../lib/toast'
import type { Me, SessionDetail, Task } from '../lib/types'
import { Icon } from './icons'
import { PriorityBadge, Spinner, StatusBadge } from './ui'

interface Props {
  session: SessionDetail
  me: Me
  tasks: Task[]
  onSubmitted: () => void
}

export default function PreMeetingCard({ session, me, tasks, onSubmitted }: Props) {
  const participant = session.participants.find((item) => item.user.id === me.id)
  const [progress, setProgress] = useState(participant?.pre_meeting_progress ?? '')
  const [nextSteps, setNextSteps] = useState(participant?.pre_meeting_next_steps ?? '')
  const [blockers, setBlockers] = useState(participant?.pre_meeting_blockers ?? '')
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [taskUpdates, setTaskUpdates] = useState<Record<string, { progress: string; next_steps: string }>>({})
  const [editing, setEditing] = useState(!participant?.pre_meeting_submitted_at)
  const { run, busy, error } = useAction()
  const { push } = useToast()

  const openTasks = useMemo(
    () => tasks.filter((task) => task.status !== 'done' && task.status !== 'canceled'),
    [tasks],
  )

  if (!participant) {
    return (
      <div className="card p-4 text-sm text-slate-600">
        You are not a participant in today&apos;s standup.
      </div>
    )
  }

  const closed = session.status === 'completed' || Boolean(participant.reviewed_at)
  const submitted = Boolean(participant.pre_meeting_submitted_at)

  async function submit() {
    const updates = Object.entries(taskUpdates)
      .filter(([, value]) => value.progress.trim())
      .map(([taskId, value]) => ({
        task_id: taskId,
        progress: value.progress.trim(),
        next_steps: value.next_steps.trim() || null,
      }))
    const result = await run(() =>
      api.post(`/standups/sessions/${session.id}/participants/${me.id}/pre-meeting`, {
        progress: progress.trim() || null,
        next_steps: nextSteps.trim() || null,
        blockers: blockers.trim() || null,
        task_updates: updates,
      }),
    )
    if (result !== undefined) {
      push('Pre-meeting update saved.')
      setEditing(false)
      setTaskUpdates({})
      setOpenTask(null)
      onSubmitted()
    }
  }

  if (closed) {
    return (
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <Icon name="message" className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold">Your standup update</h2>
          </div>
          <span className="badge badge-slate">{humanize(session.status)}</span>
        </div>
        <div className="space-y-3 p-4 text-sm">
          {submitted ? (
            <>
              <Note label="Progress" value={participant.pre_meeting_progress} />
              <Note label="Next steps" value={participant.pre_meeting_next_steps} />
              <Note label="Blockers" value={participant.pre_meeting_blockers} tone="rose" />
            </>
          ) : (
            <p className="text-slate-500">
              No pre-meeting update was submitted. Your manager can still review your existing task state.
            </p>
          )}
          <p className="text-[11px] text-slate-400">
            {participant.reviewed_at
              ? 'Your update is closed because your manager has reviewed you.'
              : 'The session has ended.'}
          </p>
        </div>
      </div>
    )
  }

  if (submitted && !editing) {
    return (
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Icon name="check" className="h-3 w-3" strokeWidth={3} />
            </span>
            <h2 className="text-sm font-semibold">Update submitted</h2>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
            Edit
          </button>
        </div>
        <div className="space-y-3 p-4 text-sm">
          <Note label="Progress" value={participant.pre_meeting_progress} />
          <Note label="Next steps" value={participant.pre_meeting_next_steps} />
          <Note label="Blockers" value={participant.pre_meeting_blockers} tone="rose" />
          <p className="text-[11px] text-slate-400">
            Submitted {formatDateTime(participant.pre_meeting_submitted_at)} · editable until your manager reviews you.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Before the standup</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Two minutes now saves ten minutes in the meeting. Link updates to tasks where possible.
          </p>
        </div>
        {submitted && (
          <span className="badge badge-emerald">
            <Icon name="check" className="h-3 w-3" /> Saved
          </span>
        )}
      </div>

      <div className="space-y-3 p-4">
        <div>
          <label className="label" htmlFor="pre-progress">Progress since last standup</label>
          <textarea
            id="pre-progress"
            className="textarea"
            value={progress}
            onChange={(event) => setProgress(event.target.value)}
            placeholder="What changed since we last spoke?"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="pre-next">Next steps</label>
            <textarea
              id="pre-next"
              className="textarea"
              value={nextSteps}
              onChange={(event) => setNextSteps(event.target.value)}
              placeholder="What will you work on next?"
            />
          </div>
          <div>
            <label className="label" htmlFor="pre-blockers">Blockers / help needed</label>
            <textarea
              id="pre-blockers"
              className="textarea border-rose-200 focus:border-rose-400 focus:ring-rose-400/20"
              value={blockers}
              onChange={(event) => setBlockers(event.target.value)}
              placeholder="Anything preventing progress?"
            />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="label mb-0">Task updates</span>
            <span className="text-[11px] text-slate-400">Optional · linked to your tasks</span>
          </div>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {openTasks.length === 0 && (
              <p className="px-3 py-3 text-xs text-slate-500">No open tasks assigned to you.</p>
            )}
            {openTasks.map((task) => {
              const isOpen = openTask === task.id
              const value = taskUpdates[task.id]
              return (
                <div key={task.id} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-slate-800">{task.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={task.status} />
                        <PriorityBadge priority={task.priority} />
                        {task.is_blocked && <span className="badge badge-rose">Blocked</span>}
                        {task.is_at_risk && <span className="badge badge-amber">At risk</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm shrink-0"
                      onClick={() => setOpenTask(isOpen ? null : task.id)}
                    >
                      {isOpen ? 'Close' : value?.progress ? 'Edit update' : 'Add update'}
                    </button>
                  </div>
                  {isOpen && (
                    <div className="mt-2 grid gap-2 rounded-md bg-slate-50 p-2.5 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <label className="label">Progress on this task</label>
                        <textarea
                          className="textarea min-h-[56px] bg-white"
                          value={value?.progress ?? ''}
                          onChange={(event) =>
                            setTaskUpdates((current) => ({
                              ...current,
                              [task.id]: { ...(current[task.id] ?? { next_steps: '' }), progress: event.target.value },
                            }))
                          }
                          placeholder="What moved on this task?"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="label">Next steps</label>
                        <input
                          className="input bg-white"
                          value={value?.next_steps ?? ''}
                          onChange={(event) =>
                            setTaskUpdates((current) => ({
                              ...current,
                              [task.id]: { ...(current[task.id] ?? { progress: '' }), next_steps: event.target.value },
                            }))
                          }
                          placeholder="Optional"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {error && <p className="text-xs font-medium text-rose-600">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          <p className="text-[11px] text-slate-400">Editable until your manager marks you reviewed.</p>
          <div className="flex gap-2">
            {submitted && (
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
              {busy ? <Spinner /> : <Icon name="send" />}
              {submitted ? 'Save changes' : 'Submit update'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Note({ label, value, tone }: { label: string; value: string | null; tone?: 'rose' }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 whitespace-pre-wrap text-sm ${tone === 'rose' && value ? 'text-rose-700' : 'text-slate-700'}`}>
        {value || <span className="text-slate-400">—</span>}
      </p>
    </div>
  )
}
