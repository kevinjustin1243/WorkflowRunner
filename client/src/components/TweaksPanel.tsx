import { useEffect, useState } from 'react'
import { ACCENT_PRESETS, type Accent, type Density, type Theme } from '../hooks/useTweaks'
import { Icons } from './Icons'

interface Props {
  theme: Theme
  density: Density
  accent: Accent
  onTheme: (t: Theme) => void
  onDensity: (d: Density) => void
  onAccent: (a: Accent) => void
}

export function TweaksPanel(props: Props) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('wr_tweaks_open') === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '.' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('wr_tweaks_open', open ? '1' : '0')
    } catch {
      // ignore
    }
  }, [open])

  if (!open) {
    return (
      <button
        type="button"
        className="tweaks-fab"
        onClick={() => setOpen(true)}
        title="Tweaks · ⌘."
        aria-label="Open tweaks"
      >
        <Icons.Settings size={16} />
      </button>
    )
  }

  return (
    <div className="tweaks-panel">
      <div className="tweaks-head">
        <span className="tweaks-title">Tweaks</span>
        <button type="button" className="tweaks-x" onClick={() => setOpen(false)} aria-label="Close">
          ×
        </button>
      </div>
      <div className="tweaks-body">
        <TweaksSection label="Appearance">
          <Segmented
            label="Theme"
            value={props.theme}
            onChange={props.onTheme}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
          />
          <Segmented
            label="Density"
            value={props.density}
            onChange={props.onDensity}
            options={[
              { value: 'cozy', label: 'Cozy' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
          <SelectRow
            label="Accent"
            value={props.accent}
            onChange={props.onAccent}
            options={Object.entries(ACCENT_PRESETS).map(([k, v]) => ({
              value: k as Accent,
              label: v.name,
            }))}
          />
        </TweaksSection>
        <TweaksSection label="Tips">
          <div className="tweaks-tip">
            <kbd>⌘.</kbd> toggle this panel · runs persist to disk in <span className="mono">server/runs.json</span>
          </div>
        </TweaksSection>
      </div>
    </div>
  )
}

function TweaksSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="tweaks-section">
      <div className="tweaks-section-label">{label}</div>
      <div className="tweaks-section-body">{children}</div>
    </div>
  )
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="tweaks-row">
      <span className="tweaks-row-label">{label}</span>
      <div className="tweaks-seg">
        {options.map(o => (
          <button
            key={o.value}
            type="button"
            className={o.value === value ? 'on' : ''}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function SelectRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="tweaks-row">
      <span className="tweaks-row-label">{label}</span>
      <select
        className="tweaks-select"
        value={value}
        onChange={e => onChange(e.target.value as T)}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
