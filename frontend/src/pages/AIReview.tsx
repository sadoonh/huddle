import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/icons'
import {
  EmptyState,
  ErrorBox,
  Loading,
  PageHeader,
  Spinner,
} from '../components/ui'
import { api } from '../lib/api'
import { formatDateTime, humanize } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import type {
  Page,
  Proposal,
  Session,
  TaskStatus,
  Transcript,
  TranscriptDetail,
  User,
} from '../lib/types'

const proposalTone: Record<string, string> = {
  pending: 'badge-amber',
  approved: 'badge-sky',
  applied: 'badge-emerald',
  rejected: 'badge-slate',
  failed: 'badge-rose',
}

const operationLabel: Record<string, string> = {
  update_task_status: 'Update status',
  assign_task: 'Reassign task',
  add_progress_update: 'Progress update',
  create_blocker: 'Create blocker',
  resolve_blocker: 'Resolve blocker',
  create_action_item: 'Create follow-up',
  record_decision: 'Record decision',
}

export default function AIReviewPage() {
  const { isManager } = useAuth()
  const { push } = useToast()
  const transcripts = useAsync<Transcript[]>(() => api.get('/ai/transcripts'), [])
  const sessions = useAsync<Page<Session>>(() => api.get('/standups/sessions?limit=30'), [])
  const users = useAsync<User[]>(() => api.get('/users'), [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [sessionId, setSessionId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const detail = useAsync<TranscriptDetail | null>(
    () => (selectedId ? api.get(`/ai/transcripts/${selectedId}`) : Promise.resolve(null)),
    [selectedId],
  )

  useEffect(() => {
    if (selectedId || !transcripts.data?.length) return
    setSelectedId(transcripts.data[0].id)
  }, [transcripts.data, selectedId])

  const proposals = useMemo(() => {
    const items = detail.data?.proposals ?? []
    const order = { pending: 0, approved: 1, failed: 2, applied: 3, rejected: 4 } as Record<string, number>
    return [...items].sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5))
  }, [detail.data])

  async function upload() {
    if (!file) return
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      if (sessionId) form.append('session_id', sessionId)
      const result = await api.upload<TranscriptDetail>('/ai/transcripts', form)
      push(
        result.status === 'processed'
          ? 'Transcript processed. Proposals are waiting for review.'
          : 'Transcript uploaded. Background processing will generate proposals.',
      )
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      transcripts.refresh()
      setSelectedId(result.id)
      detail.refresh()
    } catch (caught) {
      setUploadError((caught as Error).message)
    } finally {
      setUploading(false)
    }
  }

  async function reprocess(id: string) {
    try {
      await api.post(`/ai/transcripts/${id}/reprocess`)
      push('Transcript reprocessed.')
      transcripts.refresh()
      detail.refresh()
    } catch (caught) {
      push((caught as Error).message, 'error')
    }
  }

  if (!isManager) {
    return (
      <EmptyState
        icon="sparkles"
        title="Manager review only"
        description="AI proposals can only be reviewed and applied by a manager or admin."
      />
    )
  }

  return (
    <div>
      <PageHeader
        title="Transcript review"
        subtitle="AI proposes; a human approves. Nothing is written to task records automatically."
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => transcripts.refresh()}>
            <Icon name="refresh" /> Refresh
          </button>
        }
      />

      <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs leading-relaxed text-emerald-800">
        <span className="font-semibold">Human-controlled reconciliation.</span> Proposals are checked for duplicates
        and ambiguous task matches. Applying re-validates that the task has not changed since the proposal was
        generated.
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-4">
          <div className="card p-4">
            <h2 className="text-sm font-semibold">Upload a transcript</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Manual upload for the MVP. Microsoft Graph retrieval comes later.
            </p>
            <div className="mt-3 space-y-2">
              <input
                ref={inputRef}
                type="file"
                accept=".txt,.vtt,.md,text/plain"
                className="block w-full text-xs text-slate-500 file:mr-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <select
                className="select text-xs"
                aria-label="Link to standup session"
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
              >
                <option value="">No linked session</option>
                {(sessions.data?.items ?? []).map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.session_date} · {humanize(session.status)}
                  </option>
                ))}
              </select>
              {uploadError && <p className="text-[11px] text-rose-600">{uploadError}</p>}
              <button
                type="button"
                className="btn btn-primary w-full"
                disabled={!file || uploading}
                onClick={upload}
              >
                {uploading ? <Spinner /> : <Icon name="upload" />} Process transcript
              </button>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold">Transcripts</h2>
              <span className="badge badge-slate">{transcripts.data?.length ?? 0}</span>
            </div>
            {transcripts.loading ? (
              <Loading />
            ) : transcripts.error ? (
              <div className="p-3">
                <ErrorBox message={transcripts.error} onRetry={transcripts.refresh} />
              </div>
            ) : transcripts.data?.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-slate-500">No transcripts uploaded yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {transcripts.data!.map((transcript) => (
                  <button
                    key={transcript.id}
                    type="button"
                    onClick={() => setSelectedId(transcript.id)}
                    className={`block w-full px-4 py-2.5 text-left hover:bg-slate-50 ${
                      selectedId === transcript.id ? 'bg-slate-50' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium text-slate-800">{transcript.filename}</p>
                      <span
                        className={`badge ${
                          transcript.status === 'processed'
                            ? 'badge-emerald'
                            : transcript.status === 'failed'
                              ? 'badge-rose'
                              : 'badge-amber'
                        }`}
                      >
                        {humanize(transcript.status)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {formatDateTime(transcript.created_at)} · {Math.max(1, Math.round(transcript.size_bytes / 1024))} KB
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 xl:col-span-8">
          {detail.loading ? (
            <Loading label="Loading proposals…" />
          ) : detail.error ? (
            <ErrorBox message={detail.error} onRetry={detail.refresh} />
          ) : !detail.data ? (
            <EmptyState
              icon="sparkles"
              title="Select a transcript"
              description="Upload a Teams transcript to generate reviewable proposals."
            />
          ) : (
            <>
              <div className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold">{detail.data.filename}</h2>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {detail.data.proposal_count} proposals · {detail.data.pending_count} pending · processed{' '}
                      {formatDateTime(detail.data.processed_at)}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    {(detail.data.status === 'failed' || detail.data.status === 'uploaded') && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => reprocess(detail.data!.id)}>
                        <Icon name="refresh" /> {detail.data.status === 'uploaded' ? 'Process now' : 'Retry'}
                      </button>
                    )}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={detail.refresh}>
                      <Icon name="refresh" />
                    </button>
                  </div>
                </div>
                {detail.data.error && (
                  <p className="mt-2 rounded-md bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">
                    {detail.data.error}
                  </p>
                )}
              </div>

              {proposals.length === 0 ? (
                <EmptyState
                  icon="sparkles"
                  title="No proposals generated"
                  description="The extractor did not find any task-linked updates. Try a transcript with task titles, blockers or decisions."
                />
              ) : (
                proposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    users={users.data ?? []}
                    onChanged={() => {
                      detail.refresh()
                      transcripts.refresh()
                    }}
                  />
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ProposalCard({
  proposal,
  users,
  onChanged,
}: {
  proposal: Proposal
  users: User[]
  onChanged: () => void
}) {
  const { push } = useToast()
  const [payload, setPayload] = useState<Record<string, unknown>>({ ...proposal.payload })
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState(proposal.review_note ?? '')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    setPayload({ ...proposal.payload })
    setNote(proposal.review_note ?? '')
  }, [proposal.id, proposal.updated_at])

  async function act(action: 'approve' | 'reject' | 'apply' | 'save') {
    setBusy(action)
    try {
      if (action === 'save') {
        await api.patch(`/ai/proposals/${proposal.id}`, { payload, review_note: note || null })
        push('Proposal updated.')
        setEditing(false)
      } else if (action === 'apply') {
        await api.post(`/ai/proposals/${proposal.id}/apply`)
        push('Proposal applied with an audit record.')
      } else {
        await api.post(`/ai/proposals/${proposal.id}/${action}`, { note: note || null })
        push(action === 'approve' ? 'Proposal approved.' : 'Proposal rejected.')
      }
      onChanged()
    } catch (caught) {
      push((caught as Error).message, 'error')
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  const locked = proposal.status === 'applied'
  const editable = proposal.status === 'pending'

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="badge badge-indigo">{operationLabel[proposal.operation] ?? proposal.operation}</span>
          <span className={`badge ${proposalTone[proposal.status]}`}>{humanize(proposal.status)}</span>
          {proposal.is_ambiguous && <span className="badge badge-amber">Ambiguous match</span>}
          {proposal.duplicate_of_id && <span className="badge badge-violet">Possible duplicate</span>}
          {proposal.confidence !== null && (
            <span className="text-[10px] text-slate-400">
              {Math.round((proposal.confidence ?? 0) * 100)}% confidence
            </span>
          )}
        </div>
        <span className="text-xs text-slate-500">
          {typeof proposal.current_values?.title === 'string'
            ? proposal.current_values.title
            : proposal.target_type === 'session'
              ? 'This session'
              : 'Task'}
        </span>
      </div>

      <div className="space-y-3 p-4">
        <blockquote className="border-l-2 border-slate-300 bg-slate-50 px-3 py-2 text-xs italic leading-relaxed text-slate-600">
          “{proposal.evidence_excerpt ?? 'No evidence excerpt'}”
          <span className="mt-1 block text-[10px] not-italic text-slate-400">
            {proposal.speaker ?? 'Unknown speaker'}
            {proposal.spoken_at ? ` · ${proposal.spoken_at}` : ''}
          </span>
        </blockquote>

        {proposal.duplicate_of_id && (
          <p className="rounded-md bg-violet-50 px-2.5 py-1.5 text-[11px] text-violet-700">
            Looks like an existing {proposal.duplicate_of_type?.replaceAll('_', ' ')} already captured in this
            session. Reject unless it adds something new.
          </p>
        )}
        {proposal.is_ambiguous && (
          <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
            The extractor could not confidently match a task. Edit the proposal or reject it.
          </p>
        )}
        {proposal.failure_reason && (
          <p className="rounded-md bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">
            Last apply failed: {proposal.failure_reason}
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="label">Current</p>
            <ReadableCurrent values={proposal.current_values ?? {}} users={users} />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <p className="label mb-1">Proposed</p>
              {editable && (
                <button type="button" className="text-xs font-semibold text-emerald-700" onClick={() => setEditing((v) => !v)}>
                  {editing ? 'Close editor' : 'Edit'}
                </button>
              )}
            </div>
            {editing && editable ? (
              <ProposalFields operation={proposal.operation} payload={payload} setPayload={setPayload} users={users} />
            ) : (
              <ReadableProposed operation={proposal.operation} payload={payload} users={users} />
            )}
          </div>
        </div>

        {editable && (
          <input
            className="input text-xs"
            placeholder="Review note (optional)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        )}

        <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-slate-100 pt-2.5">
          {proposal.status === 'pending' && (
            <>
              {editing && (
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => act('save')}>
                  {busy === 'save' ? <Spinner className="h-3 w-3" /> : <Icon name="check" className="h-3 w-3" />} Save edit
                </button>
              )}
              <button type="button" className="btn btn-danger btn-sm" disabled={busy !== null} onClick={() => act('reject')}>
                {busy === 'reject' ? <Spinner className="h-3 w-3" /> : <Icon name="x" className="h-3 w-3" />} Reject
              </button>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => act('approve')}>
                {busy === 'approve' ? <Spinner className="h-3 w-3" /> : <Icon name="check" className="h-3 w-3" />} Approve
              </button>
            </>
          )}
          {proposal.status === 'approved' && (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => act('apply')}>
              {busy === 'apply' ? <Spinner className="h-3 w-3" /> : <Icon name="send" className="h-3 w-3" />} Apply to task records
            </button>
          )}
          {proposal.status === 'failed' && (
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => act('reject')}>
              Close proposal
            </button>
          )}
          {locked && <span className="text-[11px] text-emerald-700">Applied {formatDateTime(proposal.applied_at)}</span>}
        </div>
      </div>
    </div>
  )
}

function ProposalFields({
  operation,
  payload,
  setPayload,
  users,
}: {
  operation: string
  payload: Record<string, unknown>
  setPayload: (value: Record<string, unknown>) => void
  users: User[]
}) {
  const update = (key: string, value: unknown) => setPayload({ ...payload, [key]: value })
  if (operation === 'update_task_status') {
    return (
      <select
        className="select text-xs"
        value={String(payload.status ?? 'todo')}
        onChange={(event) => update('status', event.target.value as TaskStatus)}
      >
        {(['backlog', 'todo', 'in_progress', 'done', 'canceled'] as const).map((status) => (
          <option key={status} value={status}>
            {humanize(status)}
          </option>
        ))}
      </select>
    )
  }
  if (operation === 'resolve_blocker') {
    return (
      <textarea
        className="textarea min-h-[64px] text-xs"
        value={String(payload.resolution_details ?? '')}
        onChange={(event) => update('resolution_details', event.target.value)}
      />
    )
  }
  if (operation === 'add_progress_update') {
    return (
      <div className="space-y-2">
        <textarea
          className="textarea min-h-[64px] text-xs"
          value={String(payload.progress ?? '')}
          onChange={(event) => update('progress', event.target.value)}
        />
        <input
          className="input text-xs"
          placeholder="Next steps"
          value={String(payload.next_steps ?? '')}
          onChange={(event) => update('next_steps', event.target.value || null)}
        />
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <textarea
        className="textarea min-h-[64px] text-xs"
        value={String(payload.description ?? '')}
        onChange={(event) => update('description', event.target.value)}
      />
      {operation === 'record_decision' && (
        <input
          className="input text-xs"
          placeholder="Rationale"
          value={String(payload.rationale ?? '')}
          onChange={(event) => update('rationale', event.target.value || null)}
        />
      )}
      {(operation === 'create_action_item' || operation === 'create_blocker') && (
        <select
          className="select text-xs"
          value={String(payload.owner_id ?? '')}
          onChange={(event) => update('owner_id', event.target.value || null)}
        >
          <option value="">Unassigned</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.full_name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}


function userName(id: unknown, users: User[]): string {
  if (typeof id !== 'string' || !id) return 'Unassigned'
  return users.find((user) => user.id === id)?.full_name ?? 'Unknown person'
}

function ReadableCurrent({ values, users }: { values: Record<string, unknown>; users: User[] }) {
  const title = typeof values.title === 'string' ? values.title : null
  const status = typeof values.status === 'string' ? values.status : null
  const assignee = 'assignee_id' in values ? userName(values.assignee_id, users) : null
  return (
    <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
      {title && <p><span className="text-slate-500">Task: </span>{title}</p>}
      {status && <p><span className="text-slate-500">Status: </span>{humanize(status)}</p>}
      {assignee && <p><span className="text-slate-500">Owner: </span>{assignee}</p>}
      {!title && !status && !assignee && <p className="text-slate-500">No task state to compare.</p>}
    </div>
  )
}

function ReadableProposed({
  operation,
  payload,
  users,
}: {
  operation: string
  payload: Record<string, unknown>
  users: User[]
}) {
  const description = typeof payload.description === 'string' ? payload.description : ''
  const owner = 'owner_id' in payload ? userName(payload.owner_id, users) : null
  const due = typeof payload.due_date === 'string' ? payload.due_date : null
  const progress = typeof payload.progress === 'string' ? payload.progress : ''
  const next = typeof payload.next_steps === 'string' ? payload.next_steps : null
  const rationale = typeof payload.rationale === 'string' ? payload.rationale : null
  const resolution = typeof payload.resolution_details === 'string' ? payload.resolution_details : ''
  const assignee = 'assignee_id' in payload ? userName(payload.assignee_id, users) : null

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
      {operation === 'update_task_status' && (
        <p>Change status to <span className="font-medium">{humanize(String(payload.status ?? ''))}</span>.</p>
      )}
      {operation === 'assign_task' && <p>Assign the task to <span className="font-medium">{assignee}</span>.</p>}
      {operation === 'add_progress_update' && (
        <>
          <p className="font-medium">Add a progress update</p>
          <p>{progress}</p>
          {next && <p className="text-slate-500">Next: {next}</p>}
        </>
      )}
      {operation === 'create_blocker' && (
        <>
          <p className="font-medium">Create a help request</p>
          <p>{description}</p>
          <p className="text-slate-500">Who can help: {owner}</p>
        </>
      )}
      {operation === 'resolve_blocker' && (
        <>
          <p className="font-medium">Resolve the blocker</p>
          <p>{resolution || 'No resolution detail supplied.'}</p>
        </>
      )}
      {operation === 'create_action_item' && (
        <>
          <p className="font-medium">Create a follow-up</p>
          <p>{description}</p>
          <p className="text-slate-500">
            Owner: {owner}{due ? ` · due ${due}` : ''}
          </p>
        </>
      )}
      {operation === 'record_decision' && (
        <>
          <p className="font-medium">Record a decision</p>
          <p>{description}</p>
          {rationale && <p className="text-slate-500">Why: {rationale}</p>}
        </>
      )}
      {!['update_task_status', 'assign_task', 'add_progress_update', 'create_blocker', 'resolve_blocker', 'create_action_item', 'record_decision'].includes(operation) && (
        <p>{humanize(operation)}</p>
      )}
    </div>
  )
}
