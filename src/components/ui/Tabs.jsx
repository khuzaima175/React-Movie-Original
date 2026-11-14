import React from "react";

/**
 * Editorial underline Tabs primitive.
 * Plain text with subtle bottom hairline indicator and muted tabular count.
 */
export function Tabs({ tabs, activeTab, onChange, className = "" }) {
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
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
