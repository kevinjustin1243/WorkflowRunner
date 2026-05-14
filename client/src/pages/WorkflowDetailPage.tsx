import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch, apiJSON } from '../config'
import { Icons } from '../components/Icons'
import {
  Badge,
  Btn,
  MiniSteps,
  StatusDotBox,
  StepMarker,
  formatDuration,
  timeAgo,
} from '../components/ui'
import { YamlEditor } from '../components/YamlEditor'
import type { Me, RunSummary, Workflow } from '../types'

interface Props {
  me: Me | null
  workflows: Workflow[]
  refresh: () => Promise<Workflow[]>
}

type Tab = 'steps' | 'yaml' | 'runs' | 'settings'

export function WorkflowDetailPage({ me, workflows, refresh }: Props) {
  const isAdmin = me?.role === 'admin'
  const { file } = useParams()
  const navigate = useNavigate()
  const wf = useMemo(
    () => workflows.find(w => w._file === file) ?? null,
    [workflows, file],
  )
  const [tab, setTab] = useState<Tab>('steps')
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [yamlSource, setYamlSource] = useState<string | null>(null)
  const [savedYaml, setSavedYaml] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [yamlErr, setYamlErr] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!file) return
    apiJSON<RunSummary[]>('/runs?limit=20').then(all =>
      setRuns(all.filter(r => r.workflow_file === file)),
    )
    apiJSON<{ content: string }>(`/workflow/${file}/content`)
      .then(d => {
        setYamlSource(d.content)
        setSavedYaml(d.content)
      })
      .catch(() => {})
  }, [file])

  if (!wf) {
    return (
      <div className="pane-narrow">
        <div className="empty">Workflow not found.</div>
      </div>
    )
  }

  const reviewCount = wf.steps.filter(s => s.review).length
  const dirty = yamlSource != null && savedYaml != null && yamlSource !== savedYaml

  async function startRun() {
    if (!wf) return
    setStarting(true)
    try {
      const { run_id } = await apiJSON<{ run_id: string }>('/workflow/run', {
        method: 'POST',
        body: JSON.stringify({ workflow_file: wf._file, by: 'you' }),
      })
      navigate(`/runs/${run_id}`)
    } catch {
      // ignore
    } finally {
      setStarting(false)
    }
  }

  async function saveYaml() {
    if (!wf || yamlSource == null) return
    setSaving(true)
    setYamlErr(null)
    try {
      const res = await apiFetch(`/workflow/${wf._file}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: yamlSource }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.detail ?? `${res.status}`)
      }
      setSavedYaml(yamlSource)
      refresh()
    } catch (e) {
      setYamlErr(String(e))
    } finally {
      setSaving(false)
    }
  }

  async function deleteWorkflow() {
    if (!wf) return
    await apiFetch(`/workflow/${wf._file}`, { method: 'DELETE' })
    await refresh()
    navigate('/workflows')
  }

  return (
    <div className="pane-narrow">
      <div className="row-flex" style={{ marginBottom: 12 }}>
        <Btn
          size="sm"
          kind="ghost"
          leftIcon={<Icons.ChevronLeft size={14} />}
          onClick={() => navigate('/workflows')}
        >
          All workflows
        </Btn>
      </div>

      <div className="page-head">
        <div>
          <div className="row-flex" style={{ marginBottom: 6 }}>
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'var(--surface-hi)',
                display: 'grid',
                placeItems: 'center',
                fontFamily: 'var(--mono)',
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              {wf.glyph ?? wf.name.slice(0, 2).toUpperCase()}
            </span>
            <h1 className="page-title">{wf.name}</h1>
            {wf.stats?.last_run && <Badge status={wf.stats.last_run.status} />}
            {reviewCount > 0 && (
              <Badge status="review">
                <Icons.Eye size={11} /> {reviewCount} review{' '}
                {reviewCount === 1 ? 'gate' : 'gates'}
              </Badge>
            )}
          </div>
          <p className="page-sub" style={{ maxWidth: 700 }}>
            {wf.description}
          </p>
        </div>
        <div className="row-flex">
          {isAdmin && (
            <Btn leftIcon={<Icons.Edit size={14} />} onClick={() => setTab('yaml')}>
              Edit YAML
            </Btn>
          )}
          <Btn
            kind="primary"
            leftIcon={<Icons.Play size={14} />}
            onClick={startRun}
            disabled={starting}
          >
            {starting ? 'Starting…' : 'Run now'}
          </Btn>
        </div>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat">
          <div className="stat-label">Owner</div>
          <div className="stat-value" style={{ fontSize: 16 }}>
            {wf.owner ?? '—'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Last run</div>
          <div className="stat-value" style={{ fontSize: 16 }}>
            {wf.stats?.last_run ? timeAgo(wf.stats.last_run.started_at) : 'never'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Success rate</div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            {wf.stats?.success_rate ?? 100}%
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Runs (7d)</div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            {wf.stats?.runs_7d ?? 0}
          </div>
        </div>
      </div>

      <div className="tabs">
        <button
          className={`tab ${tab === 'steps' ? 'active' : ''}`}
          onClick={() => setTab('steps')}
        >
          Steps <span className="pill">{wf.steps.length}</span>
        </button>
        <button className={`tab ${tab === 'yaml' ? 'active' : ''}`} onClick={() => setTab('yaml')}>
          YAML
          {dirty && (
            <span className="pill" style={{ color: 'var(--review)' }}>
              ●
            </span>
          )}
        </button>
        <button className={`tab ${tab === 'runs' ? 'active' : ''}`} onClick={() => setTab('runs')}>
          Recent runs <span className="pill">{runs.length}</span>
        </button>
        <button
          className={`tab ${tab === 'settings' ? 'active' : ''}`}
          onClick={() => setTab('settings')}
        >
          Settings
        </button>
      </div>

      {tab === 'steps' && (
        <div className="steps">
          {wf.steps.map((s, i) => (
            <div key={i} className={`step ${s.review ? 'review-gate' : ''} pending`}>
              <span className="step-rail" />
              <StepMarker index={i} status={s.review ? 'awaiting' : 'pending'} />
              <div className="step-mid">
                <div className="step-row1">
                  <span className="step-name">{s.name}</span>
                  {s.review && (
                    <Badge status="review">
                      <Icons.Eye size={11} /> Human review
                    </Badge>
                  )}
                </div>
                {s.review ? (
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                    {s.prompt}{' '}
                    {s.reviewers && s.reviewers.length > 0 && (
                      <span className="mono">· reviewers: {s.reviewers.join(', ')}</span>
                    )}
                  </div>
                ) : (
                  <div className="step-cmd">$ {s.command}</div>
                )}
              </div>
              <div className="step-right">{s.duration && <span>~{s.duration}</span>}</div>
            </div>
          ))}
        </div>
      )}

      {tab === 'yaml' && yamlSource != null && (
        <div className="editor-cm" style={{ position: 'relative' }}>
          <div className="editor-head">
            <span className="mono" style={{ fontSize: 12.5 }}>
              {wf._file}
              {dirty && <span style={{ color: 'var(--review)' }}> · unsaved</span>}
              {!isAdmin && (
                <span className="muted" style={{ marginLeft: 8 }}>
                  · read-only (admin required to edit)
                </span>
              )}
            </span>
            {isAdmin && (
              <div className="row-flex">
                {yamlErr && (
                  <span style={{ color: 'var(--danger)', fontSize: 12 }}>{yamlErr}</span>
                )}
                <Btn
                  size="sm"
                  kind="ghost"
                  onClick={() => {
                    if (savedYaml != null) setYamlSource(savedYaml)
                    setYamlErr(null)
                  }}
                  disabled={!dirty}
                >
                  Reset
                </Btn>
                <Btn size="sm" kind="primary" onClick={saveYaml} disabled={!dirty || saving}>
                  {saving ? 'Saving…' : 'Save'}
                </Btn>
              </div>
            )}
          </div>
          <YamlEditor value={yamlSource} onChange={isAdmin ? setYamlSource : () => {}} />
        </div>
      )}

      {tab === 'runs' && (
        <div className="card">
          <div className="runlist">
            {runs.length === 0 ? (
              <div className="runlist-empty">No runs yet for this workflow.</div>
            ) : (
              runs.map(r => (
                <div
                  key={r.run_id}
                  className="run-row"
                  onClick={() => navigate(`/runs/${r.run_id}`)}
                >
                  <StatusDotBox status={r.status} />
                  <div>
                    <div className="name">{r.run_id}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      by {r.by}
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
      )}

      {tab === 'settings' && (
        <div className="card">
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <SettingsRow label="Owner" hint="Team responsible for this workflow.">
              <input className="input" defaultValue={wf.owner ?? ''} disabled />
            </SettingsRow>
            <SettingsRow label="Schedule" hint="Cron expression. Edit in YAML to change.">
              <input className="input mono" defaultValue={wf.schedule ?? ''} disabled />
            </SettingsRow>
            <SettingsRow
              label="Tags"
              hint="Loose labels — used in search and grouping."
            >
              <input className="input" defaultValue={(wf.tags ?? []).join(', ')} disabled />
            </SettingsRow>
            <SettingsRow label="Filename" hint="On disk.">
              <input className="input mono" value={wf._file} disabled />
            </SettingsRow>
            {isAdmin ? (
              <SettingsRow
                label="Delete workflow"
                hint="Removes the YAML file. Past runs are kept."
              >
                {confirmDelete ? (
                  <div className="row-flex">
                    <Btn
                      kind="danger"
                      onClick={deleteWorkflow}
                      leftIcon={<Icons.Trash size={14} />}
                    >
                      Confirm delete
                    </Btn>
                    <Btn kind="ghost" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </Btn>
                  </div>
                ) : (
                  <Btn
                    kind="danger"
                    leftIcon={<Icons.Trash size={14} />}
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete…
                  </Btn>
                )}
              </SettingsRow>
            ) : (
              <SettingsRow label="Delete workflow" hint="Admin role required.">
                <span className="muted" style={{ fontSize: 12.5 }}>
                  Ask an admin to remove this workflow.
                </span>
              </SettingsRow>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SettingsRow({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16, alignItems: 'start' }}>
      <div>
        <div style={{ fontWeight: 500, fontSize: 13.5 }}>{label}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          {hint}
        </div>
      </div>
      <div>{children}</div>
    </div>
  )
}
