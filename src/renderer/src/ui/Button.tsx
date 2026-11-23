import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'live'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
}

/** Text button. 40 px tall by default (32 px small); compact mode shrinks both via tokens. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className = '', type = 'button', ...rest },
  ref
) {
  return <button ref={ref} type={type} className={`ui-btn is-${variant}${size === 'sm' ? ' is-sm' : ''} ${className}`.trim()} {...rest} />
})

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name; also the tooltip. Required: icon buttons have no visible text. */
  label: string
  icon: ReactNode
  tone?: 'plain' | 'primary' | 'live' | 'on'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, tone = 'plain', className = '', type = 'button', title, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      className={`ui-iconbtn${tone === 'plain' ? '' : ` is-${tone}`} ${className}`.trim()}
      {...rest}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  )
})
