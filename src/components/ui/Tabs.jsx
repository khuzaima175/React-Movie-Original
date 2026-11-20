import React, { useId } from "react";
import { motion } from "framer-motion";

/**
 * Editorial underline Tabs primitive with Framer Motion spring sliding hairline.
 * Plain text with subtle bottom hairline indicator and muted tabular count.
 */
export function Tabs({ tabs, activeTab, onChange, layoutIdPrefix, className = "" }) {
  const autoId = useId().replace(/:/g, "");
  const indicatorId = `${layoutIdPrefix || `cv-tabs-${autoId}`}-tab-indicator`;

  return (
    <div
      className={`cv-tabs-bar ${className}`}
      role="tablist"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`cv-tab-item ${isActive ? "is-active" : ""}`}
            role="tab"
            aria-selected={isActive}
          >
            {Icon && <Icon size={15} className="cv-tab-icon" aria-hidden="true" />}
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span className="cv-tab-count tabular-num">{tab.count}</span>
            )}
            {isActive && (
              <motion.span
                layoutId={indicatorId}
                className="cv-tab-indicator"
                transition={{ type: "spring", stiffness: 520, damping: 36 }}
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
