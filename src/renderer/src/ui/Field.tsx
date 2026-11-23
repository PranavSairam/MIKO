import { forwardRef, useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visible label. Without it, pass aria-label. */
  label?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, className = '', id, ...rest }, ref) {
  const auto = useId()
  const inputId = id ?? auto
  const input = <input ref={ref} id={inputId} className={`ui-input ${className}`.trim()} spellCheck={false} {...rest} />
  if (!label) return input
  return (
    <label className="ui-field" htmlFor={inputId}>
      <span>{label}</span>
      {input}
    </label>
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, className = '', id, ...rest }, ref) {
  const auto = useId()
  const areaId = id ?? auto
  const area = <textarea ref={ref} id={areaId} className={`ui-textarea ${className}`.trim()} {...rest} />
  if (!label) return area
  return (
    <label className="ui-field" htmlFor={areaId}>
      <span>{label}</span>
      {area}
    </label>
  )
})
