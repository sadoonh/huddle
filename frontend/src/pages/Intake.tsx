import { useState } from 'react'
import { Icon } from '../components/icons'
import {
  EmptyState,
  ErrorBox,
  Loading,
  Modal,
  PageHeader,
  PriorityBadge,
  Spinner,
} from '../components/ui'
import { api, query } from '../lib/api'
import { formatDate, humanize } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import {
  PRIORITIES,
  type IntakeRequest,
  type IntakeStatus,
  type Page,
  type Priority,
  type Project,
  type User,
} from '../lib/types'

const statusTone: Record<IntakeStatus, string> = {
  new: 'badge-sky',
  under_review: 'badge-amber',
  accepted: 'badge-emerald',
  rejected: 'badge-slate',
  converted: 'badge-violet',
}

const statusOptions: { value: IntakeStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'under_review', label: 'Under review' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'converted', label: 'Converted' },
]

export default function IntakePage() {
  const { isManager } = useAuth()
  const { push } = useToast()
  const [status, setStatus] = useState<IntakeStatus | ''>('')
  const [creating, setCreating] = useState(false)
  const [converting, setConverting] = useState<IntakeRequest | null>(null)

  const requests = useAsync<Page<IntakeRequest>>(
    () => api.get(`/intake${query({ status: status || undefined, limit: 100 })}`),
    [status],
  )
  const projects = useAsync<Project[]>(() => api.get('/projects'), [])
  const users = useAsync<User[]>(() => api.get('/users'), [])

  async function review(request: IntakeRequest, next: IntakeStatus) {
    try {
      await api.patch(`/intake/${request.id}`, { status: next })
      push(`Request marked ${humanize(next)}.`)
      requests.refresh()
    } catch (caught) {
      push((caught as Error).message, 'error')
    }
  }

  async function convertToProject(request: IntakeRequest) {
    try {
      await api.post(`/intake/${request.id}/convert-to-project`, {})
      push('Converted to a new project.')
      requests.refresh()
      projects.refresh()
    } catch (caught) {
      push((caught as Error).message, 'error')
    }
  }

  return (
    <div>
      <PageHeader
        title="Work intake"
        subtitle="A lightweight front door for new requests. No heavyweight approval matrix."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> New request
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1">
        {statusOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setStatus(option.value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              status === option.value
                ? 'bg-slate-900 text-white'
                : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {requests.loading ? (
        <Loading />
      ) : requests.error ? (
        <ErrorBox message={requests.error} onRetry={requests.refresh} />
      ) : requests.data?.items.length === 0 ? (
        <EmptyState
          icon="inbox"
          title="No requests"
          description="Submit a request and a manager can review it, accept it, or convert it into a task or project."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> New request
            </button>
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {requests.data!.items.map((request) => (
            <div key={request.id} className="card flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">{request.title}</h2>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {request.requester?.full_name ?? request.requester_name ?? 'Unknown'} ·{' '}
                    {formatDate(request.created_at)}
                  </p>
                </div>
                <span className={`badge ${statusTone[request.status]}`}>{humanize(request.status)}</span>
              </div>
              {request.description && (
                <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-slate-600">{request.description}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <PriorityBadge priority={request.priority} />
                {request.reviewed_by && (
                  <span className="text-[10px] text-slate-400">Reviewed by {request.reviewed_by.full_name}</span>
                )}
                {request.converted_task_id && <span className="badge badge-emerald">Task created</span>}
                {request.converted_project_id && <span className="badge badge-violet">Project created</span>}
              </div>
              {request.review_note && (
                <p className="mt-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600">
                  {request.review_note}
                </p>
              )}

              {isManager && request.status !== 'converted' && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2.5">
                  {request.status === 'new' && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => review(request, 'under_review')}
                    >
                      Start review
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => review(request, 'accepted')}
                  >
                    <Icon name="check" className="h-3 w-3" /> Accept
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => review(request, 'rejected')}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => setConverting(request)}
                  >
                    Convert to task
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => convertToProject(request)}
                  >
                    Convert to project
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {creating && (
        <IntakeCreateModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            requests.refresh()
          }}
        />
      )}

      {converting && (
        <IntakeConvertModal
          request={converting}
          projects={projects.data ?? []}
          users={users.data ?? []}
          onClose={() => setConverting(null)}
          onConverted={() => {
            setConverting(null)
            requests.refresh()
          }}
        />
      )}
    </div>
  )
}

function IntakeCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { push } = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      await api.post('/intake', { title, description: description || null, priority })
      push('Request submitted.')
      onCreated()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New work request"
      description="Capture the ask. A manager will review and prioritise it."
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={saving || !title.trim()}>
            {saving ? <Spinner /> : <Icon name="send" />} Submit request
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        <div>
          <label className="label">Title</label>
          <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea
            className="textarea"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What is needed and why?"
          />
        </div>
        <div>
          <label className="label">Priority</label>
          <select
            className="select"
            value={priority}
            onChange={(event) => setPriority(event.target.value as Priority)}
          >
            {PRIORITIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Modal>
  )
}

function IntakeConvertModal({
  request,
  projects,
  users,
  onClose,
  onConverted,
}: {
  request: IntakeRequest
  projects: Project[]
  users: User[]
  onClose: () => void
  onConverted: () => void
}) {
  const { push } = useToast()
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [assigneeId, setAssigneeId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function convert() {
    setSaving(true)
    setError(null)
    try {
      await api.post(`/intake/${request.id}/convert-to-task`, {
        project_id: projectId,
        assignee_id: assigneeId || null,
        due_date: dueDate || null,
      })
      push('Request converted to a task.')
      onConverted()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Convert to task"
      description={request.title}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={convert}
            disabled={saving || !projectId}
          >
            {saving ? <Spinner /> : <Icon name="plus" />} Create task
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        <div>
          <label className="label">Project</label>
          <select className="select" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Assignee</label>
          <select className="select" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Due date</label>
          <input type="date" className="input" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </div>
      </div>
    </Modal>
  )
}
