/**
 * A segmented switch: a quiet track with the chosen option on a white chip (Figma K — List · Grid,
 * By client · Search everything). One choice at a time; it is a radio group to assistive tech.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  testId,
}: {
  options: { value: T; label: string; testId?: string }[]
  value: T
  onChange: (value: T) => void
  label: string
  size?: 'md' | 'sm'
  testId?: string
}) {
  return (
    <div className={`segmented segmented-${size}`} role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'segmented-on' : undefined}
          onClick={() => onChange(o.value)}
          data-testid={o.testId}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
