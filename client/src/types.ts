export interface WorkflowStep {
  name: string
  command?: string
  cwd?: string
  review?: boolean
  reviewers?: string[]
  prompt?: string
  duration?: string
}

export interface WorkflowStats {
  success_rate: number
  runs_7d: number
  last_run: {
    run_id: string
    status: RunStatus
    duration_ms: number | null
    started_at: string
    by: string
  } | null
}

export interface Workflow {
  name: string
  description?: string
  schedule?: string
  next_run?: string
  owner?: string
  tags?: string[]
  glyph?: string
  steps: WorkflowStep[]
  _file: string
  stats?: WorkflowStats
}

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'awaiting'

export interface StepState {
  name: string
  status: StepStatus
  duration_ms: number | null
  started_at: string | null
  review: boolean
  command?: string | null
  prompt?: string | null
  reviewers?: string[]
}

export interface LogLine {
  step_index: number
  step_name?: string
  line: string
}

export interface Comment {
  by: string
  text: string
  at: string
  decision: 'approved' | 'rejected' | null
}

export type RunStatus =
  | 'pending'
  | 'running'
  | 'review'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface RunSummary {
  run_id: string
  workflow_name: string
  workflow_file: string
  status: RunStatus
  by: string
  steps: StepState[]
  progress: number[]
  logs: LogLine[]
  comments: Comment[]
  duration_ms: number | null
  started_at: string
  finished_at: string | null
}

export interface InboxItem {
  run_id: string
  workflow_name: string
  workflow_file: string
  step_index: number | null
  step_name: string | null
  reviewers: string[]
  prompt: string
  by: string
  started_at: string
}

export interface AppStats {
  runs_7d: number
  runs_7d_delta_pct: number
  success_rate: number
  avg_duration_ms: number
  pending_reviews: number
}

export type Role = 'admin' | 'member'

export interface Me {
  username: string
  display_name: string
  role: Role
}

export interface Account extends Me {
  created_at: string
}

export interface CreatedAccount extends Account {
  token: string
}
