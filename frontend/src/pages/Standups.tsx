import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/icons'
import {
  EmptyState,
  ErrorBox,
  Loading,
  PageHeader,
  SessionStatusBadge,
} from '../components/ui'
import { api, query } from '../lib/api'
import { formatSessionDate } from '../lib/format'
import { useAsync } from '../lib/hooks'
import type { Page, Session } from '../lib/types'

const PAGE_SIZE = 20

export default function StandupsPage() {
  const [params, setParams] = useSearchParams()
  const page = Math.max(Number(params.get('page') ?? '0') || 0, 0)
  const start = params.get('start') ?? ''
  const end = params.get('end') ?? ''

  const sessions = useAsync<Page<Session>>(
    () =>
      api.get(
        `/standups/sessions${query({
          start: start || undefined,
          end: end || undefined,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        })}`,
      ),
    [start, end, page],
  )

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next, { replace: true })
  }

  const total = sessions.data?.total ?? 0
  const shownFrom = total === 0 ? 0 : page * PAGE_SIZE + 1
  const shownTo = Math.min((page + 1) * PAGE_SIZE, total)
  const hasDateFilter = Boolean(start || end)

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Past standups"
        subtitle="Session outcomes, actions and still-open help requests."
        actions={
          <Link to="/" className="btn btn-secondary">
            <Icon name="arrowLeft" /> Today
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="history-start">From</label>
          <input
            id="history-start"
            type="date"
            className="input w-auto"
            value={start}
            onChange={(event) => setParam('start', event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="history-end">To</label>
          <input
            id="history-end"
            type="date"
            className="input w-auto"
            value={end}
            onChange={(event) => setParam('end', event.target.value)}
          />
        </div>
        {hasDateFilter && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setParams(new URLSearchParams(), { replace: true })
            }}
          >
            Clear dates
          </button>
        )}
        <span className="ml-auto text-sm text-slate-500">{total} session{total === 1 ? '' : 's'}</span>
      </div>

      {sessions.loading && !sessions.data ? (
        <Loading />
      ) : sessions.error && !sessions.data ? (
        <ErrorBox message={sessions.error} onRetry={sessions.refresh} />
      ) : sessions.data?.items.length === 0 ? (
        <EmptyState
          icon="history"
          title={hasDateFilter ? 'No standups in this date range' : 'No standups yet'}
          description={
            hasDateFilter
              ? 'Clear the date filter to see the full history.'
              : 'Sessions will appear here after the first standup is opened.'
          }
          action={
            hasDateFilter ? (
              <button type="button" className="btn btn-secondary" onClick={() => setParams(new URLSearchParams())}>
                Clear dates
              </button>
            ) : (
              <Link to="/" className="btn btn-primary">Go to Today</Link>
            )
          }
        />
      ) : (
        <>
          {sessions.loading && <p className="mb-2 text-sm text-slate-500">Refreshing…</p>}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sessions.data!.items.map((session) => (
              <Link
                key={session.id}
                to={`/standups/${session.id}`}
                className="card group flex flex-col gap-3 p-4 transition-shadow hover:shadow-lg"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-semibold text-slate-900">{formatSessionDate(session.session_date)}</p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      Facilitated by {session.facilitator?.full_name ?? '—'}
                    </p>
                  </div>
                  <SessionStatusBadge status={session.status} />
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <Icon name="users" className="h-4 w-4" /> {session.reviewed_count}/{session.participant_count} reviewed
                  </span>
                  {session.open_blocker_count > 0 && (
                    <span className="inline-flex items-center gap-1 text-rose-700">
                      <Icon name="alert" className="h-4 w-4" /> {session.open_blocker_count} help
                    </span>
                  )}
                  {session.open_action_item_count > 0 && (
                    <span className="inline-flex items-center gap-1 text-amber-700">
                      <Icon name="flag" className="h-4 w-4" /> {session.open_action_item_count} follow-ups
                    </span>
                  )}
                </div>
                <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
                  Review outcomes <Icon name="arrowRight" className="h-4 w-4" />
                </span>
              </Link>
            ))}
          </div>

          {total > PAGE_SIZE && (
            <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
              <span>{shownFrom}–{shownTo} of {total}</span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={page === 0}
                  onClick={() => setParam('page', String(page - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={shownTo >= total}
                  onClick={() => setParam('page', String(page + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
