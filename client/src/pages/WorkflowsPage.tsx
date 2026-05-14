import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiJSON } from '../config'
import { Icons } from '../components/Icons'
import { Badge, Btn, timeAgo } from '../components/ui'
import type { Me, Workflow } from '../types'

interface Props {
  me: Me | null
  workflows: Workflow[]
  refresh: () => Promise<Workflow[]>
}

type Tab = 'all' | 'review' | 'scheduled'

const TEMPLATE = `name: My Workflow
glyph: MW
owner: me
tags: [example]
description: New workflow — replace this description.
steps:
  - name: Say hello
    command: echo "hello"
  - name: Confirm
    review: true
    reviewers: [me]
    prompt: Confirm before continuing.
  - name: Finish
    command: echo "done"
`

export function WorkflowsPage({ me, workflows, refresh }: Props) {
  const isAdmin = me?.role === 'admin'
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('all')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)

  async function createWorkflow(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    let filename = name.trim()
    if (!filename) return
    if (!filename.endsWith('.yaml')) filename = filename + '.yaml'
    try {
      await apiJSON('/workflows/create', {
        method: 'POST',
        body: JSON.stringify({ filename, content: TEMPLATE }),
      })
      setCreating(false)
      setName('')
      const list = await refresh()
      const created = list.find(w => w._file === filename)
      if (created) navigate(`/workflows/${created._file}`)
    } catch (e) {
      setErr(String(e))
    }
  }

  const filtered = workflows.filter(w => {
    if (tab === 'scheduled' && !w.schedule) return false
    if (tab === 'review' && !w.steps.some(s => s.review)) return false
    return !q || w.name.toLowerCase().includes(q.toLowerCase())
  })

  return (
    <div className="pane-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">Workflows</h1>
          <p className="page-sub">
            YAML-defined pipelines. Add a <code className="mono">review:</code> step to require a
            human between actions.
          </p>
        </div>
        <div className="row-flex">
          <div className="topbar-search" style={{ width: 240, margin: 0 }}>
            <Icons.Search size={14} />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search workflows…"
            />
          </div>
          {isAdmin && (
            <Btn
              kind="primary"
              leftIcon={<Icons.Plus size={14} />}
              onClick={() => setCreating(true)}
            >
              New workflow
            </Btn>
          )}
        </div>
      </div>

      {creating && (
        <form
          onSubmit={createWorkflow}
          className="card"
          style={{ marginBottom: 14, padding: 14, display: 'flex', gap: 10, alignItems: 'center' }}
        >
          <input
            autoFocus
            className="input"
            placeholder="filename.yaml"
            value={name}
            onChange={e => setName(e.target.value)}
            style={{ flex: 1 }}
          />
          <Btn kind="primary" type="submit">
            Create
          </Btn>
          <Btn kind="ghost" type="button" onClick={() => setCreating(false)}>
            Cancel
          </Btn>
          {err && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span>}
        </form>
      )}

      <div className="tabs">
        <button className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
          All <span className="pill">{workflows.length}</span>
        </button>
        <button
          className={`tab ${tab === 'review' ? 'active' : ''}`}
          onClick={() => setTab('review')}
        >
          With human review{' '}
          <span className="pill">
            {workflows.filter(w => w.steps.some(s => s.review)).length}
          </span>
        </button>
        <button
          className={`tab ${tab === 'scheduled' ? 'active' : ''}`}
          onClick={() => setTab('scheduled')}
        >
          Scheduled <span className="pill">{workflows.filter(w => w.schedule).length}</span>
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">No workflows match.</div>
      ) : (
        <div className="wf-grid">
          {filtered.map(w => (
            <WorkflowCard
              key={w._file}
              wf={w}
              onClick={() => navigate(`/workflows/${w._file}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function WorkflowCard({ wf, onClick }: { wf: Workflow; onClick: () => void }) {
  const reviewCount = wf.steps.filter(s => s.review).length
  const lastStatus = wf.stats?.last_run?.status ?? 'pending'
  return (
    <button className="wf-card" onClick={onClick}>
      <div className="wf-card-top">
        <div style={{ minWidth: 0 }}>
          <div className="wf-card-title">
            <span className="glyph mono">{wf.glyph ?? wf.name.slice(0, 2).toUpperCase()}</span>
            <span
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {wf.name}
            </span>
          </div>
          <p className="wf-card-desc">{wf.description}</p>
        </div>
        <Badge status={lastStatus} />
      </div>

      <div className="wf-card-steps">
        {wf.steps.map((s, i) => (
          <div
            key={i}
            className={`step-bar ${s.review ? 'review' : ''}`}
            title={s.name + (s.review ? ' · review' : '')}
          />
        ))}
      </div>

      <div className="wf-card-meta">
        <span className="item">
          <Icons.Logs size={12} /> {wf.steps.length} steps
        </span>
        {reviewCount > 0 && (
          <span className="item" style={{ color: 'var(--review)' }}>
            <Icons.Eye size={12} /> {reviewCount} review {reviewCount === 1 ? 'gate' : 'gates'}
          </span>
        )}
        {wf.schedule && (
          <span className="item">
            <Icons.Clock size={12} /> <span className="mono">{wf.schedule}</span>
          </span>
        )}
        <span style={{ marginLeft: 'auto' }} className="item">
          <Icons.Clock size={12} />{' '}
          {wf.stats?.last_run?.started_at ? timeAgo(wf.stats.last_run.started_at) : 'never run'}
        </span>
      </div>
    </button>
  )
}
