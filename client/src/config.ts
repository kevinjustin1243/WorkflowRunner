export const API_BASE = import.meta.env.VITE_API_URL ?? ''

const TOKEN_KEY = 'wr_token'

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

export function setToken(t: string): void {
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getToken()
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { 'X-API-Key': token } : {}),
    },
  })
}

export async function apiJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) ?? {}),
  }
  const res = await apiFetch(path, { ...init, headers })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export function getMe() {
  return apiJSON<import('./types').Me>('/me')
}

// EventSource can't send custom headers — token goes in query param instead
export function apiSSE(path: string): EventSource {
  const token = getToken()
  const sep = path.includes('?') ? '&' : '?'
  const qs = token ? `${sep}token=${encodeURIComponent(token)}` : ''
  return new EventSource(`${API_BASE}${path}${qs}`)
}
