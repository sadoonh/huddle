import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import { formatDateTime } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useToast } from '../lib/toast'
import { useAuth } from '../lib/auth'
import {
  PRIORITIES,
  TASK_STATUS_OPTIONS,
  type Priority,
  type Task,
  type TaskDetail,
  type TaskStatus,
  type TaskUpdate,
  type User,
} from '../lib/types'
import { AsyncActionButton, Avatar, Modal, Spinner } from './ui'
import MorphSelect from './MorphSelect'
import { displayStatus, priorityTextClass, statusTextClass } from '../lib/taskDisplay'

/**
 * The single centered task view: update history plus a composer and the three
 * task fields that usually change during review (status, owner, priority).
 */
export default function TaskDialog({
  taskId,
  onClose,
  onChanged,
}: {
  taskId: string
  onClose: () => void
  onChanged?: () => void
}) {
  const { push } = useToast()
  const { isManager, me } = useAuth()
  const confirm = useConfirm()
  const detail = useAsync<TaskDetail>(() => api.get(`/tasks/${taskId}`), [taskId])
  const users = useAsync<User[]>(
    () => (isManager ? api.get('/users') : Promise.resolve([])),
    [isManager],
  )
  const [text, setText] = useState('')
  const [blockedBy, setBlockedBy] = useState('')
  const [status, setStatus] = useState<TaskStatus | null>(null)
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [priority, setPriority] = useState<Priority | null>(null)
  const [version, setVersion] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [historyEdit, setHistoryEdit] = useState<{
    id: string
    draft: string
    expectedVersion: number
  } | null>(null)
  const [historyBusyId, setHistoryBusyId] = useState<string | null>(null)
  const historyMutationRef = useRef(false)
  const [historyFeedback, setHistoryFeedback] = useState<{
    id: string
    message: string
    tone: 'error' | 'info'
    refreshable: boolean
  } | null>(null)
  const [historyRetryVersion, setHistoryRetryVersion] = useState<{
    id: string
    version: number
  } | null>(null)

  useEffect(() => {
    if (!detail.data) return
    setStatus((current) => current ?? displayStatus(detail.data!.status))
    setOwnerId((current) => current ?? detail.data!.assignee?.id ?? '')
    setPriority((current) => current ?? detail.data!.priority)
    setVersion((current) => current ?? detail.data!.version)
  }, [detail.data])

  // Initialise the task-level Blocked by field once per task. Background
  // refreshes must not overwrite what the user is typing.
  useEffect(() => {
    if (detail.data) setBlockedBy(detail.data.blocked_by ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data?.id])

  const updates = useMemo(
    () =>
      [...(detail.data?.updates ?? [])].sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      ),
    [detail.data?.updates],
  )

  const data = detail.data
  const hasText = Boolean(text.trim())
  const statusChanged = Boolean(data && status && status !== displayStatus(data.status))
  const blockedByChanged = Boolean(
    data && blockedBy.trim() !== (data.blocked_by ?? '').trim(),
  )
  const currentOwnerId = ownerId ?? data?.assignee?.id ?? ''
  const currentPriority = priority ?? data?.priority ?? 'medium'
  const ownerChanged = Boolean(
    data && ownerId !== null && ownerId !== (data.assignee?.id ?? ''),
  )
  const priorityChanged = Boolean(data && priority !== null && priority !== data.priority)
  const dirty = hasText || statusChanged || blockedByChanged || ownerChanged || priorityChanged
  const mutationBusy = saving || historyBusyId !== null

  const ownerOptions = useMemo(() => {
    const options = [
      { value: '', label: 'Unassigned', unassigned: true },
      ...(users.data ?? []).map((user) => ({ value: user.id, label: user.full_name })),
    ]
    if (data?.assignee && !options.some((option) => option.value === data.assignee?.id)) {
      options.push({ value: data.assignee.id, label: data.assignee.full_name })
    }
    return options
  }, [data?.assignee, users.data])

  async function save() {
    if (
      !detail.data ||
      saving ||
      historyBusyId !== null ||
      historyMutationRef.current ||
      historyEdit !== null ||
      !dirty
    )
      return
    setSaving(true)
    setError(null)
    setInfo(null)
    setConflict(false)
    const nextBlockedBy = blockedBy.trim() || null
    let baseVersion = version ?? detail.data.version
    let statusHandledByTaskPatch = false
    try {
      // Reassigning, reprioritising and blocking are Task fields. Bundle them
      // into one version-checked patch; a status-only change joins that patch.
      const patch: Record<string, unknown> = { expected_version: baseVersion }
      if (blockedByChanged) patch.blocked_by = nextBlockedBy
      if (ownerChanged) patch.assignee_id = currentOwnerId || null
      if (priorityChanged) patch.priority = currentPriority
      if (statusChanged && status && !hasText) {
        patch.status = status
        statusHandledByTaskPatch = true
      }
      if (Object.keys(patch).length > 1) {
        const updated = await api.patch<Task>(`/tasks/${taskId}`, patch)
        baseVersion = updated.version
        setVersion(updated.version)
        setBlockedBy(updated.blocked_by ?? '')
        setStatus(displayStatus(updated.status))
        setOwnerId(updated.assignee?.id ?? '')
        setPriority(updated.priority)
      }

      if (hasText) {
        // A new progress record can carry the optional status change
        // atomically. Other task fields were already applied above.
        await api.post(`/tasks/${taskId}/updates`, {
          progress: text.trim(),
          ...(statusChanged && status && !statusHandledByTaskPatch ? { status } : {}),
          expected_version: baseVersion,
          client_operation_id: crypto.randomUUID(),
        })
        push('Update saved.')
      } else if (statusChanged && status && !statusHandledByTaskPatch) {
        await api.patch(`/tasks/${taskId}`, {
          status,
          expected_version: baseVersion,
        })
        push('Task changes saved.')
      } else {
        push('Task changes saved.')
      }
      setText('')
      setVersion(null)
      detail.refresh()
      onChanged?.()
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.status === 409) {
          setConflict(true)
          setError('This task changed since you opened it. Load the latest state, review your changes, then save again.')
        } else {
          setError(caught.message)
        }
      } else {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
      throw caught
    } finally {
      setSaving(false)
    }
  }

  const knownTaskVersion = () =>
    Math.max(detail.data?.version ?? 0, version ?? 0)

  function reconcileOwnVersion(expectedVersion: number) {
    // A successful history mutation with expectedVersion proves the task was at
    // exactly that version, so only *our* bump can move the composer base.
    setVersion((current) =>
      current === null || current === expectedVersion ? expectedVersion + 1 : current,
    )
    setHistoryEdit((current) =>
      current && current.expectedVersion === expectedVersion
        ? { ...current, expectedVersion: expectedVersion + 1 }
        : current,
    )
  }

  function historyEditDirty(): boolean {
    if (!historyEdit) return false
    const original = updates.find((item) => item.id === historyEdit.id)?.progress ?? ''
    return historyEdit.draft.trim() !== original.trim()
  }

  async function canLeaveHistory(): Promise<boolean> {
    if (!historyEdit || !historyEditDirty()) return true
    return confirm({
      title: 'Discard update changes?',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      tone: 'danger',
    })
  }

  async function startHistoryEdit(update: TaskUpdate) {
    if (mutationBusy) return
    if (!(await canLeaveHistory())) return
    setHistoryFeedback(null)
    setHistoryEdit({
      id: update.id,
      draft: update.progress,
      expectedVersion: Math.max(
        knownTaskVersion(),
        historyRetryVersion?.id === update.id ? historyRetryVersion.version : 0,
      ),
    })
    setHistoryRetryVersion(null)
  }

  async function cancelHistoryEdit() {
    if (mutationBusy) return
    if (!(await canLeaveHistory())) return
    setHistoryEdit(null)
    setHistoryFeedback(null)
  }

  async function requestClose() {
    if (mutationBusy || historyMutationRef.current) {
      push('A save is in progress. Wait for it to finish.', 'info')
      return
    }
    if (historyEditDirty() || dirty) {
      const discard = await confirm({
        title: 'Discard your changes?',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        tone: 'danger',
      })
      if (!discard) return
    }
    onClose()
  }

  function historyError(caught: unknown, updateId: string) {
    if (caught instanceof ApiError) {
      if (caught.status === 409) {
        setHistoryFeedback({
          id: updateId,
          message:
            'This task changed while you were editing this update. Refresh the latest state, review your text, then retry.',
          tone: 'error',
          refreshable: true,
        })
        return
      }
      if (caught.status === 404) {
        setHistoryFeedback({
          id: updateId,
          message: 'This update no longer exists. Refresh the latest history to continue.',
          tone: 'error',
          refreshable: true,
        })
        return
      }
      setHistoryFeedback({ id: updateId, message: caught.message, tone: 'error', refreshable: false })
      return
    }
    setHistoryFeedback({
      id: updateId,
      message: caught instanceof Error ? caught.message : String(caught),
      tone: 'error',
      refreshable: false,
    })
  }

  async function refreshHistory(updateId: string) {
    try {
      const latest = await api.get<TaskDetail>(`/tasks/${taskId}`)
      const stillExists = latest.updates.some((item) => item.id === updateId)
      setHistoryEdit((current) =>
        current?.id === updateId
          ? { ...current, expectedVersion: latest.version }
          : current,
      )
      detail.refresh()
      if (!stillExists) {
        setHistoryEdit((current) => (current?.id === updateId ? null : current))
        setHistoryFeedback(null)
        setHistoryRetryVersion(null)
        setInfo('That update no longer exists. The latest history is shown.')
        return
      }
      setHistoryRetryVersion({ id: updateId, version: latest.version })
      setHistoryFeedback({
        id: updateId,
        message: 'Latest state loaded. Review your text and retry.',
        tone: 'info',
        refreshable: false,
      })
    } catch (caught) {
      historyError(caught, updateId)
    }
  }

  async function saveHistoryEdit() {
    if (!historyEdit || mutationBusy || historyMutationRef.current) return
    const progress = historyEdit.draft.trim()
    if (!progress) return
    const edit = historyEdit
    historyMutationRef.current = true
    setHistoryBusyId(edit.id)
    setHistoryFeedback(null)
    try {
      await api.patch(`/tasks/${taskId}/updates/${edit.id}`, {
        progress,
        expected_version: edit.expectedVersion,
      })
      reconcileOwnVersion(edit.expectedVersion)
      setHistoryEdit(null)
      setHistoryRetryVersion(null)
      setInfo(null)
      push('Update changed.')
      detail.refresh()
      onChanged?.()
    } catch (caught) {
      historyError(caught, edit.id)
    } finally {
      historyMutationRef.current = false
      setHistoryBusyId(null)
    }
  }

  async function deleteHistoryUpdate(updateId: string) {
    if (mutationBusy || historyMutationRef.current) return
    const confirmed = await confirm({
      title: 'Delete this update?',
      confirmLabel: 'Delete update',
      cancelLabel: 'Cancel',
      tone: 'danger',
    })
    if (!confirmed) return
    const expectedVersion =
      historyEdit?.id === updateId
        ? historyEdit.expectedVersion
        : historyRetryVersion?.id === updateId
          ? historyRetryVersion.version
          : knownTaskVersion()
    historyMutationRef.current = true
    setHistoryBusyId(updateId)
    setHistoryFeedback(null)
    try {
      const suffix = expectedVersion ? `?expected_version=${expectedVersion}` : ''
      await api.delete(`/tasks/${taskId}/updates/${updateId}${suffix}`)
      reconcileOwnVersion(expectedVersion)
      setHistoryEdit((current) => (current?.id === updateId ? null : current))
      setHistoryRetryVersion(null)
      push('Update deleted.')
      detail.refresh()
      onChanged?.()
    } catch (caught) {
      historyError(caught, updateId)
    } finally {
      historyMutationRef.current = false
      setHistoryBusyId(null)
    }
  }

  async function loadLatest() {
    try {
      const previous = detail.data
      const latest = await api.get<TaskDetail>(`/tasks/${taskId}`)
      setVersion(latest.version)
      // Preserve deliberate edits; refresh only untouched fields.
      setStatus((current) =>
        current && previous && current !== displayStatus(previous.status)
          ? current
          : displayStatus(latest.status),
      )
      setBlockedBy((current) =>
        previous && current.trim() !== (previous.blocked_by ?? '').trim()
          ? current
          : latest.blocked_by ?? '',
      )
      setOwnerId((current) =>
        previous && current !== null && current !== (previous.assignee?.id ?? '')
          ? current
          : latest.assignee?.id ?? '',
      )
      setPriority((current) =>
        previous && current !== null && current !== previous.priority
          ? current
          : latest.priority,
      )
      setConflict(false)
      setError(null)
      setInfo('Latest state loaded. Review your changes, then save again.')
      detail.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <Modal
      open
      onClose={() => void requestClose()}
      title={data ? `${data.public_id} · ${data.title}` : 'Task updates'}
      wide
      footer={
        <button type="button" className="btn btn-secondary" onClick={() => void requestClose()}>
          Close
        </button>
      }
    >
      {detail.loading && !data ? (
        <div className="py-8 text-center text-sm text-ink-muted">
          <Spinner className="h-5 w-5" /> Loading updates…
        </div>
      ) : detail.error || !data ? (
        <p className="rounded-control bg-danger-tint px-3 py-2 text-sm text-danger">
          {detail.error ?? 'Task not found'}
        </p>
      ) : (
        <div className="space-y-4">
          <section>
            <h3 className="text-sm font-semibold text-ink">Updates</h3>
            {updates.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">No updates yet.</p>
            ) : (
              <ol className="mt-2 space-y-2">
                {updates.map((update) => {
                  const person = update.attributed_to ?? update.author
                  const canModify =
                    isManager || Boolean(me?.id && update.author?.id === me.id)
                  const isEditing = historyEdit?.id === update.id
                  const isBusy = historyBusyId === update.id
                  const feedback = historyFeedback?.id === update.id ? historyFeedback : null
                  return (
                    <li
                      key={update.id}
                      aria-busy={isBusy || undefined}
                      className="relative rounded-control border border-hairline bg-recessed/40 px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2">
                        {person ? <Avatar name={person.full_name} size="sm" /> : null}
                        <span className="text-sm font-medium text-ink">
                          {person?.full_name ?? 'Unknown'}
                        </span>
                        <span className="ml-auto text-xs text-ink-subtle">
                          {formatDateTime(update.created_at)}
                        </span>
                      </div>

                      {isEditing ? (
                        <div className="mt-2 space-y-2">
                          <label className="label" htmlFor={`edit-update-${update.id}`}>
                            Edit update text
                          </label>
                          <textarea
                            id={`edit-update-${update.id}`}
                            className="textarea"
                            value={historyEdit.draft}
                            autoFocus
                            disabled={mutationBusy}
                            onChange={(event) =>
                              setHistoryEdit((current) =>
                                current?.id === update.id
                                  ? { ...current, draft: event.target.value }
                                  : current,
                              )
                            }
                          />
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => void cancelHistoryEdit()}
                              disabled={mutationBusy}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => void saveHistoryEdit()}
                              disabled={mutationBusy || !historyEdit.draft.trim()}
                            >
                              {isBusy ? <Spinner className="h-3 w-3" /> : null} Save changes
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="mt-1.5 pr-24">
                            <p className="whitespace-pre-wrap text-sm text-ink">{update.progress}</p>
                            {update.next_steps && (
                              <p className="mt-1 text-xs text-ink-muted">Next: {update.next_steps}</p>
                            )}
                          </div>
                          {canModify && (
                            <div className="absolute bottom-2 right-2 flex items-center gap-0.5 rounded-md border border-hairline bg-raised/95 p-0.5 shadow-card backdrop-blur-[2px]">
                              <button
                                type="button"
                                className="rounded px-1.5 py-1 text-[10.5px] font-medium text-ink-subtle transition-colors duration-140 hover:bg-recessed hover:text-ink disabled:opacity-50"
                                onClick={() => void startHistoryEdit(update)}
                                disabled={mutationBusy}
                                aria-label={`Edit update from ${formatDateTime(update.created_at)}`}
                              >
                                Edit
                              </button>
                              <span aria-hidden="true" className="h-3 w-px bg-hairline" />
                              <button
                                type="button"
                                className="rounded px-1.5 py-1 text-[10.5px] font-medium text-ink-subtle transition-colors duration-140 hover:bg-danger-tint hover:text-danger disabled:opacity-50"
                                onClick={() => void deleteHistoryUpdate(update.id)}
                                disabled={mutationBusy}
                                aria-label={`Delete update from ${formatDateTime(update.created_at)}`}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </>
                      )}

                      {feedback && (
                        <div
                          className={`mt-2 rounded-control px-2.5 py-2 pr-20 text-xs ${
                            feedback.tone === 'error'
                              ? 'bg-danger-tint text-danger'
                              : 'bg-info-tint text-info'
                          }`}
                        >
                          <p>{feedback.message}</p>
                          {feedback.refreshable && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm mt-1.5"
                              onClick={() => void refreshHistory(update.id)}
                            >
                              Refresh latest
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </section>

          <section className="border-t border-hairline pt-3">
            <div className="space-y-2">
              <div>
                <label className="label" htmlFor="task-update-text">Add update <span className="text-danger">*</span></label>
                <textarea
                  id="task-update-text"
                  data-autofocus
                  className="textarea"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className="label" htmlFor="task-update-blocked">Blocked by (optional)</label>
                <input
                  id="task-update-blocked"
                  className="input"
                  value={blockedBy}
                  onChange={(event) => setBlockedBy(event.target.value)}
                  placeholder="Leave empty when nothing is blocking this task."
                />
              </div>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-[150px]">
                    <span className="mb-1 block text-sm font-medium text-ink-muted">Status</span>
                    <MorphSelect
                      valueClassName={statusTextClass(status ?? data.status)}
                      value={status ?? displayStatus(data.status)}
                      options={TASK_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                      onChange={(value) => setStatus(value as TaskStatus)}
                      label="Update status"
                    />
                  </div>
                  <div className="w-[190px]">
                    <span className="mb-1 block text-sm font-medium text-ink-muted">Owner</span>
                    {isManager ? (
                      <MorphSelect
                        value={currentOwnerId}
                        options={ownerOptions}
                        onChange={setOwnerId}
                        label="Update owner"
                        avatar
                        searchable={(users.data?.length ?? 0) > 8}
                        searchPlaceholder="Search people…"
                        disabled={saving}
                      />
                    ) : (
                      <div className="flex min-h-[40px] items-center gap-2 rounded-control border border-hairline bg-recessed px-3 text-sm text-ink-muted">
                        {data.assignee ? <Avatar name={data.assignee.full_name} size="sm" /> : null}
                        <span className="truncate">{data.assignee?.full_name ?? 'Unassigned'}</span>
                      </div>
                    )}
                  </div>
                  <div className="w-[140px]">
                    <span className="mb-1 block text-sm font-medium text-ink-muted">Priority</span>
                    <MorphSelect
                      valueClassName={priorityTextClass(currentPriority)}
                      value={currentPriority}
                      options={PRIORITIES.map((option) => ({ value: option.value, label: option.label }))}
                      onChange={(value) => setPriority(value as Priority)}
                      label="Update priority"
                      disabled={saving}
                    />
                  </div>
                </div>
                <AsyncActionButton
                  label="Save update"
                  pendingLabel="Saving…"
                  successLabel="Saved"
                  onAction={save}
                  onError={(message) => setError(message)}
                  disabled={mutationBusy || !dirty || historyEdit !== null}
                />
              </div>
            </div>
          </section>

          {error && (
            <div className="rounded-control bg-danger-tint px-3 py-2 text-sm text-danger">
              <p>{error}</p>
              {conflict && (
                <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={loadLatest}>
                  Load latest state
                </button>
              )}
            </div>
          )}
          {info && (
            <p className="rounded-control bg-info-tint px-3 py-2 text-sm text-info">{info}</p>
          )}
        </div>
      )}
    </Modal>
  )
}
