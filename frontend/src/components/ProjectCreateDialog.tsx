import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { humanize } from '../lib/format'
import type { Project, User } from '../lib/types'
import { Icon } from './icons'
import MorphSelect from './MorphSelect'
import { Modal, Spinner } from './ui'

/** Lightweight project creation used from the Tasks toolbar. */
export default function ProjectCreateDialog({
  users,
  onClose,
  onCreated,
}: {
  users: User[]
  onClose: () => void
  onCreated: (project: Project) => void
}) {
  const { me } = useAuth()
  const [name, setName] = useState('')
  const [ownerId, setOwnerId] = useState(me?.id ?? '')
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ownerOptions = useMemo(
    () => [
      { value: '', label: 'Unassigned' },
      ...users.map((user) => ({ value: user.id, label: user.full_name })),
    ],
    [users],
  )

  function toggleMember(id: string) {
    setMemberIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    )
  }

  async function create() {
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const project = await api.post<Project>('/projects', {
        name: name.trim(),
        owner_id: ownerId || null,
        member_ids: memberIds,
      })
      onCreated(project)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New project"
      description="Group related tasks. You can filter Tasks by this project afterwards."
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void create()}
            disabled={saving || !name.trim()}
          >
            {saving ? <Spinner /> : <Icon name="plus" />} Create project
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && (
          <p className="rounded-control bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>
        )}
        <div>
          <label className="label" htmlFor="new-project-name">
            Name <span className="text-danger">*</span>
          </label>
          <input
            id="new-project-name"
            data-autofocus
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </div>
        <div>
          <span className="label">Owner</span>
          <MorphSelect
            value={ownerId}
            options={ownerOptions}
            onChange={setOwnerId}
            label="Project owner"
            searchable
            searchPlaceholder="Search people…"
            avatar
          />
        </div>
        <div>
          <span className="label">Members</span>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-control border border-hairline p-2">
            {users.map((user) => (
              <label
                key={user.id}
                className="flex items-center gap-2 rounded px-1.5 py-1 text-sm text-ink hover:bg-recessed"
              >
                <input
                  type="checkbox"
                  checked={memberIds.includes(user.id)}
                  onChange={() => toggleMember(user.id)}
                  className="h-4 w-4 rounded border-hairline"
                />
                {user.full_name}
                <span className="text-xs text-ink-subtle">{humanize(user.role)}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
