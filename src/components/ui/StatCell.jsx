import React from "react";
import AnimatedNumber from "./AnimatedNumber";

/**
 * Typographic Stat primitive — large tabular numeral with quiet small label.
 * Avoids heavy boxed stat cards so posters and content own focus.
 * String/number values count up on first view; element values render as-is.
 */
export function StatCell({
  label,
  value,
  subtext,
  className = ""
}) {
  const isPlain = typeof value === "string" || typeof value === "number";
  return (
    <div className={`cv-stat-item ${className}`}>
      <div className="cv-stat-value tabular-num">
        {isPlain ? <AnimatedNumber value={value} /> : value}
      </div>
      <div className="cv-stat-label">
        <span>{label}</span>
        {subtext && <span className="cv-stat-sub">{subtext}</span>}
      </div>
    </div>
  );
}

export default StatCell;
