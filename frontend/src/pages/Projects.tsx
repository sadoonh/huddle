import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/icons'
import {
  Avatar,
  EmptyState,
  ErrorBox,
  Loading,
  Modal,
  PageHeader,
  Spinner,
} from '../components/ui'
import { api } from '../lib/api'
import { humanize } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import type { Project, User } from '../lib/types'

const statusTone: Record<Project['status'], string> = {
  active: 'badge-emerald',
  paused: 'badge-amber',
  completed: 'badge-sky',
  archived: 'badge-slate',
}

export default function ProjectsPage() {
  const { isManager } = useAuth()
  const { push } = useToast()
  const projects = useAsync<Project[]>(() => api.get('/projects'), [])
  const users = useAsync<User[]>(() => api.get('/users'), [])
  const [creating, setCreating] = useState(false)

  async function changeStatus(project: Project, status: Project['status']) {
    try {
      await api.patch(`/projects/${project.id}`, { status })
      projects.refresh()
    } catch (caught) {
      push((caught as Error).message, 'error')
    }
  }

  return (
    <div>
      <PageHeader
        title="Project settings"
        subtitle="Ownership, members and task context. Reachable from Work."
        actions={
          isManager && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> New project
            </button>
          )
        }
      />

      {projects.loading ? (
        <Loading />
      ) : projects.error ? (
        <ErrorBox message={projects.error} onRetry={projects.refresh} />
      ) : projects.data?.length === 0 ? (
        <EmptyState
          icon="folder"
          title="No projects yet"
          description="Create a project to group tasks and give the standup context."
          action={
            isManager ? (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                <Icon name="plus" /> New project
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.data!.map((project) => {
            const counts = project.task_counts
            const open = (counts.backlog ?? 0) + (counts.todo ?? 0) + (counts.in_progress ?? 0)
            const done = counts.done ?? 0
            const total = Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0) || 1
            return (
              <div key={project.id} className="card flex flex-col overflow-hidden">
                <div className="flex items-start justify-between gap-2 p-4 pb-2">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">{project.name}</h2>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className={`badge ${statusTone[project.status]}`}>{humanize(project.status)}</span>
                      <span className="text-[10px] text-slate-400">
                        {open} open · {done} done
                      </span>
                    </div>
                  </div>
                  {isManager && (
                    <select
                      className="select w-auto py-1 text-[10px]"
                      value={project.status}
                      onChange={(event) => changeStatus(project, event.target.value as Project['status'])}
                      aria-label="Project status"
                    >
                      {(['active', 'paused', 'completed', 'archived'] as const).map((status) => (
                        <option key={status} value={status}>
                          {humanize(status)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <p className="line-clamp-2 px-4 text-xs leading-relaxed text-slate-500">
                  {project.description || 'No description.'}
                </p>

                <div className="px-4 pt-3">
                  <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="bg-indigo-500" style={{ width: `${((counts.in_progress ?? 0) / total) * 100}%` }} />
                    <div className="bg-sky-400" style={{ width: `${((counts.todo ?? 0) / total) * 100}%` }} />
                    <div className="bg-slate-300" style={{ width: `${((counts.backlog ?? 0) / total) * 100}%` }} />
                    <div className="bg-emerald-500" style={{ width: `${(done / total) * 100}%` }} />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 p-4 pt-3">
                  <div className="flex -space-x-1.5">
                    {project.owner && (
                      <span title={`Owner · ${project.owner.full_name}`}>
                        <Avatar name={project.owner.full_name} size="sm" />
                      </span>
                    )}
                    {project.members
                      .filter((member) => member.id !== project.owner?.id)
                      .slice(0, 3)
                      .map((member) => (
                        <span key={member.id} title={member.full_name}>
                          <Avatar name={member.full_name} size="sm" />
                        </span>
                      ))}
                    {project.members.length > 4 && (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[9px] font-semibold text-slate-600">
                        +{project.members.length - 4}
                      </span>
                    )}
                  </div>
                  <Link to={`/work?project=${project.id}`} className="btn btn-secondary btn-sm">
                    View tasks <Icon name="arrowRight" className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {creating && (
        <ProjectCreateModal
          users={users.data ?? []}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            projects.refresh()
          }}
        />
      )}
    </div>
  )
}

function ProjectCreateModal({
  users,
  onClose,
  onCreated,
}: {
  users: User[]
  onClose: () => void
  onCreated: () => void
}) {
  const { me } = useAuth()
  const { push } = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [ownerId, setOwnerId] = useState(me?.id ?? '')
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleMember(id: string) {
    setMemberIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    )
  }

  async function create() {
    setSaving(true)
    setError(null)
    try {
      await api.post('/projects', {
        name,
        description: description || null,
        owner_id: ownerId || null,
        member_ids: memberIds,
      })
      push('Project created.')
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
      title="New project"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={create} disabled={saving || !name.trim()}>
            {saving ? <Spinner /> : <Icon name="plus" />} Create project
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea
            className="textarea"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div>
          <label className="label">Owner</label>
          <select className="select" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Members</label>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {users.map((user) => (
              <label key={user.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={memberIds.includes(user.id)}
                  onChange={() => toggleMember(user.id)}
                  className="h-3.5 w-3.5 rounded border-slate-300"
                />
                {user.full_name}
                <span className="text-[10px] text-slate-400">{humanize(user.role)}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
