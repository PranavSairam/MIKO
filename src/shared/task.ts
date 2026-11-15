/**
 * Explicit task lifecycle. Late callbacks must not affect cancelled tasks.
 */

import { newActionId, type ActionPlan, type TaskPhase } from './actions.ts'

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
}

export function createTask(plan: ActionPlan): TaskRecord {
  const id = plan.id || newActionId()
  return {
    id,
    plan: { ...plan, id },
    phase: 'understanding',
    stepIndex: 0,
    progress: 'Understanding…',
    error: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    token: 1
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
  return Boolean(task && task.token === token && task.phase !== 'cancelled' && task.phase !== 'completed' && task.phase !== 'failed')
}
