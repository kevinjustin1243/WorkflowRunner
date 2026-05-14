import { useEffect, useState } from 'react'
import { apiFetch, apiJSON } from '../config'
import { Icons } from '../components/Icons'
import { Avatar, Badge, Btn, timeAgo } from '../components/ui'
import type { Account, CreatedAccount, Me, Role } from '../types'

interface Props {
  me: Me | null
}

interface NewAccountForm {
  username: string
  display_name: string
  role: Role
}

const EMPTY_FORM: NewAccountForm = {
  username: '',
  display_name: '',
  role: 'member',
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function AccountsPage({ me }: Props) {
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<NewAccountForm>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState<{ username: string; token: string } | null>(null)
  const [copied, setCopied] = useState(false)

  async function refresh() {
    setError(null)
    try {
      const list = await apiJSON<Account[]>('/accounts')
      setAccounts(list)
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    if (me?.role === 'admin') refresh()
  }, [me?.role])

  if (!me) return null
  if (me.role !== 'admin') {
    return (
      <div className="pane-narrow">
        <div className="empty">
          <Icons.Shield
            size={20}
            style={{ display: 'block', margin: '0 auto 8px', color: 'var(--text-3)' }}
          />
          Admins only — ask an admin if you need to manage accounts.
        </div>
      </div>
    )
  }

  async function createAccount(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await apiFetch('/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: form.username.trim().toLowerCase(),
          display_name: form.display_name.trim() || form.username.trim(),
          role: form.role,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.detail ?? `${res.status}`)
      }
      const created = (await res.json()) as CreatedAccount
      setToken({ username: created.username, token: created.token })
      setForm(EMPTY_FORM)
      setCreating(false)
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  async function rotateToken(username: string) {
    if (!confirm(`Rotate token for ${username}? Existing token will stop working immediately.`))
      return
    try {
      const res = await apiFetch(`/accounts/${username}/rotate-token`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.detail ?? `${res.status}`)
      }
      const data = (await res.json()) as { username: string; token: string }
      setToken(data)
    } catch (e) {
      setError(String(e))
    }
  }

  async function removeAccount(username: string) {
    if (!confirm(`Delete account ${username}? This cannot be undone.`)) return
    try {
      const res = await apiFetch(`/accounts/${username}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.detail ?? `${res.status}`)
      }
      await refresh()
    } catch (e) {
      setError(String(e))
    }
  }

  async function copyToken() {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token.token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <div className="pane-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">Accounts</h1>
          <p className="page-sub">
            Each account has its own API token. Tokens are shown once at creation or rotation —
            store them somewhere safe.
          </p>
        </div>
        <div className="row-flex">
          <Btn leftIcon={<Icons.Refresh size={14} />} kind="ghost" onClick={refresh}>
            Refresh
          </Btn>
          <Btn
            kind="primary"
            leftIcon={<Icons.Plus size={14} />}
            onClick={() => setCreating(c => !c)}
          >
            {creating ? 'Cancel' : 'New user'}
          </Btn>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--danger)' }}>
          <div className="card-body" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        </div>
      )}

      {token && (
        <div
          className="card"
          style={{ marginBottom: 14, borderColor: 'oklch(0.55 0.14 150)' }}
        >
          <div className="card-head" style={{ background: 'var(--success-bg)' }}>
            <div className="row-flex">
              <Icons.Check size={15} style={{ color: 'var(--success)' }} />
              <h3>Token for {token.username}</h3>
              <Badge status="done">show once</Badge>
            </div>
            <Btn size="sm" kind="ghost" onClick={() => setToken(null)}>
              Dismiss
            </Btn>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
              Copy this token now — you won't be able to see it again. The user signs in by
              pasting it on the login screen.
            </p>
            <div
              style={{
                display: 'flex',
                gap: 8,
                background: 'var(--code-bg)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '10px 12px',
                fontFamily: 'var(--mono)',
                fontSize: 12.5,
                color: 'var(--code-fg)',
                wordBreak: 'break-all',
              }}
            >
              <span style={{ flex: 1 }}>{token.token}</span>
            </div>
            <div>
              <Btn kind="primary" size="sm" onClick={copyToken}>
                {copied ? 'Copied ✓' : 'Copy token'}
              </Btn>
            </div>
          </div>
        </div>
      )}

      {creating && (
        <form
          onSubmit={createAccount}
          className="card"
          style={{ marginBottom: 14 }}
        >
          <div className="card-head">
            <h3>New user</h3>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FormRow label="Username" hint="2–32 chars, lowercase letters, digits, _ or -.">
              <input
                className="input mono"
                autoFocus
                value={form.username}
                onChange={e =>
                  setForm(f => ({ ...f, username: e.target.value.toLowerCase() }))
                }
                placeholder="e.g. alice"
                required
              />
            </FormRow>
            <FormRow label="Display name" hint="Shown in the sidebar and on comments.">
              <input
                className="input"
                value={form.display_name}
                onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                placeholder="e.g. Alice Example"
              />
            </FormRow>
            <FormRow label="Role" hint="Admins can manage workflows and accounts.">
              <select
                className="select"
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value as Role }))}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </FormRow>
            <div className="row-flex" style={{ justifyContent: 'flex-end' }}>
              <Btn kind="ghost" type="button" onClick={() => setCreating(false)}>
                Cancel
              </Btn>
              <Btn kind="primary" type="submit" disabled={busy || !form.username.trim()}>
                {busy ? 'Creating…' : 'Create user'}
              </Btn>
            </div>
          </div>
        </form>
      )}

      <div className="card">
        <div className="card-head">
          <h3>Users</h3>
          <span className="muted" style={{ fontSize: 12 }}>
            {accounts?.length ?? 0} total
          </span>
        </div>
        <div className="runlist">
          {accounts == null ? (
            <div className="runlist-empty">Loading…</div>
          ) : accounts.length === 0 ? (
            <div className="runlist-empty">No accounts yet.</div>
          ) : (
            accounts.map(a => (
              <div
                key={a.username}
                className="run-row"
                style={{ gridTemplateColumns: '36px 1.4fr 1fr 110px auto' }}
              >
                <Avatar
                  initials={initialsFromName(a.display_name)}
                  size={28}
                  hue={(a.username.charCodeAt(0) * 23) % 360}
                />
                <div>
                  <div className="name">{a.display_name}</div>
                  <div className="muted mono" style={{ fontSize: 11.5 }}>
                    {a.username}
                  </div>
                </div>
                <Badge status={a.role === 'admin' ? 'running' : 'pending'}>
                  {a.role}
                </Badge>
                <span className="when">{timeAgo(a.created_at)}</span>
                <div className="row-flex">
                  <Btn size="sm" kind="ghost" onClick={() => rotateToken(a.username)}>
                    Rotate token
                  </Btn>
                  {a.username !== me.username && (
                    <Btn
                      size="sm"
                      kind="danger"
                      leftIcon={<Icons.Trash size={12} />}
                      onClick={() => removeAccount(a.username)}
                    >
                      Delete
                    </Btn>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function FormRow({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 14, alignItems: 'start' }}>
      <div>
        <div style={{ fontWeight: 500, fontSize: 13.5 }}>{label}</div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
          {hint}
        </div>
      </div>
      <div>{children}</div>
    </div>
  )
}
