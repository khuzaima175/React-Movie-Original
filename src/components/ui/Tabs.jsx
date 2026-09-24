import React from 'react';
import { motion } from 'framer-motion';

export function Tabs({ tabs, activeTab, onChange, layoutId = "default-tabs" }) {
  return (
    <div className="flex border-b border-white/10 gap-2" role="tablist">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`relative px-5 py-3 text-sm sm:text-base font-semibold transition-colors flex items-center gap-2 focus:outline-none ${
              isActive ? 'text-[#f4f4f2]' : 'text-[#8a8a86] hover:text-[#b6b6b2]'
            }`}
            role="tab"
            aria-selected={isActive}
          >
            {Icon && <Icon size={16} className={isActive ? 'text-[#e2b13c]' : 'text-[#8a8a86]'} />}
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span className="text-xs font-mono text-[#8a8a86] tabular-nums">({tab.count})</span>
            )}
            {isActive && (
              <motion.div
                layoutId={layoutId}
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#e2b13c]"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
