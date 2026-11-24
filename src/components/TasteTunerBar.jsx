import { useState } from "react";
import { RotateCcw, SlidersHorizontal, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { DEFAULT_TUNER_STATE, isTunerNeutral } from "../services/tunerService";
import "../styles/tuner.css";

const DIAL_CONFIGS = [
  { key: "era", label: "Era", left: "Classic", right: "Modern" },
  { key: "familiarity", label: "Familiarity", left: "Hits", right: "Hidden Gems" },
  { key: "pacing", label: "Pacing", left: "Slow Burn", right: "Adrenaline" },
  { key: "tone", label: "Tone", left: "Bleak", right: "Uplifting" }
];

function formatDialReadout(val, left, right) {
  const n = Number(val) || 0;
  if (Math.abs(n) < 0.01) return "Balanced";
  return n < 0 ? `${left} (${Math.round(Math.abs(n) * 100)}%)` : `${right} (${Math.round(n * 100)}%)`;
}

export default function TasteTunerBar({
  value = DEFAULT_TUNER_STATE,
  onChange,
  dominantGenreNames = [],
  defaultOpen = false
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const neutral = isTunerNeutral(value);

  const activeDialCount =
    DIAL_CONFIGS.filter((d) => Math.abs(Number(value?.[d.key]) || 0) >= 0.01).length +
    (value?.antiBubble ? 1 : 0);

  const bubbleHint =
    dominantGenreNames.length > 0
      ? `Dial down ${dominantGenreNames.join(" & ")} while keeping your thematic DNA`
      : "Dial down your top watched genres while keeping your thematic DNA";

  const handleDialChange = (key, rawVal) => {
    onChange?.({
      ...DEFAULT_TUNER_STATE,
      ...value,
      [key]: Number(rawVal)
    });
  };

  const handleToggleAntiBubble = () => {
    onChange?.({
      ...DEFAULT_TUNER_STATE,
      ...value,
      antiBubble: !value?.antiBubble
    });
  };

  const handleReset = () => {
    onChange?.({ ...DEFAULT_TUNER_STATE });
  };

  return (
    <section className={`taste-tuner-shell ${!neutral ? "has-active" : ""}`} aria-label="Live Taste Tuner">
      <div className="taste-tuner-header">
        <button
          type="button"
          className="taste-tuner-toggle"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
        >
          <SlidersHorizontal size={14} aria-hidden="true" />
          <span className="taste-tuner-title">Live Taste Tuner</span>
          {activeDialCount > 0 && (
            <span className="taste-tuner-badge tabular-num">{activeDialCount} active</span>
          )}
          {isOpen ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>

        <div className="taste-tuner-quick-actions">
          <button
            type="button"
            className={`taste-bubble-btn ${value?.antiBubble ? "is-active" : ""}`}
            onClick={handleToggleAntiBubble}
            aria-pressed={Boolean(value?.antiBubble)}
            title={bubbleHint}
          >
            <Sparkles size={13} aria-hidden="true" />
            <span>Break My Bubble</span>
          </button>

          {!neutral && (
            <button
              type="button"
              className="taste-tuner-reset"
              onClick={handleReset}
              title="Reset all tuner dials"
            >
              <RotateCcw size={12} aria-hidden="true" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="taste-tuner-grid">
          {DIAL_CONFIGS.map((dial) => {
            const dialVal = Number(value?.[dial.key] ?? 0);
            return (
              <div key={dial.key} className="taste-tuner-dial">
                <div className="taste-tuner-dial-head">
                  <span className="taste-tuner-dial-name">{dial.label}</span>
                  <span className="taste-tuner-dial-readout tabular-num">
                    {formatDialReadout(dialVal, dial.left, dial.right)}
                  </span>
                </div>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.25"
                  value={dialVal}
                  onChange={(e) => handleDialChange(dial.key, e.target.value)}
                  className="taste-tuner-slider"
                  aria-label={`${dial.label} (${dial.left} to ${dial.right})`}
                />
                <div className="taste-tuner-poles" aria-hidden="true">
                  <span>{dial.left}</span>
                  <span>{dial.right}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
