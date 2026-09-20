import React from 'react';
import { ChevronRight } from 'lucide-react';

export function SectionHeader({
  title,
  count,
  subtitle,
  actionLabel,
  onAction,
  actionHref,
  actionIcon: ActionIcon = ChevronRight,
  children,
  className = ''
}) {
  return (
    <div className={`group flex items-baseline justify-between gap-4 py-2 ${className}`}>
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-lg md:text-xl font-bold tracking-tight text-text-1 flex items-center gap-2">
          {title}
          {count !== undefined && (
            <span className="text-xs md:text-sm font-normal text-text-3 tabular-nums font-mono">
              ({count})
            </span>
          )}
        </h2>
        {subtitle && (
          <span className="hidden sm:inline text-xs text-text-3 font-normal">
            {subtitle}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {children}
        {actionLabel && (
          actionHref ? (
            <a
              href={actionHref}
              className="inline-flex items-center gap-1 text-xs font-semibold text-text-3 group-hover:text-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-control px-1.5 py-1"
            >
              <span>{actionLabel}</span>
              {ActionIcon && <ActionIcon size={14} className="transition-transform group-hover:translate-x-0.5" />}
            </a>
          ) : (
            <button
              onClick={onAction}
              type="button"
              className="inline-flex items-center gap-1 text-xs font-semibold text-text-3 group-hover:text-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-control px-1.5 py-1"
            >
              <span>{actionLabel}</span>
              {ActionIcon && <ActionIcon size={14} className="transition-transform group-hover:translate-x-0.5" />}
            </button>
          )
        )}
      </div>
    </div>
  );
}

export default SectionHeader;
