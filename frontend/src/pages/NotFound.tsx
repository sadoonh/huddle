import { Link } from 'react-router-dom'
import { Icon } from '../components/icons'

export default function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-3 py-20 text-center">
      <span className="rounded-full bg-raised p-3 text-ink-subtle shadow-sm">
        <Icon name="search" className="h-6 w-6" />
      </span>
      <h1 className="font-heading text-2xl font-extrabold text-ink">Page not found</h1>
      <p className="text-sm text-ink-muted">
        This link does not match anything in the app. Your work is safe.
      </p>
      <div className="mt-2 flex gap-2">
        <Link to="/" className="btn btn-primary">Back to Tasks</Link>
        <Link to="/tasks" className="btn btn-secondary">Open Tasks</Link>
      </div>
    </div>
  )
}
