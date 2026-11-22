/**
 * Explicit task lifecycle. Late callbacks must not affect cancelled tasks.
 */

import { newActionId, type ActionPlan, type TaskPhase } from './actions.ts'
import { appendTaskHistory, type TaskHistoryEntry } from './context.ts'
import { createPurpose, purposeSummary, type TaskPurpose } from './task-purpose.ts'

export interface TaskRecord {
  id: string
  plan: ActionPlan
  phase: TaskPhase
  stepIndex: number
  /** Progress line shown in the panel. */
  progress: string
  error: string
  createdAt: number
  updatedAt: number
  /** Generation token; bump to invalidate outstanding callbacks. */
  token: number
  /** Structured goal / held draft / clarification — preserved across recoverable failures. */
  purpose: TaskPurpose
}

export function createTask(plan: ActionPlan): TaskRecord {
  const id = plan.id || newActionId()
  const open = plan.steps.find((s) => s.kind === 'open_whatsapp_chat')
  const draft = plan.steps.find((s) => s.kind === 'draft_whatsapp' || s.kind === 'refine_draft')
  const held =
    plan.pending?.content || draft?.content
      ? {
          instruction: (plan.pending?.content || draft?.content || '').trim(),
          tone: plan.pending?.tone ?? draft?.tone ?? null,
          source: 'explicit' as const
        }
      : null
  return {
    id,
    plan: { ...plan, id },
    phase: 'understanding',
    stepIndex: 0,
    progress: 'Understanding…',
    error: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    token: 1,
    purpose: createPurpose(plan.original, {
      unresolvedQuery: open?.target ?? null,
      heldDraft: held,
      nextStep: plan.steps[0]?.kind ?? null,
      completedSteps: []
    })
  }
}

export function setPhase(task: TaskRecord, phase: TaskPhase, progress?: string, error = ''): TaskRecord {
  return {
    ...task,
    phase,
    progress: progress ?? task.progress,
    error,
    updatedAt: Date.now()
  }
}

export function bumpToken(task: TaskRecord): TaskRecord {
  return { ...task, token: task.token + 1, updatedAt: Date.now() }
}

export function cancelTask(task: TaskRecord, reason = 'Cancelled.'): TaskRecord {
  return setPhase({ ...bumpToken(task) }, 'cancelled', reason)
}

export function isLive(task: TaskRecord | null | undefined, token: number): boolean {
  return Boolean(
    task &&
      task.token === token &&
      task.phase !== 'cancelled' &&
      task.phase !== 'completed' &&
      task.phase !== 'failed'
  )
}

/** Cancel a still-live task when a newer request supersedes it. */
export function supersedeTask(task: TaskRecord | null | undefined, reason = 'Superseded by a newer request.'): TaskRecord | null {
  if (!task) return null
  if (task.phase === 'cancelled' || task.phase === 'completed' || task.phase === 'failed') return task
  return cancelTask(task, reason)
}

/** Park a live task while the owner asks an unrelated question. */
export function suspendTask(task: TaskRecord, note = 'Paused while you asked something else.'): TaskRecord {
  if (task.phase === 'cancelled' || task.phase === 'completed' || task.phase === 'failed') return task
  return setPhase(
    {
      ...task,
      purpose: { ...task.purpose, suspended: true, updatedAt: Date.now() }
    },
    'suspended',
    note
  )
}

export function resumeTask(task: TaskRecord, progress?: string): TaskRecord {
  if (task.phase !== 'suspended') return task
  const nextPhase: TaskPhase = task.purpose.clarification ? 'needs_choice' : 'executing'
  return setPhase(
    {
      ...task,
      purpose: { ...task.purpose, suspended: false, updatedAt: Date.now() }
    },
    nextPhase,
    progress || task.progress
  )
}

export function patchPurpose(task: TaskRecord, purpose: TaskPurpose): TaskRecord {
  return { ...task, purpose: { ...purpose, updatedAt: Date.now() }, updatedAt: Date.now() }
}

export function taskHistoryFromRecord(
  task: TaskRecord,
  extras?: TaskHistoryEntry['artifacts']
): TaskHistoryEntry {
  const purposeLine = purposeSummary(task.purpose)
  return {
    id: task.id,
    kinds: task.plan.steps.map((s) => s.kind),
    original: task.plan.original.slice(0, 200),
    phase: task.phase,
    summary: (purposeLine || task.progress || task.error || task.plan.original).slice(0, 120),
    at: task.updatedAt,
    artifacts: {
      ...extras,
      purpose: purposeLine || undefined,
      unresolvedQuery: task.purpose.unresolvedQuery || undefined,
      heldDraft: Boolean(task.purpose.heldDraft?.instruction) || undefined
    }
  }
}

export function recordTaskOutcome(
  history: TaskHistoryEntry[],
  task: TaskRecord,
  extras?: TaskHistoryEntry['artifacts']
): TaskHistoryEntry[] {
  return appendTaskHistory(history, taskHistoryFromRecord(task, extras))
}
