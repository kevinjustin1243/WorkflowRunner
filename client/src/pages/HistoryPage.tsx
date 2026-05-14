import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiJSON } from '../config'
import { Icons } from '../components/Icons'
import {
  Btn,
  MiniSteps,
  StatusDotBox,
  formatDuration,
  timeAgo,
} from '../components/ui'
import type { RunSummary } from '../types'

type Filter = 'all' | 'review' | 'done' | 'failed'

export function HistoryPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [loading, setLoading] = useState(true)

  async function refresh() {
    try {
      const all = await apiJSON<RunSummary[]>('/runs?limit=200')
      setRuns(all)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 4000)
    return () => clearInterval(id)
  }, [])

  const rows = runs.filter(r => filter === 'all' || r.status === filter)
  const counts = {
    all: runs.length,
    review: runs.filter(r => r.status === 'review').length,
    done: runs.filter(r => r.status === 'done').length,
    failed: runs.filter(r => r.status === 'failed').length,
  }

  return (
    <div className="pane-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">Run history</h1>
          <p className="page-sub">
            Every run is captured — including human review decisions and comments.
          </p>
        </div>
        <div className="row-flex">
          <Btn leftIcon={<Icons.Refresh size={14} />} kind="ghost" onClick={refresh}>
            Refresh
          </Btn>
        </div>
      </div>

      <div className="tabs">
        {(
          [
            { k: 'all', l: 'All' },
            { k: 'review', l: 'Awaiting review' },
            { k: 'done', l: 'Successful' },
            { k: 'failed', l: 'Failed' },
          ] as { k: Filter; l: string }[]
        ).map(t => (
          <button
            key={t.k}
            className={`tab ${filter === t.k ? 'active' : ''}`}
            onClick={() => setFilter(t.k)}
          >
            {t.l} <span className="pill">{counts[t.k]}</span>
          </button>
        ))}
      </div>

      <div className="card">
        <div className="runlist">
          {loading ? (
            <div className="runlist-empty">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="runlist-empty">No runs yet.</div>
          ) : (
            rows.map(r => (
              <RunRow
                key={r.run_id}
                run={r}
                expanded={expanded === r.run_id}
                onToggle={() => setExpanded(expanded === r.run_id ? null : r.run_id)}
                onOpen={() => navigate(`/runs/${r.run_id}`)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function RunRow({
  run,
  expanded,
  onToggle,
  onOpen,
}: {
  run: RunSummary
  expanded: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  return (
    <>
      <div
        className="run-row"
        style={{ gridTemplateColumns: '26px 1.4fr 1fr 90px 110px auto' }}
        onClick={onToggle}
      >
        <StatusDotBox status={run.status} />
        <div>
          <div className="name">{run.workflow_name}</div>
          <div className="muted mono" style={{ fontSize: 11 }}>
            {run.run_id}
          </div>
        </div>
        <MiniSteps progress={run.progress} />
        <span className="dur">{formatDuration(run.duration_ms)}</span>
        <span className="when">{timeAgo(run.started_at)}</span>
        <Btn
          size="sm"
          kind="ghost"
          onClick={e => {
            e.stopPropagation()
            onOpen()
          }}
        >
          Open →
        </Btn>
      </div>
      {expanded && (
        <div style={{ padding: '0 20px 16px', borderBottom: '1px solid var(--border)' }}>
          <div className="logs" style={{ marginTop: 4 }}>
            <div className="logs-head">
              <span className="dot" />
              <span>Output preview</span>
              <span className="spacer" />
              <span className="mono muted">{run.run_id}</span>
            </div>
            <div className="logs-body" style={{ maxHeight: 200 }}>
              {run.logs.length === 0 ? (
                <div className="log-line">
                  <span />
                  <span />
                  <span className="log-text muted">No output captured.</span>
                </div>
              ) : (
                run.logs.slice(0, 30).map((l, i) => (
                  <div className="log-line" key={i}>
                    <span className="log-num">{(i + 1).toString().padStart(3, '0')}</span>
                    <span className={`log-step s${l.step_index % 5}`}>
                      {l.step_name ?? `step ${l.step_index + 1}`}
                    </span>
                    <span className="log-text">{l.line}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
