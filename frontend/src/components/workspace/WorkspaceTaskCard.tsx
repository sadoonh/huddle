import { useState } from 'react'
import { api } from '../../lib/api'
import { formatDate, humanize, relativeDay } from '../../lib/format'
import { useToast } from '../../lib/toast'
import {
  TASK_STATUSES,
  type TaskStatus,
  type TaskUpdate,
  type WorkspaceTask,
  type Decision,
} from '../../lib/types'
import { Icon } from '../icons'
import { DueDate, PriorityBadge, Spinner, StatusBadge } from '../ui'

export type CaptureTab = 'progress' | 'action' | 'decision' | 'blocker' | 'note'

const reasonMeta: Record<string, { label: string; tone: string }> = {
  blocker: { label: 'Blocked', tone: 'badge-rose' },
  overdue: { label: 'Overdue', tone: 'badge-rose' },
  at_risk: { label: 'At risk', tone: 'badge-amber' },
  follow_up: { label: 'Follow-up', tone: 'badge-amber' },
  in_progress: { label: 'In progress', tone: 'badge-indigo' },
  due_soon: { label: 'Due soon', tone: 'badge-sky' },
}

export default function WorkspaceTaskCard({
  task,
  sessionId,
  recentUpdates,
  recentDecisions,
  onChanged,
  onCapture,
}: {
  task: WorkspaceTask
  sessionId: string
  recentUpdates: TaskUpdate[]
  recentDecisions: Decision[]
  onChanged: () => void
  onCapture: (tab: CaptureTab, taskId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [resolving, setResolving] = useState<string | null>(null)
  const [resolution, setResolution] = useState('')
  const { push } = useToast()

  const updates = recentUpdates.filter((update) => update.task_id === task.id).slice(0, 3)
  const decisions = recentDecisions.filter((decision) => decision.task_id === task.id)

  async function changeStatus(status: TaskStatus) {
    if (status === task.status) return
    setBusy('status')
    try {
      await api.patch(`/standups/sessions/${sessionId}/tasks/${task.id}/status`, { status })
      push(`Task moved to ${humanize(status)}.`)
      onChanged()
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  async function resolve(blockerId: string) {
    if (!resolution.trim()) return
    setBusy(blockerId)
    try {
      await api.patch(`/standups/sessions/${sessionId}/blockers/${blockerId}/resolve`, {
        resolution_details: resolution.trim(),
      })
      push('Blocker resolved.')
      setResolving(null)
      setResolution('')
      onChanged()
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  async function completeAction(actionId: string) {
    setBusy(actionId)
    try {
      await api.patch(`/action-items/${actionId}`, { status: 'completed' })
      push('Follow-up completed.')
      onChanged()
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const border =
    task.open_blockers.length > 0 || task.is_overdue
      ? 'border-l-rose-500'
      : task.is_at_risk || task.open_action_items.length > 0
        ? 'border-l-amber-400'
        : task.status === 'in_progress'
          ? 'border-l-indigo-400'
          : 'border-l-slate-200'

  return (
    <div className={`card overflow-hidden rounded-lg border-l-4 ${border}`}>
      <div className="px-3 py-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <button
              type="button"
              className="block max-w-full truncate text-left text-sm font-semibold text-slate-900 hover:text-emerald-700"
              onClick={() => setExpanded((value) => !value)}
            >
              {task.title}
            </button>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={task.status} />
              <PriorityBadge priority={task.priority} />
              <DueDate date={task.due_date} overdue={task.is_overdue} />
              {task.project_name && <span className="text-[10px] text-slate-400">{task.project_name}</span>}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm shrink-0"
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? 'Collapse task' : 'Expand task'}
          >
            <Icon name={expanded ? 'chevronDown' : 'chevronRight'} />
          </button>
        </div>

        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.reasons.map((reason) => {
            const meta = reasonMeta[reason]
            if (!meta) return null
            return (
              <span key={reason} className={`badge ${meta.tone}`}>
                {meta.label}
              </span>
            )
          })}
          {task.is_at_risk && task.at_risk_reason && (
            <span className="truncate text-[10px] text-amber-600">· {task.at_risk_reason}</span>
          )}
        </div>

        {task.latest_update && !expanded && (
          <p className="mt-1.5 line-clamp-2 border-l-2 border-slate-100 pl-2 text-[11px] leading-snug text-slate-500">
            {task.latest_update.progress}
          </p>
        )}
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-slate-100 bg-slate-50/50 px-3 py-2.5">
          {task.description && <p className="text-xs leading-relaxed text-slate-600">{task.description}</p>}

          {task.open_blockers.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-rose-600">Open blockers</p>
              <div className="space-y-1.5">
                {task.open_blockers.map((blocker) => (
                  <div key={blocker.id} className="rounded-md border border-rose-200 bg-white p-2">
                    <p className="text-xs text-slate-700">{blocker.description}</p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="text-[10px] text-slate-400">
                        {blocker.owner?.full_name ?? 'Unassigned'} · {blocker.age_days}d open
                      </p>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setResolving(resolving === blocker.id ? null : blocker.id)}
                      >
                        {resolving === blocker.id ? 'Cancel' : 'Resolve'}
                      </button>
                    </div>
                    {resolving === blocker.id && (
                      <div className="mt-1.5 space-y-1.5">
                        <textarea
                          className="textarea min-h-[52px] text-xs"
                          placeholder="How was it resolved?"
                          value={resolution}
                          onChange={(event) => setResolution(event.target.value)}
                        />
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={busy === blocker.id || !resolution.trim()}
                          onClick={() => resolve(blocker.id)}
                        >
                          {busy === blocker.id ? <Spinner className="h-3 w-3" /> : <Icon name="check" className="h-3 w-3" />}
                          Save resolution
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {task.open_action_items.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-600">
                Open follow-ups
              </p>
              <div className="space-y-1.5">
                {task.open_action_items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-white px-2 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs text-slate-700">{item.description}</p>
                      <p className="text-[10px] text-slate-400">
                        {item.owner?.full_name ?? 'Unassigned'}
                        {item.due_date ? ` · due ${relativeDay(item.due_date)}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm shrink-0"
                      disabled={busy === item.id}
                      onClick={() => completeAction(item.id)}
                    >
                      {busy === item.id ? <Spinner className="h-3 w-3" /> : <Icon name="check" className="h-3 w-3" />}
                      Done
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {task.latest_update?.next_steps && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Next steps</p>
              <p className="mt-0.5 text-xs text-slate-600">{task.latest_update.next_steps}</p>
            </div>
          )}

          {updates.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Recent updates
              </p>
              <div className="space-y-1">
                {updates.map((update) => (
                  <div key={update.id} className="rounded-md bg-white px-2 py-1.5">
                    <p className="text-[11px] leading-snug text-slate-600">{update.progress}</p>
                    <p className="mt-0.5 text-[9px] text-slate-400">
                      {update.attributed_to?.full_name ?? update.author?.full_name ?? '—'} ·{' '}
                      {formatDate(update.created_at)} · {humanize(update.source)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {decisions.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-violet-500">Decisions</p>
              {decisions.map((decision) => (
                <p key={decision.id} className="rounded-md bg-violet-50 px-2 py-1.5 text-[11px] text-violet-800">
                  {decision.description}
                </p>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200 pt-2">
            <select
              className="select w-auto py-1 text-xs"
              value={task.status}
              disabled={busy === 'status'}
              onChange={(event) => changeStatus(event.target.value as TaskStatus)}
              aria-label="Change task status"
            >
              {TASK_STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onCapture('progress', task.id)}>
              <Icon name="message" className="h-3 w-3" /> Log update
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onCapture('blocker', task.id)}>
              <Icon name="alert" className="h-3 w-3" /> Report blocker
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onCapture('action', task.id)}>
              <Icon name="flag" className="h-3 w-3" /> Follow-up
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onCapture('decision', task.id)}>
              <Icon name="check" className="h-3 w-3" /> Decision
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
