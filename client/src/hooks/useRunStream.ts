import { useEffect, useReducer, useRef } from 'react'
import { apiSSE, apiJSON } from '../config'
import type { Comment, LogLine, RunSummary, StepState } from '../types'

interface State {
  loading: boolean
  run: RunSummary | null
  logs: LogLine[]
  comments: Comment[]
  error: string | null
}

type Action =
  | { type: 'load'; run: RunSummary }
  | { type: 'workflow_start' }
  | { type: 'step_start'; step_index: number; review?: boolean }
  | { type: 'step_log'; line: LogLine }
  | { type: 'step_done'; step_index: number; duration_ms: number }
  | { type: 'step_failed'; step_index: number; duration_ms?: number }
  | { type: 'review_required'; step_index: number }
  | { type: 'comment'; comment: Comment }
  | { type: 'workflow_done'; status: string; duration_ms: number }
  | { type: 'error'; error: string }

function patchStep(
  steps: StepState[],
  index: number,
  patch: Partial<StepState>,
): StepState[] {
  return steps.map((s, i) => (i === index ? { ...s, ...patch } : s))
}

function reducer(state: State, action: Action): State {
  if (!state.run && action.type !== 'load' && action.type !== 'error') return state
  switch (action.type) {
    case 'load':
      return {
        loading: false,
        run: action.run,
        logs: action.run.logs ?? [],
        comments: action.run.comments ?? [],
        error: null,
      }
    case 'workflow_start':
      return { ...state, run: state.run ? { ...state.run, status: 'running' } : state.run }
    case 'step_start':
      return {
        ...state,
        run: state.run
          ? {
              ...state.run,
              status: action.review ? 'review' : 'running',
              steps: patchStep(state.run.steps, action.step_index, {
                status: action.review ? 'awaiting' : 'running',
                started_at: new Date().toISOString(),
              }),
            }
          : state.run,
      }
    case 'step_log':
      return { ...state, logs: [...state.logs, action.line] }
    case 'step_done':
      return {
        ...state,
        run: state.run
          ? {
              ...state.run,
              status: 'running',
              steps: patchStep(state.run.steps, action.step_index, {
                status: 'done',
                duration_ms: action.duration_ms,
              }),
            }
          : state.run,
      }
    case 'step_failed':
      return {
        ...state,
        run: state.run
          ? {
              ...state.run,
              status: 'failed',
              steps: patchStep(state.run.steps, action.step_index, {
                status: 'failed',
                duration_ms: action.duration_ms ?? null,
              }),
            }
          : state.run,
      }
    case 'review_required':
      return {
        ...state,
        run: state.run
          ? {
              ...state.run,
              status: 'review',
              steps: patchStep(state.run.steps, action.step_index, { status: 'awaiting' }),
            }
          : state.run,
      }
    case 'comment':
      return { ...state, comments: [...state.comments, action.comment] }
    case 'workflow_done': {
      const finalStatus = action.status === 'success' ? 'done' : (action.status as RunSummary['status'])
      return {
        ...state,
        run: state.run
          ? { ...state.run, status: finalStatus, duration_ms: action.duration_ms }
          : state.run,
      }
    }
    case 'error':
      return { ...state, loading: false, error: action.error }
    default:
      return state
  }
}

export function useRunStream(runId: string | null) {
  const [state, dispatch] = useReducer(reducer, {
    loading: true,
    run: null,
    logs: [],
    comments: [],
    error: null,
  })
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!runId) return
    let cancelled = false

    apiJSON<RunSummary>(`/runs/${runId}`)
      .then(run => {
        if (cancelled) return
        dispatch({ type: 'load', run })
        if (run.status !== 'done' && run.status !== 'failed' && run.status !== 'cancelled') {
          openStream(runId)
        }
      })
      .catch(err => {
        if (!cancelled) dispatch({ type: 'error', error: String(err) })
      })

    function openStream(id: string) {
      const es = apiSSE(`/workflow/${id}/stream`)
      esRef.current = es

      const safeJSON = (raw: string) => {
        try {
          return JSON.parse(raw)
        } catch {
          return null
        }
      }

      es.addEventListener('workflow_start', () => dispatch({ type: 'workflow_start' }))
      es.addEventListener('step_start', e => {
        const d = safeJSON((e as MessageEvent).data)
        if (d) dispatch({ type: 'step_start', step_index: d.step_index, review: d.review })
      })
      es.addEventListener('step_log', e => {
        const d = safeJSON((e as MessageEvent).data)
        if (d) dispatch({ type: 'step_log', line: d as LogLine })
      })
      es.addEventListener('step_done', e => {
        const d = safeJSON((e as MessageEvent).data)
        if (d) dispatch({ type: 'step_done', step_index: d.step_index, duration_ms: d.duration_ms })
      })
      es.addEventListener('step_failed', e => {
        const d = safeJSON((e as MessageEvent).data)
        if (d)
          dispatch({
            type: 'step_failed',
            step_index: d.step_index,
            duration_ms: d.duration_ms,
          })
      })
      es.addEventListener('review_required', e => {
        const d = safeJSON((e as MessageEvent).data)
        if (d) dispatch({ type: 'review_required', step_index: d.step_index })
      })
      es.addEventListener('comment', e => {
        const d = safeJSON((e as MessageEvent).data)
        if (d) dispatch({ type: 'comment', comment: d as Comment })
      })
      es.addEventListener('workflow_done', e => {
        const d = safeJSON((e as MessageEvent).data) ?? { status: 'done', duration_ms: 0 }
        dispatch({ type: 'workflow_done', status: d.status, duration_ms: d.duration_ms })
        es.close()
      })
      es.onerror = () => {
        es.close()
      }
    }

    return () => {
      cancelled = true
      esRef.current?.close()
      esRef.current = null
    }
  }, [runId])

  return state
}
