import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch, apiJSON } from '../config'
import { Icons } from '../components/Icons'
import {
  Avatar,
  Badge,
  Btn,
  StepMarker,
  formatDuration,
  timeAgo,
} from '../components/ui'
import { useRunStream } from '../hooks/useRunStream'
import type { Comment, Me, RunSummary } from '../types'

interface Props {
  user: Me | null
  onRefreshInbox: () => void
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

interface Toast {
  kind: 'success' | 'danger' | 'info'
  text: string
}

export function ActiveRunPage({ user, onRefreshInbox }: Props) {
  const { runId } = useParams()
  const navigate = useNavigate()
  const stream = useRunStream(runId ?? null)
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState<'approve' | 'reject' | 'comment' | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const logsBoxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])

  useEffect(() => {
    const el = logsBoxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [stream.logs.length])

  if (stream.loading) {
    return (
      <div className="pane-narrow">
        <div className="empty">Loading run…</div>
      </div>
    )
  }
  if (stream.error || !stream.run) {
    return (
      <div className="pane-narrow">
        <div className="empty">Run not found.</div>
      </div>
    )
  }

  const run = stream.run
  const completed = run.steps.filter(s => s.status === 'done').length
  const progressPct = (completed / run.steps.length) * 100
  const isAwaiting = run.steps.some(s => s.status === 'awaiting')
  const gateIdx = run.steps.findIndex(s => s.status === 'awaiting')
  const isRunning = run.status === 'running'

  async function approve() {
    if (!runId) return
    setPosting('approve')
    try {
      const res = await apiFetch(`/workflow/${runId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'approved',
          comment: comment.trim() || 'Approved — proceeding.',
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.detail ?? `${res.status}`)
      }
      setComment('')
      setToast({ kind: 'success', text: 'Review approved · workflow resumed' })
      onRefreshInbox()
    } catch (e) {
      setToast({ kind: 'danger', text: String(e).includes('403') ? 'Not authorised for this review' : 'Failed to approve' })
    } finally {
      setPosting(null)
    }
  }

  async function reject() {
    if (!runId) return
    setPosting('reject')
    try {
      const res = await apiFetch(`/workflow/${runId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'rejected',
          comment: comment.trim() || 'Rejected.',
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.detail ?? `${res.status}`)
      }
      setComment('')
      setToast({ kind: 'danger', text: 'Review rejected · workflow halted' })
      onRefreshInbox()
    } catch (e) {
      setToast({ kind: 'danger', text: String(e).includes('403') ? 'Not authorised for this review' : 'Failed to reject' })
    } finally {
      setPosting(null)
    }
  }

  async function postComment() {
    if (!runId || !comment.trim()) return
    setPosting('comment')
    try {
      await apiJSON(`/workflow/${runId}/comment`, {
        method: 'POST',
        body: JSON.stringify({ text: comment.trim() }),
      })
      setComment('')
    } catch {
      // ignore
    } finally {
      setPosting(null)
    }
  }

  async function cancel() {
    if (!runId) return
    if (!confirm('Cancel this run? It will be marked as cancelled.')) return
    await apiFetch(`/workflow/${runId}/cancel`, { method: 'POST' })
    setToast({ kind: 'info', text: 'Run cancelled' })
  }

  const showReviewPanel = isAwaiting
  const gateStep = gateIdx >= 0 ? run.steps[gateIdx] : null

  return (
    <div className="pane-narrow">
      <div className="row-flex" style={{ marginBottom: 12 }}>
        <Btn
          size="sm"
          kind="ghost"
          leftIcon={<Icons.ChevronLeft size={14} />}
          onClick={() => navigate(`/workflows/${run.workflow_file}`)}
        >
          {run.workflow_name}
        </Btn>
        <span className="muted" style={{ fontSize: 12 }}>
          ·
        </span>
        <span className="mono muted" style={{ fontSize: 12 }}>
          {run.run_id}
        </span>
      </div>

      <RunHeader run={run} onCancel={cancel} />

      <div className="progress-track" style={{ marginBottom: 18 }}>
        <div className={`progress-fill ${run.status}`} style={{ width: `${progressPct}%` }} />
      </div>

      <div className={`run-layout ${showReviewPanel ? 'with-review' : ''}`}>
        <div style={{ minWidth: 0 }}>
          <div className="steps">
            {run.steps.map((s, i) => {
              const review = s.review
              const cls = review
                ? `review-gate ${s.status === 'awaiting' ? 'awaiting' : s.status}`
                : s.status
              return (
                <div
                  key={i}
                  className={`step ${cls} ${s.status === 'running' ? 'active' : ''}`}
                >
                  <span className="step-rail" />
                  <StepMarker index={i} status={s.status} />
                  <div className="step-mid">
                    <div className="step-row1">
                      <span className="step-name">{s.name}</span>
                      {review && s.status !== 'done' && (
                        <Badge status="review">
                          <Icons.Eye size={11} /> Human review
                        </Badge>
                      )}
                      {review && s.status === 'done' && (
                        <Badge status="done">
                          <Icons.Check size={11} /> Approved
                        </Badge>
                      )}
                      {s.status === 'running' && <Badge status="running">Running</Badge>}
                      {s.status === 'failed' && <Badge status="failed">Failed</Badge>}
                    </div>
                    {review ? (
                      <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                        {s.prompt}
                        {s.reviewers && s.reviewers.length > 0 && (
                          <>
                            {' '}
                            <span className="mono">· reviewers: {s.reviewers.join(', ')}</span>
                          </>
                        )}
                      </div>
                    ) : (
                      s.command && <div className="step-cmd">$ {s.command}</div>
                    )}

                    {s.status === 'awaiting' && (
                      <div className="review-cta">
                        <Icons.Eye size={16} style={{ color: 'var(--review)' }} />
                        <div className="review-cta-text">
                          <strong>Run is paused on this step.</strong>
                          <span className="meta">
                            Approve in the review panel →
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="step-right">
                    {s.status === 'running' && <span className="step-spinner" />}
                    {s.status === 'done' && s.duration_ms != null && (
                      <span>{formatDuration(s.duration_ms)}</span>
                    )}
                    {s.status === 'awaiting' && <ElapsedTimer startedAt={s.started_at} />}
                    {s.status === 'failed' && s.duration_ms != null && (
                      <span>{formatDuration(s.duration_ms)}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="logs" style={{ marginTop: 14 }}>
            <div className="logs-head">
              <span
                className="dot"
                style={{
                  background:
                    run.status === 'running' || run.status === 'review'
                      ? 'var(--accent)'
                      : 'var(--text-3)',
                }}
              />
              <span>{isRunning ? 'Streaming output' : 'Output'}</span>
              <span className="spacer" />
              <span className="mono muted">{stream.logs.length} lines</span>
            </div>
            <div className="logs-body" ref={logsBoxRef}>
              {stream.logs.length === 0 ? (
                <div className="log-line">
                  <span />
                  <span />
                  <span className="log-text muted">Waiting for output…</span>
                </div>
              ) : (
                stream.logs.map((l, i) => (
                  <div className="log-line" key={i}>
                    <span className="log-num">{(i + 1).toString().padStart(3, '0')}</span>
                    <span className={`log-step s${l.step_index % 5}`}>
                      {l.step_name ?? run.steps[l.step_index]?.name ?? ''}
                    </span>
                    <span className="log-text">{l.line}</span>
                  </div>
                ))
              )}
              {run.status === 'review' && (
                <div className="log-line">
                  <span className="log-num">
                    {(stream.logs.length + 1).toString().padStart(3, '0')}
                  </span>
                  <span className="log-step" style={{ color: 'var(--review)' }}>
                    review
                  </span>
                  <span className="log-text muted">→ paused · awaiting human approval</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {showReviewPanel && gateStep && (
          <ReviewPanel
            run={run}
            gateName={gateStep.name}
            comments={stream.comments}
            comment={comment}
            setComment={setComment}
            onApprove={approve}
            onReject={reject}
            onComment={postComment}
            posting={posting}
            user={user}
          />
        )}
      </div>

      {!showReviewPanel && stream.comments.length > 0 && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-head">
            <h3>Discussion</h3>
          </div>
          <div style={{ padding: 16 }}>
            <Comments comments={stream.comments} currentUser={user} />
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast ${toast.kind}`}>
          {toast.kind === 'success' ? (
            <Icons.Check size={14} style={{ color: 'var(--success)' }} />
          ) : toast.kind === 'danger' ? (
            <Icons.X size={14} style={{ color: 'var(--danger)' }} />
          ) : (
            <Icons.Bell size={14} />
          )}
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  )
}

function RunHeader({ run, onCancel }: { run: RunSummary; onCancel: () => void }) {
  return (
    <div className="run-header-card" style={{ marginBottom: 14 }}>
      <div style={{ minWidth: 0 }}>
        <div className="row-flex" style={{ marginBottom: 4 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: '-0.015em',
            }}
          >
            {run.workflow_name}
          </h2>
          <Badge status={run.status} />
        </div>
        <div className="run-header-meta">
          <span className="item">
            <span className="label">Run</span> <span className="mono">{run.run_id}</span>
          </span>
          <span className="item">
            <span className="label">By</span> {run.by}
          </span>
          <span className="item">
            <span className="label">Started</span> {timeAgo(run.started_at)}
          </span>
          {run.duration_ms != null && (
            <span className="item">
              <span className="label">Duration</span> {formatDuration(run.duration_ms)}
            </span>
          )}
        </div>
      </div>
      <div className="run-controls">
        {(run.status === 'running' || run.status === 'review') && (
          <Btn kind="danger" leftIcon={<Icons.Stop size={14} />} onClick={onCancel}>
            Cancel
          </Btn>
        )}
      </div>
    </div>
  )
}

function ElapsedTimer({ startedAt }: { startedAt: string | null }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  if (!startedAt) return null
  const start = new Date(startedAt).getTime()
  const s = Math.max(0, Math.floor((now - start) / 1000))
  const mm = Math.floor(s / 60).toString()
  const ss = (s % 60).toString().padStart(2, '0')
  return (
    <span style={{ color: 'var(--review)' }}>
      waiting {mm}:{ss}
    </span>
  )
}

function ReviewPanel({
  run,
  gateName,
  comments,
  comment,
  setComment,
  onApprove,
  onReject,
  onComment,
  posting,
  user,
}: {
  run: RunSummary
  gateName: string
  comments: Comment[]
  comment: string
  setComment: (v: string) => void
  onApprove: () => void
  onReject: () => void
  onComment: () => void
  posting: 'approve' | 'reject' | 'comment' | null
  user: Me | null
}) {
  return (
    <div className="review-panel">
      <div className="review-head">
        <div className="icon-wrap">
          <Icons.Eye size={16} />
        </div>
        <div style={{ flex: 1 }}>
          <h3>Human review required</h3>
          <p>{gateName}</p>
        </div>
      </div>

      <div className="review-section">
        <h4>Context</h4>
        <div className="kv">
          <span className="k">Run</span>
          <span className="v">{run.run_id}</span>
          <span className="k">Workflow</span>
          <span className="v">{run.workflow_file}</span>
          <span className="k">Triggered by</span>
          <span className="v">{run.by}</span>
          <span className="k">Step</span>
          <span className="v">{gateName}</span>
        </div>
      </div>

      <div className="review-section">
        <h4>Discussion</h4>
        <Comments comments={comments} currentUser={user} />
        <textarea
          className="review-textarea"
          placeholder="Leave a comment (optional)…"
          value={comment}
          onChange={e => setComment(e.target.value)}
          style={{ marginTop: 12 }}
        />
        <div style={{ marginTop: 8, textAlign: 'right' }}>
          <Btn size="sm" kind="ghost" onClick={onComment} disabled={!comment.trim() || posting !== null}>
            {posting === 'comment' ? 'Posting…' : 'Comment only'}
          </Btn>
        </div>
      </div>

      <div className="review-actions">
        <Btn
          kind="danger"
          leftIcon={<Icons.X size={14} />}
          onClick={onReject}
          disabled={posting !== null}
        >
          {posting === 'reject' ? 'Rejecting…' : 'Reject'}
        </Btn>
        <Btn
          kind="success"
          leftIcon={<Icons.Check size={14} />}
          onClick={onApprove}
          disabled={posting !== null}
        >
          {posting === 'approve' ? 'Approving…' : 'Approve & continue'}
        </Btn>
      </div>
    </div>
  )
}

function Comments({
  comments,
  currentUser,
}: {
  comments: Comment[]
  currentUser: Me | null
}) {
  if (comments.length === 0) {
    return (
      <div className="muted" style={{ fontSize: 12, padding: '8px 0' }}>
        No comments yet.
      </div>
    )
  }
  return (
    <div className="comments">
      {comments.map((c, i) => {
        const isMe = currentUser != null && c.by === currentUser.username
        const initials = initialsFromName(c.by)
        const hue = isMe ? 250 : (c.by.charCodeAt(0) * 17) % 360
        return (
          <div key={i} className="comment">
            <Avatar initials={initials} size={26} hue={hue} />
            <div className="comment-body">
              <div className="comment-meta">
                <span className="comment-name">{c.by}</span>
                <span className="comment-time">{timeAgo(c.at)}</span>
                {c.decision === 'approved' && <Badge status="done">approved</Badge>}
                {c.decision === 'rejected' && <Badge status="failed">rejected</Badge>}
              </div>
              <div className="comment-text">{c.text}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
