import { useEffect, useId, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SlidersHorizontal } from "lucide-react";
import { computeStarStageMetrics } from "../services/ratingStudioService";
import { getRatingTier } from "../services/ratingTiers";

export function getEditorialScorePalette(score = 0) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric) || numeric < 1) {
    return {
      color: "#a8a7a2",
      barTop: "rgba(255, 255, 255, 0.22)",
      barBottom: "rgba(255, 255, 255, 0.08)",
      bg: "rgba(255, 255, 255, 0.035)",
      border: "rgba(255, 255, 255, 0.11)",
      glow: "none",
      beam: "rgba(255, 255, 255, 0.07)",
      toneKey: "unrated"
    };
  }
  const rounded = Math.min(10, Math.max(1, Math.round(numeric)));
  if (rounded >= 10) {
    return {
      color: "#f6d07a",
      barTop: "#fae09e",
      barBottom: "#c99635",
      bg: "rgba(246, 208, 122, 0.14)",
      border: "rgba(246, 208, 122, 0.45)",
      glow: "0 14px 38px rgba(246, 208, 122, 0.2)",
      beam: "rgba(246, 208, 122, 0.26)",
      toneKey: "zenith"
    };
  }
  if (rounded >= 8) {
    return {
      color: "#e6ba6c",
      barTop: "#f0cc88",
      barBottom: "#b68536",
      bg: "rgba(230, 186, 108, 0.1)",
      border: "rgba(230, 186, 108, 0.32)",
      glow: "0 12px 30px rgba(230, 186, 108, 0.13)",
      beam: "rgba(230, 186, 108, 0.2)",
      toneKey: "gold"
    };
  }
  if (rounded >= 5) {
    return {
      color: "#efede6",
      barTop: "#f7f5ef",
      barBottom: "#9e9c95",
      bg: "rgba(239, 237, 230, 0.065)",
      border: "rgba(239, 237, 230, 0.22)",
      glow: "0 10px 24px rgba(239, 237, 230, 0.06)",
      beam: "rgba(239, 237, 230, 0.14)",
      toneKey: "solid"
    };
  }
  return {
    color: "#d97b73",
    barTop: "#e6948d",
    barBottom: "#9e4942",
    bg: "rgba(217, 123, 115, 0.09)",
    border: "rgba(217, 123, 115, 0.26)",
    glow: "0 10px 26px rgba(217, 123, 115, 0.1)",
    beam: "rgba(217, 123, 115, 0.18)",
    toneKey: "low"
  };
}

export default function StarRatingStage({
  value = 0,
  hoverValue = 0,
  onChange,
  onHoverChange,
  calibration = null,
  onSelectAnchor = null,
  compact = false,
  titleLabel = "Rating Studio",
  ariaLabel = "Rate this film from 1 to 10"
}) {
  const instanceId = useId();
  const [justPickedScore, setJustPickedScore] = useState(0);
  const [burstKey, setBurstKey] = useState(0);
  const trackRef = useRef(null);
  const dragStateRef = useRef({ active: false, moved: false, lastScore: 0 });
  const suppressClickRef = useRef(false);

  const metrics = computeStarStageMetrics(value, hoverValue);
  const { activeScore, fillPercent, isHovering, stars } = metrics;
  const activeTier = getRatingTier(activeScore);
  const palette = getEditorialScorePalette(activeScore);

  const prevScoreRef = useRef(activeScore);
  const rollDirection = activeScore >= prevScoreRef.current ? 1 : -1;
  useEffect(() => {
    prevScoreRef.current = activeScore;
  }, [activeScore]);

  function handleSelectScore(score) {
    setJustPickedScore(score);
    if (score >= 9) setBurstKey((k) => k + 1);
    onChange?.(score);
    onHoverChange?.(0);
  }

  function resolveScoreFromClientX(clientX) {
    const el = trackRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width) return null;
    const ratio = (clientX - rect.left) / rect.width;
    return Math.min(10, Math.max(1, Math.ceil(ratio * 10)));
  }

  function handlePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const score = resolveScoreFromClientX(event.clientX);
    if (!score) return;
    dragStateRef.current = { active: true, moved: false, lastScore: score };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // ignore synthetic events
    }
    onHoverChange?.(score);
  }

  function handlePointerMove(event) {
    if (!dragStateRef.current.active) return;
    const score = resolveScoreFromClientX(event.clientX);
    if (!score || score === dragStateRef.current.lastScore) return;
    dragStateRef.current.moved = true;
    dragStateRef.current.lastScore = score;
    onHoverChange?.(score);
  }

  function handlePointerUp(event) {
    if (!dragStateRef.current.active) return;
    const finalScore = resolveScoreFromClientX(event.clientX) || dragStateRef.current.lastScore;
    dragStateRef.current.active = false;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // ignore synthetic events
    }
    if (finalScore) {
      suppressClickRef.current = true;
      handleSelectScore(finalScore);
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  }

  function handlePointerCancel() {
    if (!dragStateRef.current.active) return;
    dragStateRef.current.active = false;
    onHoverChange?.(0);
  }

  function handleKeyDown(event, currentScore) {
    const key = event.key;
    let nextScore = null;
    if (key === "ArrowRight" || key === "ArrowUp") {
      nextScore = currentScore >= 10 ? 1 : currentScore + 1;
    } else if (key === "ArrowLeft" || key === "ArrowDown") {
      nextScore = currentScore <= 1 ? 10 : currentScore - 1;
    } else if (key === "Home") {
      nextScore = 1;
    } else if (key === "End") {
      nextScore = 10;
    } else if (key >= "1" && key <= "9") {
      nextScore = Number(key);
    } else if (key === "0") {
      nextScore = 10;
    }

    if (!nextScore) return;
    event.preventDefault();
    handleSelectScore(nextScore);
    const radios = event.currentTarget.parentElement?.querySelectorAll('[role="radio"]');
    radios?.[nextScore - 1]?.focus();
  }

  const stageStyle = {
    "--tier-color": palette.color,
    "--tier-bar-top": palette.barTop,
    "--tier-bar-bottom": palette.barBottom,
    "--tier-bg": palette.bg,
    "--tier-border": palette.border,
    "--tier-glow": palette.glow,
    "--tier-beam": palette.beam
  };

  const verdictDesc =
    !compact && calibration?.summaryText && activeScore > 0
      ? calibration.summaryText
      : activeScore > 0
        ? activeTier.desc
        : "Drag or click across the 1–10 bars to rate";

  const hasVaultHistory = !compact && Number(calibration?.ratedCount) > 0;
  const visibleAnchors = Array.isArray(calibration?.anchorMovies)
    ? calibration.anchorMovies.slice(0, 2)
    : [];

  return (
    <div
      className={`star-rating-stage ${compact ? "is-compact" : ""} ${activeScore > 0 ? "has-score" : "is-unrated"} ${isHovering ? "is-scrubbing" : ""} ${activeScore === 10 ? "is-zenith" : ""}`}
      style={stageStyle}
      data-tone={activeTier.tone}
      data-editorial-tone={palette.toneKey}
    >
      {!compact && (
        <div className="star-stage-eyebrow-row">
          <div className="star-stage-eyebrow-title">
            <SlidersHorizontal size={13} aria-hidden="true" />
            <h4 className="rating-module-title">{titleLabel}</h4>
          </div>
          {calibration?.summaryText && (
            <span className="star-stage-percentile-pill" title={calibration.summaryText}>
              {calibration.topPercentile !== null && activeScore > 0
                ? `Top ${calibration.topPercentile}% of Vault`
                : `${calibration.ratedCount || 0} in Vault`}
            </span>
          )}
        </div>
      )}

      {/* Editorial Rolling Serif Odometer Hero Stage */}
      <div className="star-stage-hero">
        <div className="star-stage-score-block">
          <span className="star-stage-score-aura" aria-hidden="true" />
          {burstKey > 0 && (
            <span className="roulette-burst star-burst" key={burstKey} aria-hidden="true">
              {Array.from({ length: 12 }).map((_, i) => (
                <i
                  key={i}
                  style={{
                    "--a": `${(360 / 12) * i}deg`,
                    "--d": `${38 + (i % 3) * 10}px`,
                    "--s": `${i % 2 ? 4 : 3}px`
                  }}
                />
              ))}
            </span>
          )}
          <div className="star-stage-score-readout">
            <span className="star-stage-score-slot">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={activeScore}
                  className="star-stage-score-num display-title"
                  initial={{ y: rollDirection * 16, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: rollDirection * -16, opacity: 0 }}
                  transition={{ duration: 0.17, ease: [0.22, 1, 0.36, 1] }}
                >
                  {activeScore > 0 ? activeScore : "—"}
                </motion.span>
              </AnimatePresence>
            </span>
            <span className="star-stage-score-denom">/ 10</span>
          </div>
        </div>

        <div className="star-stage-verdict">
          <span className="star-stage-tier-name">{activeTier.label}</span>
          <span className="star-stage-tier-desc">{verdictDesc}</span>
        </div>

        <div className="star-stage-hero-meter" aria-hidden="true">
          <span
            className="star-stage-hero-meter-fill"
            style={{ width: `${fillPercent}%` }}
          />
        </div>
      </div>

      {/* Sculpted Ascending 10-Bar Cinema Instrument */}
      <div className="cinema-fader-housing">
        <div
          className="cinema-fader-beam"
          style={{ width: `${fillPercent}%` }}
          aria-hidden="true"
        />
        <div
          ref={trackRef}
          className="cinema-fader-radiogroup"
          role="radiogroup"
          aria-label={ariaLabel}
          onMouseLeave={() => {
            if (!dragStateRef.current.active) onHoverChange?.(0);
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        >
          {stars.map((star) => {
            const isPopped = justPickedScore === star.score && star.isSelected;
            const isActiveFocus = star.isCurrent || (!isHovering && star.isSelected);
            const barHeightPct = Math.round(30 + star.score * 7);
            return (
              <button
                key={star.score}
                type="button"
                role="radio"
                aria-checked={star.isSelected}
                tabIndex={star.tabIndex}
                aria-label={`Rate ${star.score} out of 10`}
                style={{
                  "--stagger-ms": `${star.staggerMs}ms`,
                  "--bar-h": `${barHeightPct}%`
                }}
                className={[
                  "cinema-fader-cell",
                  star.isFilled ? "is-filled" : "",
                  star.isSelected ? "is-selected" : "",
                  star.isCurrent ? "is-current" : "",
                  star.isWaveNeighbor ? "is-wave-neighbor" : "",
                  isPopped ? "is-popped" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  if (suppressClickRef.current) return;
                  handleSelectScore(star.score);
                }}
                onMouseEnter={() => {
                  if (!dragStateRef.current.active) onHoverChange?.(star.score);
                }}
                onKeyDown={(e) => handleKeyDown(e, star.score)}
                onAnimationEnd={() => {
                  if (justPickedScore === star.score) setJustPickedScore(0);
                }}
              >
                <span className="cinema-bar-well" aria-hidden="true">
                  <span className="cinema-bar-slab" />
                </span>
                <span className="cinema-fader-num tabular-num">
                  {star.score}
                  {isActiveFocus && (
                    <motion.span
                      layoutId={`cinema-fader-dot-${instanceId}`}
                      className="cinema-fader-dot"
                      transition={{ type: "spring", stiffness: 540, damping: 36 }}
                      aria-hidden="true"
                    />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Fixed-Height Zero-Shift Vault Calibration Comparison Strip */}
      {hasVaultHistory && (
        <div className="star-stage-anchors">
          <div className="star-stage-anchors-head">
            <span className="star-stage-anchors-label">Same tier in Vault</span>
            {activeScore > 0 && visibleAnchors.length > 0 && (
              <span className="star-stage-anchors-score tabular-num">{activeScore}/10</span>
            )}
          </div>
          {visibleAnchors.length > 0 ? (
            <div className="star-stage-anchors-grid">
              {visibleAnchors.map((anchor) => (
                <button
                  key={anchor.imdbID || anchor.title}
                  type="button"
                  className="star-stage-anchor-chip"
                  onClick={() => onSelectAnchor?.(anchor)}
                  title={`Inspect ${anchor.title} (${anchor.userRating}/10)`}
                >
                  <span>{anchor.title}</span>
                  <small>{anchor.userRating}/10</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="star-stage-anchors-placeholder">
              {activeScore > 0
                ? `Your first film at ${activeScore}/10 in this Vault`
                : `Scrub 1–10 to benchmark against your ${calibration.ratedCount} rated films`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
