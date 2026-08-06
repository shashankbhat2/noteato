/**
 * The vocabulary Settings is built from, shared so the onboarding card reads as
 * the same app rather than as a separate screen that happens to precede it.
 */

/** A settings row: label and description on the left, its control on the right. */
export function Row({
  label,
  description,
  children
}: {
  label: string
  description?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <strong>{label}</strong>
        {description && <span>{description}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

export function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="settings-group">
      <div className="settings-group-label">{label}</div>
      {children}
    </section>
  )
}

export function Switch({
  checked,
  onToggle,
  disabled,
  label
}: {
  checked: boolean
  onToggle: () => void
  disabled?: boolean
  /** Only needed where no visible <label> is associated with the switch. */
  label?: string
}) {
  return (
    <button
      className={checked ? 'settings-switch on' : 'settings-switch'}
      onClick={onToggle}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
    >
      <span className="settings-switch-knob" />
    </button>
  )
}
