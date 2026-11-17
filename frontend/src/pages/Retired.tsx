import { Link } from 'react-router-dom'
import { Icon } from '../components/icons'

export default function RetiredPage({ name }: { name: string }): JSX.Element {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-3 py-20 text-center">
      <span className="rounded-full bg-recessed p-3 text-ink-subtle">
        <Icon name="ban" className="h-6 w-6" />
      </span>
      <h1 className="font-heading text-2xl font-extrabold text-ink">{name} has been retired</h1>
      <p className="text-sm leading-relaxed text-ink-muted">
        This tool is no longer part of the product. Existing records are retained for retention and
        audit; new work should be created as ordinary tasks. No automatic conversion has been
        performed.
      </p>
      <div className="mt-2 flex gap-2">
        <Link to="/" className="btn btn-primary">Back to Tasks</Link>
        <Link to="/tasks" className="btn btn-secondary">Open Tasks</Link>
      </div>
    </div>
  )
}
