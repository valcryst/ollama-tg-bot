interface SettingsNumberFieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  variant?: "number" | "slider";
  onChange: (value: number) => void;
}

function formatSliderValue(value: number, step: number): string {
  if (step < 1) {
    const decimals = String(step).includes(".")
      ? (String(step).split(".")[1]?.length ?? 1)
      : 1;
    return value.toFixed(decimals);
  }
  return String(value);
}

export function SettingsNumberField({
  id,
  label,
  hint,
  error,
  value,
  min,
  max,
  step = 1,
  disabled,
  variant = "number",
  onChange,
}: SettingsNumberFieldProps) {
  const invalid = Boolean(error);

  if (variant === "slider") {
    const display = formatSliderValue(value, step);
    return (
      <div className={`field slider-field${invalid ? " field-invalid" : ""}`}>
        <label htmlFor={id}>
          {label}
          <span className="slider-value">{display}</span>
        </label>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-invalid={invalid}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <div className="slider-bounds" aria-hidden="true">
          <span>{min}</span>
          <span>{max}</span>
        </div>
        {hint ? <p className="hint">{hint}</p> : null}
        {error ? <p className="field-error">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className={`field${invalid ? " field-invalid" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint ? <p className="hint">{hint}</p> : null}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
