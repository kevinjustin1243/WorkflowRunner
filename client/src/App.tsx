import { useEffect, useState } from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { apiFetch, apiJSON, getMe, setToken, clearToken } from './config'
import { useTweaks } from './hooks/useTweaks'
import { Icons } from './components/Icons'
import { Avatar } from './components/ui'
import { TweaksPanel } from './components/TweaksPanel'
import { DashboardPage } from './pages/DashboardPage'
import { WorkflowsPage } from './pages/WorkflowsPage'
import { WorkflowDetailPage } from './pages/WorkflowDetailPage'
import { ActiveRunPage } from './pages/ActiveRunPage'
import { HistoryPage } from './pages/HistoryPage'
import { InboxPage } from './pages/InboxPage'
import { AccountsPage } from './pages/AccountsPage'
import type { InboxItem, Me, Workflow } from './types'
import './styles.css'

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1)
}

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const t = value.trim()
    if (!t) return
    setError(null)
    setBusy(true)
    setToken(t)
    const res = await apiFetch('/workflows').catch(() => null)
    if (res?.ok) {
      onLogin()
    } else {
      clearToken()
      setError('Invalid token')
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-logo">
          <span className="brand-mark">
            <Icons.Logo size={14} />
          </span>
          Workflow Runner
        </div>
        <p className="login-sub">Enter your API token to continue.</p>
        <input
          className="input"
          type="password"
          placeholder="API token"
          value={value}
          onChange={e => setValue(e.target.value)}
          autoFocus
        />
        {error && <span className="login-error">{error}</span>}
        <button
          type="submit"
          className="btn btn-primary"
          style={{ justifyContent: 'center' }}
          disabled={busy || !value.trim()}
        >
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [inbox, setInbox] = useState<InboxItem[]>([])
  const { tweaks, set } = useTweaks()
  const location = useLocation()
  const navigate = useNavigate()

  async function fetchWorkflows() {
    try {
      const res = await apiFetch('/workflows')
      if (res.status === 401) {
        setAuthed(false)
        setMe(null)
        return [] as Workflow[]
      }
      setAuthed(true)
      const data = (await res.json()) as Workflow[]
      setWorkflows(data)
      return data
    } catch {
      return [] as Workflow[]
    }
  }

  async function fetchMe() {
    try {
      const m = await getMe()
      setMe(m)
    } catch {
      setMe(null)
    }
  }

  async function fetchInbox() {
    try {
      const data = await apiJSON<InboxItem[]>('/inbox')
      setInbox(data)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    fetchWorkflows().then(() => fetchMe())
    fetchInbox()
    const id = setInterval(fetchInbox, 5000)
    return () => clearInterval(id)
  }, [])

  if (authed === null) return null
  if (authed === false) {
    return (
      <LoginScreen
        onLogin={() => {
          fetchWorkflows().then(() => fetchMe())
          fetchInbox()
        }}
      />
    )
  }

  const isWorkflowsRoute =
    location.pathname === '/workflows' || location.pathname.startsWith('/workflows/')
  const isHistoryRoute = location.pathname.startsWith('/history') || location.pathname.startsWith('/runs/')

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icons.Logo size={14} />
          </span>
          <span>Workflow Runner</span>
          <span className="brand-sub">PROD</span>
        </div>

        <div className="nav">
          <NavLink to="/" exact label="Dashboard" icon={<Icons.Dashboard size={16} />} />
          <NavLink
            to="/workflows"
            active={isWorkflowsRoute}
            label="Workflows"
            icon={<Icons.Workflow size={16} />}
            count={workflows.length}
          />
          <NavLink
            to="/inbox"
            label="Review inbox"
            icon={<Icons.Inbox size={16} />}
            count={inbox.length}
            countKind="review"
          />
          <NavLink
            to="/history"
            active={isHistoryRoute}
            label="History"
            icon={<Icons.History size={16} />}
          />

          {workflows.length > 0 && (
            <div className="nav-group">
              <div className="nav-group-label">Pinned</div>
              {workflows.slice(0, 3).map(w => {
                const lastStatus = w.stats?.last_run?.status
                return (
                  <button
                    key={w._file}
                    className="nav-item"
                    onClick={() => navigate(`/workflows/${w._file}`)}
                  >
                    <span
                      className="nav-icon"
                      style={{
                        display: 'grid',
                        placeItems: 'center',
                        fontFamily: 'var(--mono)',
                        fontSize: 9,
                        fontWeight: 600,
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        background: 'var(--surface-hi)',
                        color: 'var(--text-2)',
                      }}
                    >
                      {w.glyph ?? w.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                      }}
                    >
                      {w.name}
                    </span>
                    {lastStatus === 'review' && <span className="count review">!</span>}
                  </button>
                )
              })}
            </div>
          )}

          {me?.role === 'admin' && (
            <div className="nav-group">
              <div className="nav-group-label">Workspace</div>
              <NavLink
                to="/settings/accounts"
                label="Accounts"
                icon={<Icons.Shield size={16} />}
              />
            </div>
          )}
        </div>

        <div className="sidebar-foot">
          <Avatar
            initials={me ? initialsFromName(me.display_name) : '?'}
            size={28}
            hue={me ? (me.username.charCodeAt(0) * 23) % 360 : 250}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="user-name">{me?.display_name ?? '—'}</div>
            <div className="user-role">{me ? roleLabel(me.role) : ''}</div>
          </div>
          <button
            className="icon-btn"
            title="Sign out"
            onClick={() => {
              clearToken()
              setMe(null)
              setAuthed(false)
            }}
          >
            <Icons.ChevronRight size={14} />
          </button>
        </div>
      </aside>

      <main className="main">
        <TopBar />
        <div className="pane">
          <Routes>
            <Route
              path="/"
              element={
                <DashboardPage
                  me={me}
                  workflows={workflows}
                  inbox={inbox}
                  refreshInbox={fetchInbox}
                />
              }
            />
            <Route
              path="/workflows"
              element={
                <WorkflowsPage workflows={workflows} refresh={fetchWorkflows} me={me} />
              }
            />
            <Route
              path="/workflows/:file"
              element={
                <WorkflowDetailPage
                  workflows={workflows}
                  refresh={fetchWorkflows}
                  me={me}
                />
              }
            />
            <Route
              path="/runs/:runId"
              element={<ActiveRunPage user={me} onRefreshInbox={fetchInbox} />}
            />
            <Route path="/history" element={<HistoryPage />} />
            <Route
              path="/inbox"
              element={<InboxPage inbox={inbox} refresh={fetchInbox} />}
            />
            <Route path="/settings/accounts" element={<AccountsPage me={me} />} />
          </Routes>
        </div>
      </main>

      <TweaksPanel
        theme={tweaks.theme}
        density={tweaks.density}
        accent={tweaks.accent}
        onTheme={v => set('theme', v)}
        onDensity={v => set('density', v)}
        onAccent={v => set('accent', v)}
      />
    </div>
  )
}

function NavLink({
  to,
  label,
  icon,
  count,
  countKind,
  active,
  exact,
}: {
  to: string
  label: string
  icon: React.ReactNode
  count?: number
  countKind?: 'review'
  active?: boolean
  exact?: boolean
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const isActive =
    active ?? (exact ? location.pathname === to : location.pathname.startsWith(to))
  return (
    <button
      className={`nav-item ${isActive ? 'active' : ''}`}
      onClick={() => navigate(to)}
    >
      <span className="nav-icon">{icon}</span>
      {label}
      {count != null && count > 0 && (
        <span className={`count ${countKind === 'review' ? 'review' : ''}`}>{count}</span>
      )}
    </button>
  )
}

function TopBar() {
  const location = useLocation()
  const navigate = useNavigate()

  // crumbs derived from path
  const crumbs: { label: string; to?: string }[] = []
  const path = location.pathname
  if (path === '/') {
    crumbs.push({ label: 'Dashboard' })
  } else if (path.startsWith('/workflows')) {
    crumbs.push({ label: 'Workflows', to: '/workflows' })
    const parts = path.split('/').filter(Boolean)
    if (parts[1]) crumbs.push({ label: decodeURIComponent(parts[1]) })
  } else if (path.startsWith('/runs/')) {
    crumbs.push({ label: 'History', to: '/history' })
    const parts = path.split('/').filter(Boolean)
    if (parts[1]) crumbs.push({ label: 'Run ' + parts[1] })
  } else if (path.startsWith('/history')) {
    crumbs.push({ label: 'History' })
  } else if (path.startsWith('/inbox')) {
    crumbs.push({ label: 'Review inbox' })
  }

  return (
    <header className="topbar">
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {c.to ? (
              <button
                className="btn btn-ghost btn-sm"
                style={{ padding: '0 6px', height: 24 }}
                onClick={() => c.to && navigate(c.to)}
              >
                {c.label}
              </button>
            ) : (
              <span className={i === crumbs.length - 1 ? 'now' : ''}>{c.label}</span>
            )}
            {i < crumbs.length - 1 && <span className="sep">/</span>}
          </span>
        ))}
      </div>
      <div className="topbar-search">
        <Icons.Search size={14} />
        <input placeholder="Search workflows, runs…" />
        <span className="kbd">⌘K</span>
      </div>
      <button className="icon-btn" title="Notifications">
        <Icons.Bell size={14} />
      </button>
    </header>
  )
}
