import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import AccountMenu from './AccountMenu'

const primary = [
  { to: '/tasks', label: 'Tasks', end: true },
]

export default function Layout() {
  const { me, mode, refresh } = useAuth()
  const location = useLocation()
  // The board needs four readable lanes; reading surfaces keep their width.
  const wide = location.pathname === '/' || location.pathname.startsWith('/tasks')

  return (
    <div className="min-h-screen bg-canvas">
      <header className="brand-header">
        <div
          className="relative z-10 mx-auto flex min-h-[61px] w-full max-w-[1440px] flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2 sm:gap-x-5 sm:px-[26px] lg:min-h-[72px]"
        >
          <Link
            to="/"
            aria-label="nex home"
            className="brand-wordmark shrink-0 text-[40px] lg:text-[48px]"
          >
            ne<span className="text-signal">x</span>
          </Link>

          <nav aria-label="Primary" className="flex items-center gap-1">
            {primary.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `brand-nav-item ${isActive ? 'brand-nav-active' : 'brand-nav-idle'}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {me ? (
              <AccountMenu me={me} mode={mode} onRefresh={refresh} />
            ) : (
              <span className="text-sm text-[#a9b2ba]" aria-label="Account loading">
                Account
              </span>
            )}
          </div>
        </div>
      </header>

      <main
        className={`mx-auto w-full px-4 py-6 sm:px-6 ${
          wide ? 'max-w-[1440px]' : 'max-w-5xl'
        }`}
      >
        <Outlet />
      </main>
    </div>
  )
}
