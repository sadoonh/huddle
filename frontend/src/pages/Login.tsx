import { useState } from 'react'
import { Icon } from '../components/icons'
import { Avatar, Spinner } from '../components/ui'
import { useAuth } from '../lib/auth'
import { humanize } from '../lib/format'

export default function LoginPage() {
  const { error, users, mode, switchUser, refresh } = useAuth()
  const [busy, setBusy] = useState(false)

  function choose(email: string) {
    switchUser(email)
    setBusy(true)
    window.setTimeout(() => {
      refresh()
      setBusy(false)
    }, 120)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <Icon name="check" className="h-5 w-5" strokeWidth={2.4} />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-white">Standup</h1>
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">nex portal</p>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <h2 className="text-sm font-semibold text-white">Sign in</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {mode === 'nex'
              ? 'This application is embedded in the nex portal. Open it from nex to use your company SSO session.'
              : 'Choose a demo identity to explore the manager and employee experiences.'}
          </p>

          {error && (
            <p className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {error}
            </p>
          )}

          {mode === 'dev' && (
            <div className="mt-4 space-y-1.5">
              {users.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => choose(user.email)}
                  className="flex w-full items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left transition-colors hover:bg-white/10"
                >
                  <Avatar name={user.full_name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-white">{user.full_name}</span>
                    <span className="block truncate text-[11px] text-slate-400">
                      {humanize(user.role)} · {user.email}
                    </span>
                  </span>
                  {busy ? <Spinner className="h-4 w-4 text-slate-300" /> : <Icon name="arrowRight" className="h-4 w-4 text-slate-500" />}
                </button>
              ))}
              {!users.length && (
                <p className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-400">
                  No dev users found. Run <code className="text-emerald-300">python -m app.seed</code> in the backend.
                </p>
              )}
            </div>
          )}

          {mode === 'nex' && (
            <button type="button" className="btn btn-primary mt-4 w-full" onClick={refresh}>
              Retry SSO session
            </button>
          )}
        </div>
        <p className="mt-4 text-center text-[11px] text-slate-500">
          Standup-first work management · MVP
        </p>
      </div>
    </div>
  )
}
