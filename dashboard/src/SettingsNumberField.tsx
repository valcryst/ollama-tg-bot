interface SettingsNumberFieldProps {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

export function SettingsNumberField({
  id,
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  disabled,
  onChange,
}: SettingsNumberFieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}
