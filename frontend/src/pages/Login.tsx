import { Avatar } from '../components/ui'
import { useAuth } from '../lib/auth'

export default function LoginPage() {
  const { error, mode, refresh } = useAuth()

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[linear-gradient(120deg,#292D34_5%,#363B43_100%)] px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-40 h-[420px] w-[420px] rounded-full border border-signal/10"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-56 -left-24 h-[420px] w-[420px] rounded-full border border-signal/5"
      />

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex items-end gap-3">
          <span className="brand-wordmark text-[48px]">
            ne<span className="text-signal">x</span>
          </span>
          <span className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#a9b2ba]">
            huddle
          </span>
        </div>

        <div className="rounded-card border border-hairline bg-raised p-5 shadow-floating">
          <h1 className="font-heading text-base font-extrabold tracking-tight text-ink">Sign in</h1>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">
            {mode === 'nex'
              ? 'This application is embedded in the nex portal. Open it from nex to use your company SSO session.'
              : 'The workspace could not connect. Local development signs in as Maya Chen.'}
          </p>

          {error && (
            <p className="mt-3 rounded-control border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <div className="mt-4 flex items-center gap-3 rounded-control border border-hairline bg-recessed/60 px-3 py-2.5">
            <Avatar name="Maya Chen" size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">Maya Chen</p>
              <p className="text-[11px] text-ink-muted">Manager · local development identity</p>
            </div>
          </div>

          <button type="button" className="btn btn-primary mt-4 w-full" onClick={refresh}>
            {mode === 'nex' ? 'Retry SSO session' : 'Retry connection'}
          </button>
        </div>

        <p className="mt-4 text-center text-[11px] font-medium text-[#a9b2ba]">
          nex <span className="px-1.5 text-white/30">/</span> Huddle work management
        </p>
      </div>
    </div>
  )
}
