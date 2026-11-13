import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PreMeetingCard from '../components/PreMeetingCard'
import { Icon } from '../components/icons'
import {
  Avatar,
  DueDate,
  EmptyState,
  ErrorBox,
  Loading,
  PageHeader,
  PriorityBadge,
  SessionStatusBadge,
  Spinner,
  Stat,
  StatusBadge,
} from '../components/ui'
import { api, query } from '../lib/api'
import { formatDate, humanize, relativeDay } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import type {
  ActionItem,
  Blocker,
  CarryForward,
  Page,
  Session,
  SessionDetail,
  Task,
} from '../lib/types'

export default function DashboardPage() {
  const { me, isManager } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()

  const today = useAsync<SessionDetail | null>(() => api.get('/standups/today'), [])
  const myTasks = useAsync<Page<Task>>(
    () => api.get(`/tasks${query({ assignee_id: me?.id, limit: 200 })}`),
    [me?.id],
  )
  const sessions = useAsync<Page<Session>>(() => api.get('/standups/sessions?limit=6'), [])
  const openBlockers = useAsync(
    () =>
      isManager
        ? api.get<Page<Blocker>>('/blockers?open_only=true&limit=8')
        : Promise.resolve({ items: [], total: 0, limit: 0, offset: 0 }),
    [isManager],
  )
  const openActions = useAsync(
    () =>
      isManager
        ? api.get<Page<ActionItem>>('/action-items?open_only=true&limit=8')
        : Promise.resolve({ items: [], total: 0, limit: 0, offset: 0 }),
    [isManager],
  )
  const teamTasks = useAsync(
    () =>
      isManager
        ? api.get<Page<Task>>('/tasks?limit=200')
        : Promise.resolve({ items: [], total: 0, limit: 0, offset: 0 }),
    [isManager],
  )
  const carry = useAsync<CarryForward>(
    () => (me ? api.get(`/standups/users/${me.id}/carry-forward`) : Promise.resolve(emptyCarry)),
    [me?.id],
  )

  const grouped = useMemo(() => {
    const tasks = myTasks.data?.items ?? []
    const needs: Task[] = []
    const active: Task[] = []
    const other: Task[] = []
    for (const task of tasks) {
      if (task.is_blocked || task.is_overdue || task.is_at_risk || task.open_action_item_count > 0) {
        needs.push(task)
      } else if (task.status === 'in_progress' || (task.due_date && task.status !== 'done' && task.status !== 'canceled')) {
        active.push(task)
      } else {
        other.push(task)
      }
    }
    return { needs, active, other }
  }, [myTasks.data])

  const pulse = useMemo(() => {
    const tasks = teamTasks.data?.items ?? []
    return {
      blocked: tasks.filter((task) => task.is_blocked).length,
      overdue: tasks.filter((task) => task.is_overdue).length,
      atRisk: tasks.filter((task) => task.is_at_risk).length,
      inProgress: tasks.filter((task) => task.status === 'in_progress').length,
    }
  }, [teamTasks.data])

  const participant = today.data?.participants.find((item) => item.user.id === me?.id)
  const reviewed = today.data?.reviewed_count ?? 0
  const participantCount = today.data?.participant_count ?? 0

  async function startStandup() {
    try {
      const session = await api.post<SessionDetail>('/standups/sessions', {})
      push('Standup opened.')
      navigate(`/standups/${session.id}/live`)
    } catch (caught) {
      push((caught as Error).message, 'error')
      today.refresh()
    }
  }

  function refreshAll() {
    today.refresh()
    myTasks.refresh()
    openBlockers.refresh()
    openActions.refresh()
    teamTasks.refresh()
    carry.refresh()
    sessions.refresh()
  }

  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div>
      <PageHeader
        title={`${greeting()}, ${me?.full_name.split(' ')[0]}`}
        subtitle={todayLabel}
        actions={
          today.data && isManager ? (
            <Link
              to={today.data.status === 'completed' ? `/standups/${today.data.id}` : `/standups/${today.data.id}/live`}
              className="btn btn-primary"
            >
              <Icon name={today.data.status === 'completed' ? 'history' : 'play'} />
              {today.data.status === 'completed'
                ? 'View today’s summary'
                : today.data.status === 'draft'
                  ? 'Open standup workspace'
                  : 'Resume live standup'}
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {isManager && (
            <TodaySessionCard
              session={today.data}
              loading={today.loading}
              onStart={startStandup}
              pulse={pulse}
            />
          )}

          {!isManager && today.data && me && (
            <PreMeetingCard
              session={today.data}
              me={me}
              tasks={myTasks.data?.items ?? []}
              onSubmitted={refreshAll}
            />
          )}

          {!isManager && !today.data && (
            <div className="card border-l-4 border-l-slate-300 p-4">
              <div className="flex items-start gap-3">
                <span className="rounded-lg bg-slate-100 p-2 text-slate-500">
                  <Icon name="calendar" className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold">No standup opened yet today</h2>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                    Your manager hasn&apos;t started today&apos;s session. Your tasks and latest updates are already
                    available — no need to re-enter anything.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">My work</h2>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Exception-first view of your assignments
                </p>
              </div>
              <Link to="/board" className="link text-xs">
                Open board
              </Link>
            </div>
            {myTasks.loading ? (
              <Loading />
            ) : myTasks.error ? (
              <div className="p-4">
                <ErrorBox message={myTasks.error} onRetry={myTasks.refresh} />
              </div>
            ) : (myTasks.data?.items.length ?? 0) === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No tasks assigned to you"
                  description="New work will appear here as soon as it is assigned."
                  icon="inbox"
                />
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {grouped.needs.length > 0 && (
                  <TaskGroup title="Needs attention" tone="rose" tasks={grouped.needs} />
                )}
                {grouped.active.length > 0 && (
                  <TaskGroup title="Active" tone="indigo" tasks={grouped.active} />
                )}
                {grouped.other.length > 0 && (
                  <TaskGroup title="Planned & lower priority" tone="slate" tasks={grouped.other} />
                )}
              </div>
            )}
          </div>

          {isManager && (
            <div className="grid gap-4 sm:grid-cols-2">
              <ExceptionList
                title="Open blockers"
                icon="alert"
                loading={openBlockers.loading}
                empty="No open blockers."
                items={(openBlockers.data?.items ?? []).map((blocker) => ({
                  id: blocker.id,
                  title: blocker.description,
                  meta: `${blocker.task_title ?? 'Team'} · ${blocker.age_days}d open · ${blocker.owner?.full_name ?? 'Unassigned'}`,
                  tone: 'rose' as const,
                }))}
              />
              <ExceptionList
                title="Open follow-ups"
                icon="flag"
                loading={openActions.loading}
                empty="No open follow-ups."
                items={(openActions.data?.items ?? []).map((item) => ({
                  id: item.id,
                  title: item.description,
                  meta: `${item.owner?.full_name ?? 'Unassigned'}${
                    item.due_date ? ` · due ${relativeDay(item.due_date)}` : ''
                  }${item.task_title ? ` · ${item.task_title}` : ''}`,
                  tone: 'amber' as const,
                }))}
              />
            </div>
          )}
        </div>

        <div className="space-y-5">
          {isManager && (
            <div className="card p-4">
              <h2 className="text-sm font-semibold">Team pulse</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Stat label="Blocked" value={pulse.blocked} tone="text-rose-600" />
                <Stat label="Overdue" value={pulse.overdue} tone="text-rose-600" />
                <Stat label="At risk" value={pulse.atRisk} tone="text-amber-600" />
                <Stat label="In progress" value={pulse.inProgress} />
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold">Carrying forward</h2>
              <span className="badge badge-slate">
                {(carry.data?.blockers.length ?? 0) + (carry.data?.action_items.length ?? 0)}
              </span>
            </div>
            <div className="space-y-2 p-3">
              {carry.loading && <Loading label="Checking open items…" />}
              {!carry.loading && carry.data && carry.data.blockers.length + carry.data.action_items.length === 0 && (
                <p className="px-1 py-2 text-xs text-slate-500">Nothing open. You are clear.</p>
              )}
              {[...(carry.data?.blockers ?? []), ...(carry.data?.action_items ?? [])]
                .slice(0, 5)
                .map((item) => (
                  <div key={`${item.kind}-${item.id}`} className="rounded-lg border border-slate-200 px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`badge ${item.kind === 'blocker' ? 'badge-rose' : 'badge-amber'}`}>
                        {item.kind === 'blocker' ? 'Blocker' : 'Follow-up'}
                      </span>
                      {item.age_days > 0 && <span className="text-[10px] text-slate-400">{item.age_days}d old</span>}
                    </div>
                    <p className="mt-1 text-xs leading-snug text-slate-700">{item.description}</p>
                    {item.task_title && <p className="mt-1 truncate text-[10px] text-slate-400">{item.task_title}</p>}
                  </div>
                ))}
              {(carry.data?.overdue_tasks.length ?? 0) > 0 && (
                <p className="px-1 pt-1 text-[11px] text-rose-600">
                  {carry.data!.overdue_tasks.length} overdue task(s) also need attention.
                </p>
              )}
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold">Recent standups</h2>
              <Link to="/standups" className="link text-xs">
                All
              </Link>
            </div>
            <div className="divide-y divide-slate-100">
              {sessions.loading && <Loading />}
              {sessions.data?.items.length === 0 && (
                <p className="px-4 py-4 text-xs text-slate-500">No standups yet.</p>
              )}
              {(sessions.data?.items ?? []).map((session) => (
                <Link
                  key={session.id}
                  to={`/standups/${session.id}`}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-slate-50"
                >
                  <div>
                    <p className="text-xs font-medium text-slate-800">{formatDate(session.session_date)}</p>
                    <p className="text-[10px] text-slate-400">
                      {session.reviewed_count}/{session.participant_count} reviewed
                      {session.open_blocker_count > 0 && ` · ${session.open_blocker_count} blocked`}
                    </p>
                  </div>
                  <SessionStatusBadge status={session.status} />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function TodaySessionCard({
  session,
  loading,
  onStart,
  pulse,
}: {
  session: SessionDetail | null | undefined
  loading: boolean
  onStart: () => void
  pulse: { blocked: number; overdue: number; atRisk: number }
}) {
  if (loading) {
    return (
      <div className="card p-4">
        <Loading label="Loading today’s standup…" />
      </div>
    )
  }
  if (!session) {
    return (
      <div className="card overflow-hidden border-l-4 border-l-emerald-600">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-emerald-50 p-2 text-emerald-700">
              <Icon name="play" className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">No standup for today yet</h2>
              <p className="mt-0.5 max-w-lg text-xs leading-relaxed text-slate-500">
                Open the session and the workspace will load every participant with their exceptions,
                carried-forward blockers and open follow-ups.
              </p>
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={onStart}>
            <Icon name="play" /> Start standup
          </button>
        </div>
        <div className="grid grid-cols-3 gap-px border-t border-slate-200 bg-slate-200">
          <div className="bg-white px-4 py-2.5">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Blocked</p>
            <p className="text-sm font-semibold text-rose-600">{pulse.blocked}</p>
          </div>
          <div className="bg-white px-4 py-2.5">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Overdue</p>
            <p className="text-sm font-semibold text-rose-600">{pulse.overdue}</p>
          </div>
          <div className="bg-white px-4 py-2.5">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">At risk</p>
            <p className="text-sm font-semibold text-amber-600">{pulse.atRisk}</p>
          </div>
        </div>
      </div>
    )
  }

  const reviewed = session.reviewed_count
  const total = session.participant_count || 1
  const percent = Math.round((reviewed / total) * 100)

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Today&apos;s standup</h2>
          <SessionStatusBadge status={session.status} />
        </div>
        <Link
          to={session.status === 'completed' ? `/standups/${session.id}` : `/standups/${session.id}/live`}
          className="btn btn-primary btn-sm"
        >
          <Icon name={session.status === 'completed' ? 'history' : 'arrowRight'} />
          {session.status === 'completed' ? 'Summary' : 'Open workspace'}
        </Link>
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            {reviewed} of {session.participant_count} participants reviewed
          </span>
          <span>{percent}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {session.participants.map((participant) => (
            <span
              key={participant.id}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                participant.reviewed_at
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : participant.pre_meeting_submitted_at
                    ? 'border-sky-200 bg-sky-50 text-sky-700'
                    : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              {participant.reviewed_at ? (
                <Icon name="check" className="h-3 w-3" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
              )}
              {participant.user.full_name.split(' ')[0]}
              {participant.open_blocker_count > 0 && (
                <span className="ml-0.5 rounded bg-rose-100 px-1 text-[9px] font-bold text-rose-700">
                  {participant.open_blocker_count}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px border-t border-slate-200 bg-slate-200">
        <div className="bg-white px-4 py-2.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Open blockers in session</p>
          <p className="text-sm font-semibold text-rose-600">{session.open_blocker_count}</p>
        </div>
        <div className="bg-white px-4 py-2.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Open follow-ups</p>
          <p className="text-sm font-semibold text-amber-600">{session.open_action_item_count}</p>
        </div>
      </div>
    </div>
  )
}

function TaskGroup({ title, tone, tasks }: { title: string; tone: 'rose' | 'indigo' | 'slate'; tasks: Task[] }) {
  const toneClass = {
    rose: 'text-rose-700 bg-rose-50',
    indigo: 'text-indigo-700 bg-indigo-50',
    slate: 'text-slate-600 bg-slate-100',
  }[tone]
  return (
    <div>
      <div className={`flex items-center gap-2 px-4 py-2 ${toneClass}`}>
        <span className="text-[10px] font-bold uppercase tracking-wider">{title}</span>
        <span className="text-[10px] opacity-70">{tasks.length}</span>
      </div>
      <div className="divide-y divide-slate-100">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-start gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-xs font-medium text-slate-800">{task.title}</p>
                {task.is_blocked && <span className="badge badge-rose">Blocked</span>}
                {task.is_at_risk && <span className="badge badge-amber">At risk</span>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <StatusBadge status={task.status} />
                <PriorityBadge priority={task.priority} />
                <DueDate date={task.due_date} overdue={task.is_overdue} />
                {task.project_name && <span className="text-[10px] text-slate-400">{task.project_name}</span>}
              </div>
              {task.latest_update && (
                <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-slate-500">
                  {task.latest_update.progress}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ExceptionList({
  title,
  icon,
  items,
  loading,
  empty,
}: {
  title: string
  icon: 'alert' | 'flag'
  items: { id: string; title: string; meta: string; tone: 'rose' | 'amber' }[]
  loading: boolean
  empty: string
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <Icon name={icon} className={`h-4 w-4 ${icon === 'alert' ? 'text-rose-500' : 'text-amber-500'}`} />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <p className="px-4 py-4 text-xs text-slate-500">{empty}</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {items.map((item) => (
            <div key={item.id} className="px-4 py-2.5">
              <p className="line-clamp-2 text-xs leading-snug text-slate-700">{item.title}</p>
              <p className={`mt-1 text-[10px] ${item.tone === 'rose' ? 'text-rose-600' : 'text-amber-600'}`}>
                {item.meta}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const emptyCarry: CarryForward = {
  blockers: [],
  action_items: [],
  at_risk_tasks: [],
  overdue_tasks: [],
}
