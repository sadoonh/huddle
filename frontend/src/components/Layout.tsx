import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { PILOT_ENABLED } from '../lib/config'
import { humanize } from '../lib/format'
import { Avatar } from './ui'
import { Icon } from './icons'

const primary = [
  { to: '/', label: 'Today', end: true },
  { to: '/work', label: 'Work', end: false },
]

export default function Layout() {
  const { me, isManager, mode, users, switchUser, currentIdentity } = useAuth()

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <Icon name="check" className="h-4 w-4" strokeWidth={2.4} />
            </span>
            <span className="text-sm font-semibold tracking-tight text-slate-900">Standup</span>
          </Link>

          <nav aria-label="Primary" className="flex items-center gap-1">
            {primary.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium ${
                    isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {PILOT_ENABLED && (
              <details className="relative">
                <summary className="btn btn-ghost btn-sm list-none [&::-webkit-details-marker]:hidden">
                  Pilot tools <Icon name="chevronDown" className="h-3 w-3" />
                </summary>
                <div
                  className="absolute right-0 z-30 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest('a')) {
                      event.currentTarget.closest('details')?.removeAttribute('open')
                    }
                  }}
                >
                  <Link to="/intake" className="block rounded px-2 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    Work intake
                  </Link>
                  {isManager && (
                    <Link to="/ai" className="block rounded px-2 py-2 text-sm text-slate-700 hover:bg-slate-50">
                      Transcript review
                    </Link>
                  )}
                  <Link to="/legacy/board" className="block rounded px-2 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    Legacy board
                  </Link>
                </div>
              </details>
            )}

            <div className="flex items-center gap-2">
              <Avatar name={me?.full_name ?? '?'} size="sm" />
              {mode !== 'dev' ? (
                <div className="hidden leading-tight sm:block">
                  <p className="max-w-[160px] truncate text-sm font-medium text-slate-800">{me?.full_name}</p>
                  <p className="text-xs text-slate-500">{humanize(me?.role ?? '')}</p>
                </div>
              ) : (
                <select
                  aria-label="Switch identity"
                  value={currentIdentity}
                  onChange={(event) => switchUser(event.target.value)}
                  className="max-w-[210px] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                >
                  {users.map((user) => (
                    <option key={user.id} value={user.email}>
                      {user.full_name} · {humanize(user.role)}
                    </option>
                  ))}
                  {!users.length && <option value={currentIdentity}>{currentIdentity}</option>}
                </select>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  )
}
