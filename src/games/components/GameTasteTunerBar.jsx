import { useState } from "react";
import { ChevronDown, ChevronUp, RotateCcw, SlidersHorizontal, Sparkles, Zap } from "lucide-react";
import { DEFAULT_GAME_TUNER_STATE } from "../services/gameRankerService";

const DIAL_CONFIGS = [
  { key: "pacing", label: "Intensity", left: "Cozy", right: "High-Octane" },
  { key: "tone", label: "Tone", left: "Dark", right: "Playful" },
  { key: "era", label: "Era", left: "Classics", right: "Recent" },
  { key: "familiarity", label: "Familiarity", left: "Blockbusters", right: "Hidden Gems" }
];

export const GAME_TUNER_PRESETS = [
  {
    id: "dark-challenge",
    label: "Dark Challenge",
    state: { pacing: 0.8, tone: -0.8, era: 0, familiarity: 0, antiBubble: false }
  },
  {
    id: "cozy",
    label: "Cozy Night",
    state: { pacing: -0.8, tone: 0.8, era: 0, familiarity: 0.2, antiBubble: false }
  },
  {
    id: "hidden",
    label: "Hidden Gems",
    state: { pacing: 0, tone: 0, era: 0, familiarity: 0.9, antiBubble: true }
  },
  {
    id: "fresh",
    label: "2024–2026 Fresh",
    state: { pacing: 0, tone: 0, era: 1.0, familiarity: 0, antiBubble: false }
  }
];

function formatDialReadout(val, left, right) {
  const n = Number(val) || 0;
  if (Math.abs(n) < 0.01) return "Balanced";
  return n < 0 ? `${left} · ${Math.round(Math.abs(n) * 100)}%` : `${right} · ${Math.round(n * 100)}%`;
}

function isPresetMatch(tuner, presetState) {
  return DIAL_CONFIGS.every((d) => Math.abs((Number(tuner?.[d.key]) || 0) - (Number(presetState?.[d.key]) || 0)) < 0.05) &&
    Boolean(tuner?.antiBubble) === Boolean(presetState?.antiBubble);
}

export default function GameTasteTunerBar({
  value = DEFAULT_GAME_TUNER_STATE,
  onChange,
  onReset,
  recentKick = false,
  onToggleRecentKick,
  showRecentKick = false,
  defaultOpen = false
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const activeDialCount =
    DIAL_CONFIGS.filter((d) => Math.abs(Number(value?.[d.key]) || 0) >= 0.01).length +
    (value?.antiBubble ? 1 : 0) +
    (recentKick ? 1 : 0);

  const neutral = activeDialCount === 0;

  const handleDialChange = (key, rawVal) => {
    onChange?.({
      ...DEFAULT_GAME_TUNER_STATE,
      ...value,
      [key]: Number(rawVal)
    });
  };

  const handleReset = () => {
    onChange?.({ ...DEFAULT_GAME_TUNER_STATE });
    onReset?.();
  };

  return (
    <section className={`gv-tuner-shell ${!neutral ? "has-active" : ""}`} aria-label="Live Taste Tuner">
      <div className="gv-tuner-header">
        <button
          type="button"
          className="gv-tuner-toggle"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
        >
          <SlidersHorizontal size={14} aria-hidden="true" />
          <span>Live Taste Tuner</span>
          {activeDialCount > 0 && (
            <span className="gv-tuner-badge tabular-num">{activeDialCount} active</span>
          )}
          {isOpen ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>

        <div className="gv-tuner-quick-actions">
          {showRecentKick && onToggleRecentKick && (
            <button
              type="button"
              className={`gv-tuner-pill ${recentKick ? "is-active" : ""}`}
              onClick={onToggleRecentKick}
              aria-pressed={Boolean(recentKick)}
              title="Bias recommendations toward games you played most recently"
            >
              <Zap size={12} aria-hidden="true" />
              <span>Recent Kick</span>
            </button>
          )}

          <button
            type="button"
            className={`gv-tuner-pill ${value?.antiBubble ? "is-active" : ""}`}
            onClick={() =>
              onChange?.({
                ...DEFAULT_GAME_TUNER_STATE,
                ...value,
                antiBubble: !value?.antiBubble
              })
            }
            aria-pressed={Boolean(value?.antiBubble)}
            title="Surface games outside your usual top genres while keeping your core taste"
          >
            <Sparkles size={12} aria-hidden="true" />
            <span>Break My Bubble</span>
          </button>

          {!neutral && (
            <button
              type="button"
              className="gv-tuner-reset"
              onClick={handleReset}
              title="Reset all taste dials"
            >
              <RotateCcw size={12} aria-hidden="true" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="gv-tuner-body">
          <div className="gv-tuner-presets">
            {GAME_TUNER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`gv-tuner-preset-btn ${isPresetMatch(value, preset.state) ? "is-active" : ""}`}
                onClick={() => onChange?.({ ...preset.state })}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="gv-tuner-grid">
            {DIAL_CONFIGS.map((dial) => {
              const dialVal = Number(value?.[dial.key] ?? 0);
              return (
                <div key={dial.key} className="gv-tuner-dial">
                  <div className="gv-tuner-dial-head">
                    <span className="gv-tuner-dial-name">{dial.label}</span>
                    <span className="gv-tuner-dial-readout tabular-num">
                      {formatDialReadout(dialVal, dial.left, dial.right)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-1"
                    max="1"
                    step="0.2"
                    value={dialVal}
                    onChange={(e) => handleDialChange(dial.key, e.target.value)}
                    className="gv-tuner-slider"
                    aria-label={`${dial.label} (${dial.left} to ${dial.right})`}
                  />
                  <div className="gv-tuner-poles" aria-hidden="true">
                    <span>{dial.left}</span>
                    <span>{dial.right}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
