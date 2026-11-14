import React from "react";

/**
 * Typographic Stat primitive — large tabular numeral with quiet small label.
 * Avoids heavy boxed stat cards so posters and content own focus.
 */
export function StatCell({
  label,
  value,
  subtext,
  className = ""
}) {
  return (
    <div className={`cv-stat-item ${className}`}>
      <div className="cv-stat-value tabular-num">{value}</div>
      <div className="cv-stat-label">
        <span>{label}</span>
        {subtext && <span className="cv-stat-sub">{subtext}</span>}
      </div>
    </div>
  );
}

export default StatCell;
