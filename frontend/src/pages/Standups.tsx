import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../components/icons'
import {
  EmptyState,
  ErrorBox,
  Loading,
  PageHeader,
  SessionStatusBadge,
  Spinner,
} from '../components/ui'
import { api } from '../lib/api'
import { formatDate } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import type { Page, Session, SessionDetail } from '../lib/types'
import { useState } from 'react'

export default function StandupsPage() {
  const { isManager } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const sessions = useAsync<Page<Session>>(() => api.get('/standups/sessions?limit=60'), [])

  async function openToday() {
    setBusy(true)
    try {
      const existing = await api.get<SessionDetail | null>('/standups/today')
      const session = existing ?? (await api.post<SessionDetail>('/standups/sessions', {}))
      navigate(session.status === 'completed' ? `/standups/${session.id}` : `/standups/${session.id}/live`)
    } catch (caught) {
      push((caught as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Standup history"
        subtitle="Every session is preserved with its structured outcomes and audit trail."
        actions={
          isManager && (
            <button type="button" className="btn btn-primary" onClick={openToday} disabled={busy}>
              {busy ? <Spinner /> : <Icon name="play" />} Open today&apos;s standup
            </button>
          )
        }
      />

      {sessions.loading ? (
        <Loading />
      ) : sessions.error ? (
        <ErrorBox message={sessions.error} onRetry={sessions.refresh} />
      ) : sessions.data?.items.length === 0 ? (
        <EmptyState
          icon="history"
          title="No standups yet"
          description="Once a session is opened it will appear here with its participants, outcomes and open commitments."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sessions.data!.items.map((session) => (
            <Link
              key={session.id}
              to={`/standups/${session.id}`}
              className="card group flex flex-col gap-3 p-4 transition-shadow hover:shadow-lg"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{formatDate(session.session_date)}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Facilitated by {session.facilitator?.full_name ?? '—'}
                  </p>
                </div>
                <SessionStatusBadge status={session.status} />
              </div>

              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <Icon name="users" className="h-3.5 w-3.5" /> {session.reviewed_count}/{session.participant_count}
                </span>
                {session.open_blocker_count > 0 && (
                  <span className="inline-flex items-center gap-1 text-rose-600">
                    <Icon name="alert" className="h-3.5 w-3.5" /> {session.open_blocker_count} open
                  </span>
                )}
                {session.open_action_item_count > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-600">
                    <Icon name="flag" className="h-3.5 w-3.5" /> {session.open_action_item_count} follow-ups
                  </span>
                )}
              </div>

              {session.summary ? (
                <p className="line-clamp-3 text-xs leading-relaxed text-slate-500">{session.summary}</p>
              ) : (
                <p className="text-xs italic text-slate-400">Session not yet completed.</p>
              )}

              <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                Review session <Icon name="arrowRight" className="h-3.5 w-3.5" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
