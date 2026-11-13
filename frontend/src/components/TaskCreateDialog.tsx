import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useAction } from '../lib/hooks'
import { useConfirm } from '../lib/confirm'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import type { Priority, Project, TaskStatus, User } from '../lib/types'
import { PRIORITIES, TASK_STATUSES } from '../lib/types'
import { Icon } from './icons'
import { ErrorBox, Loading, Modal, Spinner } from './ui'

export default function TaskCreateDialog({
  projects,
  users,
  projectsLoading = false,
  projectsError = null,
  onRetryOptions,
  defaultProjectId,
  onClose,
  onCreated,
}: {
  projects: Project[]
  users: User[]
  projectsLoading?: boolean
  projectsError?: string | null
  onRetryOptions?: () => void
  defaultProjectId?: string
  onClose: () => void
  onCreated: () => void
}) {
  const { me, isManager } = useAuth()
  const { push } = useToast()
  const confirm = useConfirm()
  const { run, busy, error } = useAction()
  const [projectOptions, setProjectOptions] = useState(projects)
  const initialProject = defaultProjectId || (projects.length === 1 ? projects[0].id : '')
  const [form, setForm] = useState({
    project_id: initialProject,
    title: '',
    description: '',
    assignee_id: isManager ? '' : me?.id ?? '',
    priority: 'medium' as Priority,
    status: 'todo' as TaskStatus,
    due_date: '',
  })
  const [showDetails, setShowDetails] = useState(false)
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectError, setProjectError] = useState<string | null>(null)
  const [creatingProject, setCreatingProject] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [operationId] = useState(() => crypto.randomUUID())
  const initialOwner = isManager ? '' : me?.id ?? ''
  const [initial] = useState({
    projectId: initialProject,
    ownerId: initialOwner,
    status: 'todo' as TaskStatus,
    priority: 'medium' as Priority,
  })
  const dirty =
    Boolean(form.title.trim() || form.description.trim() || form.due_date) ||
    form.project_id !== initial.projectId ||
    form.assignee_id !== initial.ownerId ||
    form.status !== initial.status ||
    form.priority !== initial.priority

  const effectiveProjects = useMemo(
    () => (projectOptions.length > 0 ? projectOptions : projects),
    [projectOptions, projects],
  )

  async function requestClose() {
    if (busy || creatingProject) {
      push('A save is in progress. Wait for it to finish.', 'info')
      return
    }
    if (dirty) {
      const discard = await confirm({
        title: 'Discard this draft task?',
        description: 'Its fields have not been saved.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        tone: 'danger',
      })
      if (!discard) return
    }
    onClose()
  }

  async function createProject() {
    if (!projectName.trim()) return
    setCreatingProject(true)
    setProjectError(null)
    try {
      const project = await api.post<Project>('/projects', {
        name: projectName.trim(),
        owner_id: me?.id ?? null,
      })
      setProjectOptions((current) => [...current, project])
      setForm((current) => ({ ...current, project_id: project.id }))
      setProjectName('')
      setShowCreateProject(false)
      push('Project created.')
    } catch (caught) {
      setProjectError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setCreatingProject(false)
    }
  }

  async function create() {
    const errors: Record<string, string> = {}
    if (!form.title.trim()) errors.title = 'Title is required.'
    if (!form.project_id) errors.project = 'Choose a project.'
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return
    const created = await run(() =>
      api.post('/tasks', {
        project_id: form.project_id,
        title: form.title.trim(),
        description: form.description || null,
        assignee_id: form.assignee_id || null,
        priority: form.priority,
        status: form.status,
        due_date: form.due_date || null,
        client_operation_id: operationId,
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
      onClose={requestClose}
      title="New task"
      description="A short form. Add details only when they matter."
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={requestClose}>Cancel</button>
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
      {projectsLoading ? (
        <Loading label="Loading projects…" />
      ) : projectsError ? (
        <ErrorBox message={projectsError} onRetry={onRetryOptions} />
      ) : (
        <div className="space-y-3">
          {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <div>
            <label className="label" htmlFor="new-task-title">Title</label>
            <input
              id="new-task-title"
              className="input text-base"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              autoFocus
            />
            {fieldErrors.title && <p className="mt-1 text-sm text-rose-700">{fieldErrors.title}</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="new-task-project">Project</label>
              {effectiveProjects.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                  <p>No projects are available to you.</p>
                  {isManager ? (
                    <>
                      {!showCreateProject ? (
                        <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => setShowCreateProject(true)}>
                          <Icon name="plus" /> Create project
                        </button>
                      ) : (
                        <div className="mt-2 space-y-2">
                          <input
                            className="input"
                            placeholder="Project name"
                            value={projectName}
                            onChange={(event) => setProjectName(event.target.value)}
                          />
                          {projectError && <p className="text-sm text-rose-700">{projectError}</p>}
                          <div className="flex gap-2">
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCreateProject(false)}>
                              Cancel
                            </button>
                            <button type="button" className="btn btn-primary btn-sm" onClick={createProject} disabled={creatingProject || !projectName.trim()}>
                              {creatingProject ? <Spinner /> : null} Create project
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">Ask a manager to create a project and add you to it.</p>
                  )}
                </div>
              ) : (
                <select
                  id="new-task-project"
                  className="select"
                  value={form.project_id}
                  onChange={(event) => setForm({ ...form, project_id: event.target.value })}
                >
                  <option value="">Select a project…</option>
                  {effectiveProjects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              )}
              {fieldErrors.project && <p className="mt-1 text-sm text-rose-700">{fieldErrors.project}</p>}
              {isManager && effectiveProjects.length > 0 && !showCreateProject && (
                <button type="button" className="mt-1 text-sm font-medium text-emerald-700 hover:underline" onClick={() => setShowCreateProject(true)}>
                  Create another project
                </button>
              )}
              {showCreateProject && effectiveProjects.length > 0 && (
                <div className="mt-2 space-y-2 rounded-lg border border-slate-200 p-2">
                  <input className="input" placeholder="Project name" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
                  {projectError && <p className="text-sm text-rose-700">{projectError}</p>}
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCreateProject(false)}>Cancel</button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={createProject} disabled={creatingProject || !projectName.trim()}>
                      {creatingProject ? <Spinner /> : null} Create
                    </button>
                  </div>
                </div>
              )}
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
          </div>

          {showDetails ? (
            <div className="space-y-3 border-t border-slate-100 pt-3">
              <div>
                <label className="label" htmlFor="new-task-description">Description</label>
                <textarea
                  id="new-task-description"
                  className="textarea"
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label" htmlFor="new-task-due">Due date</label>
                  <input id="new-task-due" type="date" className="input" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="new-task-priority">Priority</label>
                  <select id="new-task-priority" className="select" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as Priority })}>
                    {PRIORITIES.map((priority) => (
                      <option key={priority.value} value={priority.value}>{priority.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="new-task-status">Status</label>
                  <select id="new-task-status" className="select" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as TaskStatus })}>
                    {TASK_STATUSES.filter((status) => status.value !== 'done').map((status) => (
                      <option key={status.value} value={status.value}>{status.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowDetails(true)}>
              <Icon name="plus" /> Add details (description, due date, priority, status)
            </button>
          )}
        </div>
      )}
    </Modal>
  )
}
