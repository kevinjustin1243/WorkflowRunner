import { useNavigate } from 'react-router-dom'
import { Icons } from '../components/Icons'
import { Btn, timeAgo } from '../components/ui'
import type { InboxItem } from '../types'

interface Props {
  inbox: InboxItem[]
  refresh: () => void
}

export function InboxPage({ inbox, refresh }: Props) {
  const navigate = useNavigate()
  return (
    <div className="pane-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">Review inbox</h1>
          <p className="page-sub">
            Workflows paused on human review steps. Approve or reject to continue.
          </p>
        </div>
        <div className="row-flex">
          <Btn kind="ghost" leftIcon={<Icons.Refresh size={14} />} onClick={refresh}>
            Refresh
          </Btn>
        </div>
      </div>

      {inbox.length === 0 ? (
        <div className="card">
          <div className="empty">
            <Icons.Check size={20} style={{ color: 'var(--success)', display: 'block', margin: '0 auto 8px' }} />
            All caught up — no pending reviews.
          </div>
        </div>
      ) : (
        <div className="card" style={{ borderColor: 'oklch(0.45 0.10 75)' }}>
          <div className="card-head" style={{ background: 'var(--review-soft)' }}>
            <div className="row-flex">
              <Icons.Eye size={15} style={{ color: 'var(--review)' }} />
              <h3>Assigned to you</h3>
              <span className="badge review">{inbox.length} pending</span>
            </div>
          </div>
          <div className="runlist">
            {inbox.map(item => (
              <div
                key={item.run_id}
                className="run-row"
                style={{ gridTemplateColumns: '26px 1.6fr 1fr auto auto' }}
                onClick={() => navigate(`/runs/${item.run_id}`)}
              >
                <Icons.Eye size={14} style={{ color: 'var(--review)' }} />
                <div>
                  <div className="name">{item.workflow_name}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {item.step_name ?? 'review step'}
                  </div>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Triggered by {item.by} · {timeAgo(item.started_at)}
                  {item.reviewers.length > 0 && (
                    <>
                      {' '}
                      · reviewers <span className="mono">{item.reviewers.join(', ')}</span>
                    </>
                  )}
                </div>
                <span style={{ fontSize: 11.5, color: 'var(--review)' }}>awaiting</span>
                <Btn
                  size="sm"
                  kind="primary"
                  onClick={e => {
                    e.stopPropagation()
                    navigate(`/runs/${item.run_id}`)
                  }}
                >
                  Review →
                </Btn>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
