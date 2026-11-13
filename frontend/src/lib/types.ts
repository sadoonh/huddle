export type Role = 'employee' | 'manager' | 'admin'
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'canceled'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type SessionStatus = 'draft' | 'in_progress' | 'completed'
export type UpdateSource = 'pre_meeting' | 'standup' | 'task_interface' | 'ai_approved' | 'system'
export type BlockerStatus = 'open' | 'resolved'
export type ActionItemStatus = 'open' | 'completed' | 'canceled'
export type IntakeStatus = 'new' | 'under_review' | 'accepted' | 'rejected' | 'converted'
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'failed'

export interface User {
  id: string
  email: string
  full_name: string
  role: Role
  is_active: boolean
  standup_eligible: boolean
  created_at: string
}

export interface UserBrief {
  id: string
  full_name: string
  email: string
  role: Role
}

export interface Me extends User {
  is_manager: boolean
}

export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface Project {
  id: string
  name: string
  description: string | null
  status: 'active' | 'paused' | 'completed' | 'archived'
  owner: UserBrief | null
  members: UserBrief[]
  task_counts: Partial<Record<TaskStatus, number>>
  created_at: string
  updated_at: string
}

export interface TaskUpdate {
  id: string
  task_id: string
  task_title: string | null
  progress: string
  next_steps: string | null
  source: UpdateSource
  author: UserBrief | null
  attributed_to: UserBrief | null
  session_id: string | null
  created_at: string
}

export interface Blocker {
  id: string
  task_id: string | null
  project_id: string | null
  task_title: string | null
  description: string
  status: BlockerStatus
  owner: UserBrief | null
  reported_by: UserBrief | null
  reported_session_id: string | null
  resolution_details: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
  age_days: number
}

export interface ActionItem {
  id: string
  session_id: string | null
  task_id: string | null
  task_title: string | null
  description: string
  status: ActionItemStatus
  owner: UserBrief | null
  due_date: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface Decision {
  id: string
  session_id: string | null
  task_id: string | null
  task_title: string | null
  project_id: string | null
  description: string
  rationale: string | null
  decided_by: UserBrief | null
  responsible_user: UserBrief | null
  created_at: string
}

export interface Task {
  id: string
  project_id: string
  project_name: string | null
  title: string
  description: string | null
  assignee: UserBrief | null
  priority: Priority
  status: TaskStatus
  due_date: string | null
  is_at_risk: boolean
  at_risk_reason: string | null
  completed_at: string | null
  version: number
  created_at: string
  updated_at: string
  is_blocked: boolean
  is_overdue: boolean
  open_blocker_count: number
  open_action_item_count: number
  latest_update: TaskUpdate | null
}

export interface TaskDetail extends Task {
  updates: TaskUpdate[]
  blockers: Blocker[]
  action_items: ActionItem[]
  decisions: Decision[]
}

export interface WorkspaceTask extends Task {
  open_blockers: Blocker[]
  open_action_items: ActionItem[]
  reasons: string[]
}

export interface DailyUpdate {
  id: string
  user_id: string
  update_date: string
  progress: string
  next_steps: string | null
  created_at: string
  updated_at: string
}

export interface TodaySession {
  id: string
  session_date: string
  status: SessionStatus
  facilitator: UserBrief | null
  reviewed_count: number
  participant_count: number
}

export type AttentionReason = 'blocker' | 'overdue' | 'at_risk' | 'follow_up'

export interface AttentionIssue {
  kind: 'blocker' | 'action_item' | 'reason'
  id: string
  label: string
  detail: string | null
  owner: UserBrief | null
  due_date: string | null
  age_days: number
}

export interface AttentionItem {
  kind: 'task' | 'blocker' | 'action_item'
  id: string
  task_id: string | null
  focus_id: string | null
  title: string
  detail: string | null
  owner: UserBrief | null
  reporter: UserBrief | null
  reason: string
  reasons: string[]
  issues: AttentionIssue[]
  due_date: string | null
  age_days: number
  task_status: TaskStatus | null
  open_blocker_count: number
  open_action_item_count: number
  origin_session_date: string | null
}

export interface TodayData {
  business_date: string
  session: TodaySession | null
  daily_update: DailyUpdate | null
  attention: Page<AttentionItem>
  current_work: Page<Task>
}

export interface SessionOutcomes {
  action_items: ActionItem[]
  unresolved_blockers: CarriedItem[]
  decisions: Decision[]
  updates_count: number
  participant_count: number
  reviewed_count: number
}

export interface Participant {
  id: string
  user: UserBrief
  daily_update: DailyUpdate | null
  pre_meeting_progress: string | null
  pre_meeting_next_steps: string | null
  pre_meeting_blockers: string | null
  pre_meeting_submitted_at: string | null
  reviewed_at: string | null
  reviewed_by: UserBrief | null
  follow_up_flagged: boolean
  follow_up_note: string | null
  open_blocker_count: number
  open_action_item_count: number
  has_daily_update: boolean
}

export interface Session {
  id: string
  session_date: string
  status: SessionStatus
  facilitator: UserBrief | null
  started_at: string | null
  ended_at: string | null
  summary: string | null
  notes: string | null
  participant_count: number
  reviewed_count: number
  open_blocker_count: number
  open_action_item_count: number
  created_at: string
  updated_at: string
}

export interface SessionDetail extends Session {
  participants: Participant[]
}

export interface CarriedItem {
  kind: 'blocker' | 'action_item' | 'follow_up'
  id: string
  description: string
  task_id: string | null
  task_title: string | null
  owner: UserBrief | null
  origin_session_id: string | null
  origin_session_date: string | null
  age_days: number
  due_date: string | null
}

export interface Workspace {
  session_id: string
  participant: Participant
  daily_update: DailyUpdate | null
  needs_attention: WorkspaceTask[]
  active: WorkspaceTask[]
  other: WorkspaceTask[]
  carried_blockers: CarriedItem[]
  carried_action_items: CarriedItem[]
  recent_updates: TaskUpdate[]
  recent_decisions: Decision[]
}

export interface SessionSummary {
  session: Session
  reviewed_count: number
  unreviewed: UserBrief[]
  updates: number
  blockers_created: number
  blockers_resolved: number
  decisions: number
  action_items: number
  open_action_items: number
  summary_text: string
}

export interface SessionNote {
  id: string
  session_id: string
  body: string
  author: UserBrief | null
  created_at: string
}

export interface SessionCaptures {
  updates: TaskUpdate[]
  blockers: Blocker[]
  action_items: ActionItem[]
  decisions: Decision[]
  notes: SessionNote[]
}

export interface SessionHistoryEntry {
  session: Session
  participant: Participant
  updates: TaskUpdate[]
  blockers_reported: Blocker[]
  blockers_resolved: Blocker[]
  decisions: Decision[]
  action_items: ActionItem[]
}

export interface UserHistory {
  user: UserBrief
  entries: SessionHistoryEntry[]
}

export interface CarryForward {
  blockers: CarriedItem[]
  action_items: CarriedItem[]
  at_risk_tasks: Task[]
  overdue_tasks: Task[]
}

export interface IntakeRequest {
  id: string
  title: string
  description: string | null
  priority: Priority
  status: IntakeStatus
  requester: UserBrief | null
  requester_name: string | null
  reviewed_by: UserBrief | null
  review_note: string | null
  converted_task_id: string | null
  converted_project_id: string | null
  created_at: string
  updated_at: string
}

export interface Proposal {
  id: string
  transcript_id: string
  session_id: string | null
  operation: string
  target_type: 'task' | 'project' | 'blocker' | 'session'
  target_id: string | null
  payload: Record<string, unknown>
  current_values: Record<string, unknown> | null
  evidence_excerpt: string | null
  speaker: string | null
  spoken_at: string | null
  confidence: number | null
  is_ambiguous: boolean
  duplicate_of_type: string | null
  duplicate_of_id: string | null
  status: ProposalStatus
  base_task_version: number | null
  reviewed_by: UserBrief | null
  reviewed_at: string | null
  review_note: string | null
  applied_at: string | null
  failure_reason: string | null
  created_at: string
  updated_at: string
}

export interface Transcript {
  id: string
  session_id: string | null
  filename: string
  content_type: string | null
  size_bytes: number
  status: 'uploaded' | 'processing' | 'processed' | 'failed'
  error: string | null
  uploaded_by: UserBrief | null
  processed_at: string | null
  created_at: string
}

export interface TranscriptDetail extends Transcript {
  proposal_count: number
  pending_count: number
  proposals: Proposal[]
}

export interface AuditEvent {
  id: string
  event_type: string
  entity_type: string
  entity_id: string
  actor: UserBrief | null
  actor_type: 'user' | 'system'
  actor_label: string | null
  occurred_at: string
  previous_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  source: string
  session_id: string | null
  context: Record<string, unknown> | null
}

export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'canceled', label: 'Canceled' },
]

export const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]
