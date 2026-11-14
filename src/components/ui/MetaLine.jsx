import React from "react";
import { Star } from "lucide-react";

/**
 * Editorial inline metadata row joined by clean middle dots (`·`).
 * Keeps rating stars in gold (`--accent`) and all surrounding facts neutral.
 */
export function MetaLine({
  items = [],
  rating = null,
  ratingTone = "neutral",
  className = ""
}) {
  const validItems = (items || []).filter(
    (item) => item !== null && item !== undefined && String(item).trim() !== "" && item !== "N/A"
  );
  const hasRating = rating !== null && rating !== undefined && String(rating).trim() !== "" && String(rating) !== "N/A";

  if (validItems.length === 0 && !hasRating) return null;

  const isGoldRating = ratingTone === "gold";

  return (
    <div className={`cv-meta-line ${className}`}>
      {validItems.map((item, idx) => (
        <React.Fragment key={`${item}-${idx}`}>
          {idx > 0 && (
            <span className="cv-meta-dot" aria-hidden="true">
              ·
            </span>
          )}
          <span>{item}</span>
        </React.Fragment>
      ))}
      {hasRating && (
        <>
          {validItems.length > 0 && (
            <span className="cv-meta-dot" aria-hidden="true">
              ·
            </span>
          )}
          <span className={`cv-meta-rating tabular-num ${isGoldRating ? "is-gold" : "is-neutral"}`}>
            <Star
              size={13}
              className={isGoldRating ? "cv-rating-star" : "cv-rating-star-neutral"}
              fill="currentColor"
              aria-hidden="true"
            />
            <span>{rating}</span>
          </span>
        </>
      )}
    </div>
  );
}

export default MetaLine;
