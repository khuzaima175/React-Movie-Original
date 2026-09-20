import React from 'react';
import { motion } from 'framer-motion';

export function Tabs({ tabs, activeTab, onChange, layoutId = "default-tabs" }) {
  return (
    <div className="flex border-b border-hairline" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`relative px-4 py-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            activeTab === tab.id ? 'text-text-1' : 'text-text-3 hover:text-text-2'
          }`}
          role="tab"
          aria-selected={activeTab === tab.id}
        >
          <span className="flex items-center gap-2">
            {tab.label}
            {tab.count !== undefined && (
              <span className="text-xs font-normal text-text-3 tabular-nums">({tab.count})</span>
            )}
          </span>
          {activeTab === tab.id && (
            <motion.div
              layoutId={layoutId}
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent"
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            />
          )}
        </button>
      ))}
    </div>
  );
}

export default Tabs;
