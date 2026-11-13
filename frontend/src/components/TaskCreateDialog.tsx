import { useState } from 'react'
import { api } from '../lib/api'
import { useAction } from '../lib/hooks'
import { useToast } from '../lib/toast'
import type { Priority, Project, TaskStatus, User } from '../lib/types'
import { PRIORITIES, TASK_STATUSES } from '../lib/types'
import { Icon } from './icons'
import { Modal, Spinner } from './ui'

export default function TaskCreateDialog({
  projects,
  users,
  defaultProjectId,
  onClose,
  onCreated,
}: {
  projects: Project[]
  users: User[]
  defaultProjectId?: string
  onClose: () => void
  onCreated: () => void
}) {
  const { push } = useToast()
  const { run, busy, error } = useAction()
  const initialProject = defaultProjectId || (projects.length === 1 ? projects[0].id : '')
  const [form, setForm] = useState({
    project_id: initialProject,
    title: '',
    description: '',
    assignee_id: '',
    priority: 'medium' as Priority,
    status: 'todo' as TaskStatus,
    due_date: '',
  })

  async function create() {
    const created = await run(() =>
      api.post('/tasks', {
        project_id: form.project_id,
        title: form.title,
        description: form.description || null,
        assignee_id: form.assignee_id || null,
        priority: form.priority,
        status: form.status,
        due_date: form.due_date || null,
      }),
    )
    if (created !== undefined) {
      push('Task created.')
      onCreated()
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New task"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={create}
            disabled={busy || !form.title.trim() || !form.project_id}
          >
            {busy ? <Spinner /> : <Icon name="plus" />} Create task
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {projects.length === 0 && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Create a project first from Work → Filters → Manage projects.
          </p>
        )}
        <div>
          <label className="label" htmlFor="new-task-title">Title</label>
          <input
            id="new-task-title"
            className="input text-base"
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            autoFocus
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="new-task-project">Project</label>
            <select
              id="new-task-project"
              className="select"
              value={form.project_id}
              onChange={(event) => setForm({ ...form, project_id: event.target.value })}
            >
              <option value="">Select a project…</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="new-task-owner">Owner</label>
            <select
              id="new-task-owner"
              className="select"
              value={form.assignee_id}
              onChange={(event) => setForm({ ...form, assignee_id: event.target.value })}
            >
              <option value="">Unassigned</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.full_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="new-task-status">Status</label>
            <select
              id="new-task-status"
              className="select"
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value as TaskStatus })}
            >
              {TASK_STATUSES.filter((status) => status.value !== 'done').map((status) => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="new-task-due">Due date</label>
            <input
              id="new-task-due"
              type="date"
              className="input"
              value={form.due_date}
              onChange={(event) => setForm({ ...form, due_date: event.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="new-task-priority">Priority</label>
            <select
              id="new-task-priority"
              className="select"
              value={form.priority}
              onChange={(event) => setForm({ ...form, priority: event.target.value as Priority })}
            >
              {PRIORITIES.map((priority) => (
                <option key={priority.value} value={priority.value}>{priority.label}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="new-task-description">Description</label>
            <textarea
              id="new-task-description"
              className="textarea"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </div>
        </div>
      </div>
    </Modal>
  )
}
