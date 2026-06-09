import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_NUM_PREDICT,
  MIN_NUM_PREDICT,
  NUM_PREDICT_STEP,
  clampThinkingSplit,
  snapNumPredict,
} from "./tokenBudget";

interface NumPredictSplitSliderProps {
  total: number;
  thinking: number;
  thinkingEnabled: boolean;
  disabled?: boolean;
  onChange: (total: number, thinking: number) => void;
}

type DragMode = "total" | "split" | null;

function valueFromRatio(ratio: number): number {
  const clamped = Math.min(1, Math.max(0, ratio));
  return snapNumPredict(
    MIN_NUM_PREDICT + clamped * (MAX_NUM_PREDICT - MIN_NUM_PREDICT),
  );
}

function ratioFromValue(value: number): number {
  return (value - MIN_NUM_PREDICT) / (MAX_NUM_PREDICT - MIN_NUM_PREDICT);
}

export function NumPredictSplitSlider({
  total,
  thinking,
  thinkingEnabled,
  disabled,
  onChange,
}: NumPredictSplitSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);

  const split = thinkingEnabled
    ? clampThinkingSplit(total, thinking)
    : { total: snapNumPredict(total), thinking: 0 };
  const reply = split.total - split.thinking;

  const valueFromClientX = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return MIN_NUM_PREDICT;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return MIN_NUM_PREDICT;
    return valueFromRatio((clientX - rect.left) / rect.width);
  }, []);

  useEffect(() => {
    if (!dragMode) return;

    const onMove = (event: PointerEvent) => {
      const nextValue = valueFromClientX(event.clientX);
      if (dragMode === "total") {
        const next = clampThinkingSplit(nextValue, split.thinking);
        onChange(next.total, next.thinking);
        return;
      }
      const nextThinking = Math.min(nextValue, split.total - 32);
      const next = clampThinkingSplit(split.total, nextThinking);
      onChange(next.total, next.thinking);
    };

    const onUp = () => setDragMode(null);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragMode, onChange, split.thinking, split.total, valueFromClientX]);

  const totalRatio = ratioFromValue(split.total);
  const splitRatio = ratioFromValue(split.thinking);
  const thinkingShare =
    split.total > 0 ? (split.thinking / split.total) * 100 : 0;

  return (
    <div className="field slider-field num-predict-split">
      <label>
        Max generation tokens (num_predict)
        <span className="slider-value">{split.total}</span>
      </label>

      <div
        ref={trackRef}
        className="num-predict-split-track"
        aria-hidden="true"
      >
        <div
          className="num-predict-split-fill"
          style={{ width: `${totalRatio * 100}%` }}
        >
          {thinkingEnabled ? (
            <>
              <div
                className="num-predict-split-segment thinking"
                style={{ width: `${thinkingShare}%` }}
              />
              <div
                className="num-predict-split-segment reply"
                style={{ width: `${100 - thinkingShare}%` }}
              />
            </>
          ) : null}
        </div>

        {thinkingEnabled ? (
          <button
            type="button"
            className="num-predict-split-handle split"
            style={{ left: `${splitRatio * 100}%` }}
            disabled={disabled}
            aria-label={`Thinking tokens: ${split.thinking}`}
            onPointerDown={(e) => {
              e.preventDefault();
              setDragMode("split");
            }}
          />
        ) : null}

        <button
          type="button"
          className="num-predict-split-handle total"
          style={{ left: `${totalRatio * 100}%` }}
          disabled={disabled}
          aria-label={`Total generation tokens: ${split.total}`}
          onPointerDown={(e) => {
            e.preventDefault();
            setDragMode("total");
          }}
        />
      </div>

      <input
        type="range"
        className="num-predict-split-accessible"
        min={MIN_NUM_PREDICT}
        max={MAX_NUM_PREDICT}
        step={NUM_PREDICT_STEP}
        value={split.total}
        disabled={disabled}
        aria-label="Total generation tokens"
        onChange={(e) => {
          const next = clampThinkingSplit(Number(e.target.value), split.thinking);
          onChange(next.total, next.thinking);
        }}
      />

      {thinkingEnabled ? (
        <input
          type="range"
          className="num-predict-split-accessible"
          min={MIN_NUM_PREDICT}
          max={split.total - 32}
          step={NUM_PREDICT_STEP}
          value={split.thinking}
          disabled={disabled}
          aria-label="Thinking tokens"
          onChange={(e) => {
            const next = clampThinkingSplit(
              split.total,
              Number(e.target.value),
            );
            onChange(next.total, next.thinking);
          }}
        />
      ) : null}

      <div className="slider-bounds" aria-hidden="true">
        <span>{MIN_NUM_PREDICT}</span>
        <span>{MAX_NUM_PREDICT}</span>
      </div>

      {thinkingEnabled ? (
        <div className="num-predict-split-legend">
          <span className="legend-item thinking">
            Thinking <strong>{split.thinking}</strong>
          </span>
          <span className="legend-item reply">
            Reply <strong>{reply}</strong>
          </span>
          <span className="legend-item total">
            Total <strong>{split.total}</strong>
          </span>
        </div>
      ) : (
        <p className="hint">
          Hard cap on generated length. Use 512+ for structured replies; lower
          is faster but may truncate.
        </p>
      )}
    </div>
  );
}
