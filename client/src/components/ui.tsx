import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icons } from './Icons'
import type { RunStatus, StepStatus } from '../types'

type AnyStatus = RunStatus | StepStatus | 'scheduled' | 'skipped' | 'awaiting'

const labelMap: Record<string, string> = {
  running: 'Running',
  review: 'Awaiting review',
  awaiting: 'Awaiting review',
  done: 'Done',
  failed: 'Failed',
  pending: 'Pending',
  skipped: 'Skipped',
  scheduled: 'Scheduled',
  cancelled: 'Cancelled',
}

export function Badge({
  status,
  children,
  withDot = true,
}: {
  status: AnyStatus
  children?: ReactNode
  withDot?: boolean
}) {
  const normalised = status === 'awaiting' ? 'review' : status
  return (
    <span className={`badge ${normalised}`}>
      {withDot && (
        <span
          className={`dot ${normalised === 'running' || normalised === 'review' ? 'pulse' : ''}`}
        />
      )}
      {children ?? labelMap[status] ?? status}
    </span>
  )
}

export function Avatar({
  initials,
  size = 24,
  hue = 250,
}: {
  initials: string
  size?: number
  hue?: number
}) {
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, size * 0.4),
        background: `linear-gradient(135deg, oklch(0.62 0.14 ${hue}), oklch(0.50 0.17 ${(hue + 90) % 360}))`,
      }}
    >
      {initials}
    </span>
  )
}

type BtnKind = 'default' | 'primary' | 'success' | 'danger' | 'ghost'
type BtnSize = 'sm' | 'md' | 'lg'

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: BtnKind
  size?: BtnSize
  leftIcon?: ReactNode
  rightIcon?: ReactNode
}

export function Btn({
  kind = 'default',
  size = 'md',
  leftIcon,
  rightIcon,
  children,
  className,
  ...rest
}: BtnProps) {
  const cls = ['btn']
  if (kind === 'primary') cls.push('btn-primary')
  else if (kind === 'success') cls.push('btn-success')
  else if (kind === 'danger') cls.push('btn-danger')
  else if (kind === 'ghost') cls.push('btn-ghost')
  if (size === 'sm') cls.push('btn-sm')
  else if (size === 'lg') cls.push('btn-lg')
  if (className) cls.push(className)
  return (
    <button className={cls.join(' ')} {...rest}>
      {leftIcon}
      {children}
      {rightIcon}
    </button>
  )
}

export function MiniSteps({ progress = [] }: { progress?: number[] }) {
  const cls: Record<number, string> = { 0: '', 1: 'done', 2: 'review', 3: 'failed', 4: 'running' }
  return (
    <span className="run-mini">
      {progress.map((p, i) => (
        <span key={i} className={`b ${cls[p] ?? ''}`} />
      ))}
    </span>
  )
}

export function StepMarker({ index, status }: { index: number; status: StepStatus }) {
  let inner: ReactNode = index + 1
  if (status === 'running') inner = <span className="step-spinner" />
  else if (status === 'done') inner = <Icons.Check size={12} strokeWidth={3} />
  else if (status === 'failed') inner = <Icons.X size={12} strokeWidth={3} />
  else if (status === 'awaiting') inner = <Icons.Eye size={12} strokeWidth={2.4} />
  return <span className="step-marker">{inner}</span>
}

export function StatusDotBox({ status }: { status: string }) {
  const map: Record<string, string> = {
    done: 'var(--success)',
    failed: 'var(--danger)',
    running: 'var(--accent)',
    review: 'var(--review)',
    pending: 'var(--text-3)',
  }
  const color = map[status] ?? 'var(--text-3)'
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        boxShadow:
          status === 'running' || status === 'review'
            ? `0 0 0 4px color-mix(in oklab, ${color} 24%, transparent)`
            : 'none',
      }}
    />
  )
}

export function timeAgo(input: string | number | Date | null | undefined): string {
  if (input == null) return '—'
  let dt: Date
  if (input instanceof Date) dt = input
  else if (typeof input === 'number') dt = new Date(input)
  else dt = new Date(input)
  if (Number.isNaN(dt.getTime())) return '—'
  const diffMs = Date.now() - dt.getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ${min % 60}m ago`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh ? `${d}d ${rh}h ago` : `${d}d ago`
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

export function nextRunLabel(iso: string | undefined): string {
  if (!iso) return '—'
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return '—'
  const diffMs = dt.getTime() - Date.now()
  if (diffMs <= 0) return 'now'
  const min = Math.floor(diffMs / 60000)
  if (min < 60) return `in ${min}m`
  const h = Math.floor(min / 60)
  if (h < 24)
    return `in ${h}h${min % 60 ? ` ${min % 60}m` : ''}`
  return dt.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
