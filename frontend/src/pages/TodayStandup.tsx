import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../components/icons'
import { ErrorBox, Loading, PageHeader, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import type { SessionDetail } from '../lib/types'

export default function TodayStandupPage() {
  const { isManager, me } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = useAsync<SessionDetail | null>(() => api.get('/standups/today'), [])

  useEffect(() => {
    if (!today.data || !isManager) return
    const target =
      today.data.status === 'completed'
        ? `/standups/${today.data.id}`
        : `/standups/${today.data.id}/live`
    navigate(target, { replace: true })
  }, [today.data, isManager, navigate])

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const session = await api.post<SessionDetail>('/standups/sessions', {})
      navigate(`/standups/${session.id}/live`)
    } catch (caught) {
      setError((caught as Error).message)
      today.refresh()
    } finally {
      setBusy(false)
    }
  }

  if (today.loading) return <Loading label="Finding today’s standup…" />
  if (today.error) return <ErrorBox message={today.error} onRetry={today.refresh} />

  if (today.data && !isManager) {
    const mine = today.data.participants.find((item) => item.user.id === me?.id)
    return (
      <div>
        <PageHeader title="Today’s standup" subtitle={today.data.status === 'completed' ? 'The session has ended.' : 'The session is live with your manager.'} />
        <div className="card mx-auto max-w-2xl p-6">
          <div className="flex items-start gap-4">
            <span className="rounded-xl bg-emerald-50 p-3 text-emerald-700">
              <Icon name="users" className="h-6 w-6" />
            </span>
            <div className="flex-1">
              <h2 className="text-base font-semibold">
                {today.data.status === 'completed' ? 'Standup completed' : 'Standup in progress'}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                {mine?.pre_meeting_submitted_at
                  ? 'Your pre-meeting update is with the manager. Your task state is visible without re-entering anything.'
                  : 'No pre-meeting update was submitted. Your existing task state is still visible to the manager.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/" className="btn btn-primary">Go to my dashboard</Link>
                <Link to={`/standups/${today.data.id}`} className="btn btn-secondary">
                  {today.data.status === 'completed' ? 'View summary' : 'Session details'}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Live standup" subtitle="A single workspace for the daily meeting." />
      <div className="card mx-auto max-w-2xl p-6">
        <div className="flex items-start gap-4">
          <span className="rounded-xl bg-emerald-50 p-3 text-emerald-700">
            <Icon name="play" className="h-6 w-6" />
          </span>
          <div className="flex-1">
            <h2 className="text-base font-semibold">No standup session for today</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">
              {isManager
                ? 'Open today’s session. Every participant is loaded with their pre-meeting update, exception-first task list and everything still carrying forward.'
                : `Your manager hasn't opened today's session yet, ${me?.full_name.split(' ')[0]}. Your latest task state is already available, so there is nothing to re-enter.`}
            </p>
            {error && <p className="mt-3 text-xs font-medium text-rose-600">{error}</p>}
            {isManager && (
              <button type="button" className="btn btn-primary mt-4" onClick={start} disabled={busy}>
                {busy ? <Spinner /> : <Icon name="play" />} Start today&apos;s standup
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
