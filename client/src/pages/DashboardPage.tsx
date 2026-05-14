import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiJSON } from '../config'
import { Icons } from '../components/Icons'
import {
  Avatar,
  Btn,
  MiniSteps,
  StatusDotBox,
  formatDuration,
  nextRunLabel,
  timeAgo,
} from '../components/ui'
import type { AppStats, InboxItem, Me, RunSummary, Workflow } from '../types'

interface Props {
  me: Me | null
  workflows: Workflow[]
  inbox: InboxItem[]
  refreshInbox: () => void
}

export function DashboardPage({ me, workflows, inbox }: Props) {
  const navigate = useNavigate()
  const [stats, setStats] = useState<AppStats | null>(null)
  const [recent, setRecent] = useState<RunSummary[]>([])

  async function refresh() {
    try {
      const [s, r] = await Promise.all([
        apiJSON<AppStats>('/stats'),
        apiJSON<RunSummary[]>('/runs?limit=6'),
      ])
      setStats(s)
      setRecent(r)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [])

  const scheduled = workflows.filter(w => w.schedule)
  const reviewWorkflows = workflows.filter(w => w.steps.some(s => s.review)).length

  return (
    <div className="pane-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">
            Welcome back, {me?.display_name?.split(' ')[0] ?? 'there'}
          </h1>
          <p className="page-sub">
            {workflows.length} workflows · {reviewWorkflows} with human review ·{' '}
            {inbox.length} awaiting your approval right now
          </p>
        </div>
        <div className="row-flex">
          <Btn leftIcon={<Icons.Refresh size={14} />} kind="ghost" onClick={refresh}>
            Refresh
          </Btn>
          <Btn
            kind="primary"
            leftIcon={<Icons.Plus size={14} />}
            onClick={() => navigate('/workflows')}
          >
            New workflow
          </Btn>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat">
          <div className="stat-label">Runs · last 7d</div>
          <div className="stat-value">{stats?.runs_7d ?? 0}</div>
          <div
            className={`stat-delta ${
              stats && stats.runs_7d_delta_pct > 0
                ? 'up'
                : stats && stats.runs_7d_delta_pct < 0
                ? 'down'
                : ''
            }`}
          >
            {stats && stats.runs_7d_delta_pct !== 0
              ? `${stats.runs_7d_delta_pct > 0 ? '▲' : '▼'} ${Math.abs(stats.runs_7d_delta_pct)}% vs prior`
              : '— vs prior'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Success rate</div>
          <div className="stat-value">{stats?.success_rate ?? 100}%</div>
          <div className="stat-delta">over recorded runs</div>
        </div>
        <div className="stat">
          <div className="stat-label">Avg duration</div>
          <div className="stat-value">{formatDuration(stats?.avg_duration_ms ?? 0)}</div>
          <div className="stat-delta">last 7d</div>
        </div>
        <div className="stat">
          <div className="stat-label">Pending reviews</div>
          <div className="stat-value" style={{ color: 'var(--review)' }}>
            {stats?.pending_reviews ?? 0}
          </div>
          <div className="stat-delta">
            {inbox.length > 0 ? 'tap below to open' : 'all caught up'}
          </div>
        </div>
      </div>

      {inbox.length > 0 && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'oklch(0.45 0.10 75)' }}>
          <div className="card-head" style={{ background: 'var(--review-soft)' }}>
            <div className="row-flex">
              <Icons.Eye size={15} style={{ color: 'var(--review)' }} />
              <h3>Awaiting your review</h3>
              <span className="badge review">{inbox.length} pending</span>
            </div>
            <Btn
              size="sm"
              kind="ghost"
              rightIcon={<Icons.ChevronRight size={12} />}
              onClick={() => navigate('/inbox')}
            >
              Open inbox
            </Btn>
          </div>
          <div className="runlist">
            {inbox.slice(0, 4).map(item => {
              const wf = workflows.find(w => w._file === item.workflow_file)
              const glyph = wf?.glyph ?? item.workflow_name.slice(0, 2).toUpperCase()
              const total = wf?.steps.length ?? 0
              return (
                <div
                  key={item.run_id}
                  className="run-row"
                  onClick={() => navigate(`/runs/${item.run_id}`)}
                >
                  <Avatar initials={glyph} hue={(glyph.charCodeAt(0) * 23) % 360} />
                  <div>
                    <div className="name">{item.workflow_name}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {item.step_name} ·{' '}
                      {item.step_index != null && total
                        ? `step ${item.step_index + 1} of ${total}`
                        : 'review step'}
                    </div>
                  </div>
                  <div className="who">Triggered by {item.by}</div>
                  <span className="when">{timeAgo(item.started_at)}</span>
                  <Btn size="sm" kind="primary">
                    Review →
                  </Btn>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="dash-row">
        <div className="card">
          <div className="card-head">
            <h3>Recent runs</h3>
            <Btn
              size="sm"
              kind="ghost"
              onClick={() => navigate('/history')}
              rightIcon={<Icons.ChevronRight size={12} />}
            >
              View all
            </Btn>
          </div>
          <div className="runlist">
            {recent.length === 0 ? (
              <div className="runlist-empty">
                No runs yet. Trigger one from the Workflows page.
              </div>
            ) : (
              recent.map(r => (
                <div
                  key={r.run_id}
                  className="run-row"
                  onClick={() => navigate(`/runs/${r.run_id}`)}
                >
                  <StatusDotBox status={r.status} />
                  <div>
                    <div className="name">{r.workflow_name}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {r.run_id} · by {r.by}
                    </div>
                  </div>
                  <MiniSteps progress={r.progress} />
                  <span className="dur">{formatDuration(r.duration_ms)}</span>
                  <span className="when">{timeAgo(r.started_at)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Upcoming schedules</h3>
          </div>
          <div className="runlist">
            {scheduled.length === 0 ? (
              <div className="runlist-empty">
                No scheduled workflows. Add a <code className="mono">schedule:</code> cron in any
                YAML.
              </div>
            ) : (
              scheduled.map(w => (
                <ScheduleRow key={w._file} workflow={w} onClick={() => navigate(`/workflows/${w._file}`)} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ScheduleRow({ workflow, onClick }: { workflow: Workflow; onClick: () => void }) {
  return (
    <div
      className="run-row"
      style={{ gridTemplateColumns: '26px 1.4fr 1fr auto' }}
      onClick={onClick}
    >
      <Icons.Clock size={14} style={{ color: 'var(--text-3)' }} />
      <div>
        <div className="name">{workflow.name}</div>
        <div className="muted mono" style={{ fontSize: 11 }}>
          {workflow.schedule}
        </div>
      </div>
      <span className="when">{nextRunLabel(workflow.next_run)}</span>
      <Btn
        size="sm"
        kind="ghost"
        onClick={e => {
          e.stopPropagation()
          onClick()
        }}
      >
        Open →
      </Btn>
    </div>
  )
}
