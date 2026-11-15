import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { computeStarStageMetrics } from "../services/ratingStudioService";
import { getRatingTier } from "../services/ratingTiers";

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
  const [justPickedScore, setJustPickedScore] = useState(0);

  const metrics = computeStarStageMetrics(value, hoverValue);
  const { activeScore, fillPercent, isHovering, stars } = metrics;
  const activeTier = getRatingTier(activeScore);

  function handleSelectScore(score) {
    setJustPickedScore(score);
    onChange?.(score);
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
    "--tier-color": activeTier.color,
    "--tier-bg": activeTier.bg,
    "--tier-border": activeTier.border,
    "--tier-glow": activeTier.glow !== "none" ? activeTier.glow : "0 0 16px rgba(255, 255, 255, 0.08)"
  };

  return (
    <div
      className={`star-rating-stage ${compact ? "is-compact" : ""} ${activeScore > 0 ? "has-score" : "is-unrated"} ${isHovering ? "is-scrubbing" : ""}`}
      style={stageStyle}
      data-tone={activeTier.tone}
    >
      {!compact && (
        <div className="star-stage-eyebrow-row">
          <div className="star-stage-eyebrow-title">
            <SlidersHorizontal size={14} aria-hidden="true" />
            <h4 className="rating-module-title">{titleLabel}</h4>
          </div>
          {calibration?.summaryText && (
            <span className="star-stage-percentile-pill" title={calibration.summaryText}>
              {calibration.topPercentile !== null && activeScore > 0
                ? `Top ${calibration.topPercentile}% of Vault`
                : `${calibration.ratedCount || 0} Vaultrated`.replace("Vaultrated", "in Vault")}
            </span>
          )}
        </div>
      )}

      {/* Unified Atmospheric Hero Score Stage (Zero OS Emojis) */}
      <div className="star-stage-hero">
        <div className="star-stage-score-block">
          <div className="star-stage-crest" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="star-stage-crest-svg">
              <path
                d="M12 2.25l2.92 6.08 6.68.92-4.86 4.68 1.18 6.64L12 17.38l-5.92 3.19 1.18-6.64-4.86-4.68 6.68-.92L12 2.25z"
                fill={activeScore > 0 ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="star-stage-score-readout">
            <span className="star-stage-score-num">
              {activeScore > 0 ? activeScore : "—"}
            </span>
            <span className="star-stage-score-denom">/ 10</span>
          </div>
        </div>

        <div className="star-stage-verdict">
          <span className="star-stage-tier-name">{activeTier.label}</span>
          <span className="star-stage-tier-desc">
            {!compact && calibration?.summaryText && activeScore > 0
              ? calibration.summaryText
              : activeTier.desc}
          </span>
        </div>
      </div>

      {/* 10-Star Wave-Cascade Track + Synchronized Light Rail */}
      <div className="star-stage-track-wrap">
        <div
          className="star-stage-radiogroup"
          role="radiogroup"
          aria-label={ariaLabel}
          onMouseLeave={() => onHoverChange?.(0)}
        >
          <div className="star-stage-rail" aria-hidden="true">
            <span
              className="star-stage-rail-fill"
              style={{ width: `${fillPercent}%` }}
            />
          </div>

          {stars.map((star) => {
            const isPopped = justPickedScore === star.score && star.isSelected;
            return (
              <button
                key={star.score}
                type="button"
                role="radio"
                aria-checked={star.isSelected}
                tabIndex={star.tabIndex}
                aria-label={`Rate ${star.score} out of 10`}
                style={{ "--stagger-ms": `${star.staggerMs}ms` }}
                className={[
                  "star-stage-btn",
                  star.isFilled ? "is-filled" : "",
                  star.isSelected ? "is-selected" : "",
                  star.isCurrent ? "is-current" : "",
                  star.isWaveNeighbor ? "is-wave-neighbor" : "",
                  isPopped ? "is-popped" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => handleSelectScore(star.score)}
                onMouseEnter={() => onHoverChange?.(star.score)}
                onKeyDown={(e) => handleKeyDown(e, star.score)}
                onAnimationEnd={() => {
                  if (justPickedScore === star.score) setJustPickedScore(0);
                }}
              >
                <span className="star-stage-icon-wrap" aria-hidden="true">
                  <svg viewBox="0 0 24 24" className="star-stage-svg">
                    <path
                      className="star-stage-svg-outer"
                      d="M12 2.4l2.86 5.95 6.54.9-4.76 4.58 1.15 6.5L12 17.22l-5.79 3.11 1.15-6.5-4.76-4.58 6.54-.9L12 2.4z"
                    />
                    {star.isFilled && (
                      <path
                        className="star-stage-svg-glint"
                        d="M12 4.6l2.05 4.28 4.68.64-3.4 3.28.82 4.65L12 15.22V4.6z"
                      />
                    )}
                  </svg>
                </span>
                <span className={`star-stage-node ${star.isFilled ? "is-lit" : ""}`} aria-hidden="true" />
                <span className="star-stage-num">{star.score}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* De-boxed Inline Vault Calibration Anchors */}
      {!compact && calibration?.anchorMovies?.length > 0 && (
        <div className="star-stage-anchors">
          <span className="star-stage-anchors-label">Same tier in Vault:</span>
          <div className="star-stage-anchors-list">
            {calibration.anchorMovies.map((anchor) => (
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
        </div>
      )}
    </div>
  );
}
