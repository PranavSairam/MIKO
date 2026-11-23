import type { ReactNode } from 'react'

/** The one current state of a task. Success is shown only after the action is verified. */
export type TaskState = 'preparing' | 'awaiting' | 'running' | 'completed' | 'cancelled' | 'failed'

const DEFAULT_LABEL: Record<TaskState, string> = {
  preparing: 'Preparing',
  awaiting: 'Waiting for your choice',
  running: 'Working',
  completed: 'Done',
  cancelled: 'Cancelled',
  failed: 'Didn’t work'
}

export function TaskStatus({ state, label }: { state: TaskState; label?: string }) {
  return (
    <span className={`ui-status is-${state}`} role="status" aria-live="polite">
      <span className="ui-status-dot" aria-hidden="true" />
      {label ?? DEFAULT_LABEL[state]}
    </span>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ui-empty">
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action ? <div className="ui-actions">{action}</div> : null}
    </div>
  )
}

export function ErrorState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ui-error" role="alert">
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action ? <div className="ui-actions">{action}</div> : null}
    </div>
  )
}
