import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { humanize } from '../lib/format'
import { Avatar } from './ui'
import { Icon, type IconName } from './icons'

const primary: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Today', icon: 'calendar' },
  { to: '/work', label: 'Work', icon: 'board' },
]

function IdentitySwitcher() {
  const { mode, users, me, switchUser, currentIdentity } = useAuth()
  if (mode !== 'dev') {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-slate-300">
        <p className="font-semibold text-white">{me?.full_name}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">Signed in through nex SSO</p>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-2">
      <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        Viewing as · dev
      </p>
      <select
        aria-label="Switch identity"
        value={currentIdentity}
        onChange={(event) => switchUser(event.target.value)}
        className="w-full rounded-md border border-white/10 bg-ink-900 px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
      >
        {users.map((user) => (
          <option key={user.id} value={user.email}>
            {user.full_name} · {humanize(user.role)}
          </option>
        ))}
        {!users.length && <option value={currentIdentity}>{currentIdentity}</option>}
      </select>
    </div>
  )
}

export default function Layout() {
  const { me, isManager } = useAuth()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  const sidebar = (
    <div className="flex h-full flex-col bg-ink-950 text-white">
      <div className="flex items-center gap-2.5 px-4 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-lg shadow-emerald-900/40">
          <Icon name="check" className="h-4 w-4" strokeWidth={2.4} />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">Standup</p>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">nex portal</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-4" aria-label="Primary">
        <p className="px-2 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Daily
        </p>
        {primary.map((item) => {
          const active =
            item.to === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith('/work') || location.pathname.startsWith('/legacy/board')
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className={`nav-item ${active ? 'nav-item-active' : ''}`}
            >
              <Icon name={item.icon} className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          )
        })}

        <div className="mt-5 border-t border-white/10 pt-3">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300">
              Pilot tools
              <Icon name="chevronRight" className="h-3 w-3 transition-transform group-open:rotate-90" />
            </summary>
            <div className="mt-1 space-y-0.5">
              <Link to="/intake" onClick={() => setMobileOpen(false)} className="nav-item text-xs">
                <Icon name="inbox" className="h-3.5 w-3.5 shrink-0" />
                Work intake
              </Link>
              {isManager && (
                <Link to="/ai" onClick={() => setMobileOpen(false)} className="nav-item text-xs">
                  <Icon name="sparkles" className="h-3.5 w-3.5 shrink-0" />
                  Transcript review
                </Link>
              )}
              <Link to="/legacy/board" onClick={() => setMobileOpen(false)} className="nav-item text-xs">
                <Icon name="board" className="h-3.5 w-3.5 shrink-0" />
                Legacy board
              </Link>
              {isManager && (
                <Link to="/settings/projects" onClick={() => setMobileOpen(false)} className="nav-item text-xs">
                  <Icon name="folder" className="h-3.5 w-3.5 shrink-0" />
                  Project settings
                </Link>
              )}
            </div>
          </details>
        </div>
      </nav>

      <div className="space-y-2 border-t border-white/10 p-3">
        <div className="flex items-center gap-2 px-1">
          <Avatar name={me?.full_name ?? '?'} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white">{me?.full_name}</p>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">{humanize(me?.role ?? '')}</p>
          </div>
        </div>
        <IdentitySwitcher />
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-100">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-52 lg:block">{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-56">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-52">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-100/90 px-4 py-2.5 backdrop-blur lg:hidden">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Icon name="menu" className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold">Standup</span>
          <Avatar name={me?.full_name ?? '?'} size="sm" />
        </header>

        <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
