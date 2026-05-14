import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'
export type Density = 'cozy' | 'compact'
export type Accent = 'blue' | 'violet' | 'teal' | 'amber' | 'rose'

export interface Tweaks {
  theme: Theme
  density: Density
  accent: Accent
}

const STORAGE_KEY = 'wr_tweaks'

const DEFAULTS: Tweaks = {
  theme: 'dark',
  density: 'cozy',
  accent: 'blue',
}

export const ACCENT_PRESETS: Record<Accent, { h: number; name: string }> = {
  blue: { h: 250, name: 'Cobalt' },
  violet: { h: 295, name: 'Violet' },
  teal: { h: 195, name: 'Teal' },
  amber: { h: 75, name: 'Amber' },
  rose: { h: 15, name: 'Rose' },
}

function load(): Tweaks {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return DEFAULTS
  }
}

export function useTweaks() {
  const [tweaks, setTweaks] = useState<Tweaks>(() => load())

  useEffect(() => {
    document.documentElement.dataset.theme = tweaks.theme
    document.documentElement.dataset.density = tweaks.density
    const h = ACCENT_PRESETS[tweaks.accent]?.h ?? 250
    document.documentElement.style.setProperty('--accent', `oklch(0.72 0.14 ${h})`)
    document.documentElement.style.setProperty(
      '--accent-bg',
      tweaks.theme === 'light' ? `oklch(0.93 0.05 ${h})` : `oklch(0.30 0.06 ${h})`,
    )
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tweaks))
    } catch {
      // ignore
    }
  }, [tweaks])

  const set = <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => {
    setTweaks(t => ({ ...t, [key]: value }))
  }

  return { tweaks, set }
}
