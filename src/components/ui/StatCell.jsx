import React from 'react';

export function StatCell({
  label,
  value,
  delta,
  icon: Icon,
  subtext,
  className = ''
}) {
  return (
    <div
      className={`flex flex-col justify-between rounded-card border border-hairline bg-surface-1 p-4 transition-colors hover:border-hairline-strong ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-3">
          {label}
        </span>
        {Icon && <Icon size={16} className="text-text-3" aria-hidden="true" />}
      </div>

      <div className="mt-2">
        <div className="text-2xl font-bold tracking-tight text-text-1 tabular-nums font-mono">
          {value}
        </div>

        {(delta || subtext) && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-text-3">
            {delta && <span className="text-accent font-medium">{delta}</span>}
            {subtext && <span>{subtext}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export default StatCell;
