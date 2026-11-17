import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import type { Priority, Project, Task, TaskStatus, User } from '../lib/types'
import { PRIORITIES } from '../lib/types'
import { Icon } from './icons'
import MorphSelect from './MorphSelect'
import { AsyncActionButton, ErrorBox, Loading, Modal, Spinner } from './ui'

export default function TaskCreateDialog({
  projects,
  users,
  projectsLoading = false,
  projectsError = null,
  onRetryOptions,
  defaultProjectId,
  defaultStatus = 'todo',
  onClose,
  onCreated,
}: {
  projects: Project[]
  users: User[]
  projectsLoading?: boolean
  projectsError?: string | null
  onRetryOptions?: () => void
  defaultProjectId?: string
  /** Lane-specific initial status. Global New task defaults to To do. */
  defaultStatus?: TaskStatus
  onClose: () => void
  onCreated: (task: Task) => void
}) {
  const { me, isManager } = useAuth()
  const { push } = useToast()
  const confirm = useConfirm()
  const [projectOptions, setProjectOptions] = useState(projects)
  const initialProject =
    defaultProjectId ||
    projects.find((project) => project.system_key === 'ad_hoc')?.id ||
    (projects.length === 1 ? projects[0].id : '')
  const [form, setForm] = useState({
    project_id: initialProject,
    title: '',
    description: '',
    blocked_by: '',
    assignee_id: isManager ? '' : me?.id ?? '',
    priority: 'medium' as Priority,
    status: defaultStatus,
  })
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectError, setProjectError] = useState<string | null>(null)
  const [creatingProject, setCreatingProject] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const [operationId] = useState(() => crypto.randomUUID())
  const initialOwner = isManager ? '' : me?.id ?? ''
  const [initial, setInitial] = useState({
    projectId: initialProject,
    ownerId: initialOwner,
    status: defaultStatus,
    priority: 'medium' as Priority,
  })
  const dirty =
    Boolean(form.title.trim() || form.description.trim() || form.blocked_by.trim()) ||
    form.project_id !== initial.projectId ||
    form.assignee_id !== initial.ownerId ||
    form.status !== initial.status ||
    form.priority !== initial.priority

  const effectiveProjects = useMemo(
    () => (projectOptions.length > 0 ? projectOptions : projects),
    [projectOptions, projects],
  )

  // Projects can finish loading after the dialog opens (global New task).
  useEffect(() => {
    if (form.project_id) return
    const fallback =
      defaultProjectId ||
      effectiveProjects.find((project) => project.system_key === 'ad_hoc')?.id ||
      (effectiveProjects.length === 1 ? effectiveProjects[0].id : '')
    if (fallback) {
      setForm((current) => (current.project_id ? current : { ...current, project_id: fallback }))
      setInitial((current) => ({ ...current, projectId: fallback }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultProjectId, effectiveProjects.length])

  const projectChoices = useMemo(
    () => effectiveProjects.map((project) => ({ value: project.id, label: project.name })),
    [effectiveProjects],
  )

  const ownerChoices = useMemo(
    () => [
      { value: '', label: 'Unassigned' },
      ...users.map((user) => ({ value: user.id, label: user.full_name })),
    ],
    [users],
  )

  async function requestClose() {
    if (creatingProject) {
      push('A save is in progress. Wait for it to finish.', 'info')
      return
    }
    if (dirty) {
      const discard = await confirm({
        title: 'Discard this draft task?',
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

  async function createTask(): Promise<void> {
    const errors: Record<string, string> = {}
    if (!form.title.trim()) errors.title = 'Title is required.'
    if (!form.project_id) errors.project = 'Choose a project.'
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      throw new Error(errors.title ?? errors.project)
    }
    const task = await api.post<Task>('/tasks', {
      project_id: form.project_id,
      title: form.title.trim(),
      description: form.description || null,
      blocked_by: form.blocked_by.trim() || null,
      assignee_id: form.assignee_id || null,
      priority: form.priority,
      status: form.status,
      client_operation_id: operationId,
    })
    onCreated(task)
  }

  return (
    <Modal
      open
      onClose={requestClose}
      title="New task"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={requestClose}>
            Cancel
          </button>
          <AsyncActionButton
            label="Create task"
            pendingLabel="Creating…"
            successLabel="Created"
            icon="plus"
            onAction={createTask}
            onError={(message) => setActionError(message)}
            disabled={!form.title.trim() || !form.project_id || creatingProject}
          />
        </>
      }
    >
      {projectsLoading ? (
        <Loading label="Loading projects…" />
      ) : projectsError ? (
        <ErrorBox message={projectsError} onRetry={onRetryOptions} />
      ) : (
        <div className="space-y-3">
          {actionError && (
            <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">
              {actionError}
            </p>
          )}
          <div>
            <label className="label" htmlFor="new-task-title">
              Title <span className="text-danger">*</span>
            </label>
            <input
              id="new-task-title"
              data-autofocus
              className="input text-base"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              autoFocus
            />
            {fieldErrors.title && <p className="mt-1 text-sm text-danger">{fieldErrors.title}</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="label" id="new-task-project-label">
                Project <span className="text-danger">*</span>
              </span>
              {effectiveProjects.length === 0 ? (
                <div className="rounded-control border border-hairline bg-recessed p-3 text-sm text-ink-muted">
                  <p>No projects are available to you.</p>
                  {isManager ? (
                    <>
                      {!showCreateProject ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm mt-2"
                          onClick={() => setShowCreateProject(true)}
                        >
                          <Icon name="plus" /> Create project
                        </button>
                      ) : (
                        <div className="mt-2 space-y-2">
                          <label className="label" htmlFor="new-task-project-name">
                            Project name <span className="text-danger">*</span>
                          </label>
                          <input
                            id="new-task-project-name"
                            className="input"
                            placeholder="Project name"
                            value={projectName}
                            onChange={(event) => setProjectName(event.target.value)}
                          />
                          {projectError && <p className="text-sm text-danger">{projectError}</p>}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => setShowCreateProject(false)}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={createProject}
                              disabled={creatingProject || !projectName.trim()}
                            >
                              {creatingProject ? <Spinner /> : null} Create project
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-ink-subtle">Ask a manager to create a project and add you to it.</p>
                  )}
                </div>
              ) : (
                <MorphSelect
                  value={form.project_id}
                  options={projectChoices}
                  onChange={(value) => setForm({ ...form, project_id: value })}
                  label="Project"
                  placeholder="Select a project…"
                  searchable
                  searchPlaceholder="Search projects…"
                />
              )}
              {fieldErrors.project && <p className="mt-1 text-sm text-danger">{fieldErrors.project}</p>}
              {isManager && effectiveProjects.length > 0 && !showCreateProject && (
                <button
                  type="button"
                  className="mt-1 text-sm font-medium text-accent hover:underline"
                  onClick={() => setShowCreateProject(true)}
                >
                  Create new project
                </button>
              )}
              {showCreateProject && effectiveProjects.length > 0 && (
                <div className="mt-2 space-y-2 rounded-control border border-hairline p-2">
                  <label className="label" htmlFor="new-task-project-name">
                    Project name <span className="text-danger">*</span>
                  </label>
                  <input
                    id="new-task-project-name"
                    className="input"
                    placeholder="Project name"
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                  />
                  {projectError && <p className="text-sm text-danger">{projectError}</p>}
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCreateProject(false)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={createProject}
                      disabled={creatingProject || !projectName.trim()}
                    >
                      {creatingProject ? <Spinner /> : null} Create
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div>
              <span className="label" id="new-task-owner-label">
                Owner
              </span>
              <MorphSelect
                value={form.assignee_id}
                options={ownerChoices}
                onChange={(value) => setForm({ ...form, assignee_id: value })}
                label="Owner"
                placeholder="Unassigned"
                searchable
                searchPlaceholder="Search people…"
                avatar
              />
            </div>
          </div>

          <div className="space-y-3 border-t border-hairline pt-3">
              <div>
                <label className="label" htmlFor="new-task-description">
                  Description
                </label>
                <textarea
                  id="new-task-description"
                  className="textarea"
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="new-task-blocked">
                  Blocked by (optional)
                </label>
                <input
                  id="new-task-blocked"
                  className="input"
                  value={form.blocked_by}
                  onChange={(event) => setForm({ ...form, blocked_by: event.target.value })}
                  placeholder="Leave empty when nothing is blocking this task."
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="new-task-priority">
                    Priority
                  </label>
                  <select
                    id="new-task-priority"
                    className="select"
                    value={form.priority}
                    onChange={(event) => setForm({ ...form, priority: event.target.value as Priority })}
                  >
                    {PRIORITIES.map((priority) => (
                      <option key={priority.value} value={priority.value}>
                        {priority.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="new-task-status">
                    Status
                  </label>
                  <select
                    id="new-task-status"
                    className="select"
                    value={form.status}
                    onChange={(event) => setForm({ ...form, status: event.target.value as TaskStatus })}
                  >
                    {(['todo', 'in_progress'] as TaskStatus[]).map((status) => (
                      <option key={status} value={status}>
                        {status === 'in_progress' ? 'In Progress' : 'To Do'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
        </div>
      )}
    </Modal>
  )
}
