import React from 'react';

export function Tabs({ tabs, activeTab, onChange }) {
  return (
    <div
      style={{
        display: "flex",
        background: "#1c1d20",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: "1.2rem",
        padding: "0.5rem",
        gap: "0.6rem",
        width: "100%",
        marginBottom: "2.2rem"
      }}
      role="tablist"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              position: "relative",
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.8rem",
              padding: "1.1rem 1.8rem",
              borderRadius: "0.8rem",
              fontSize: "1.45rem",
              fontWeight: 600,
              background: isActive ? "#242528" : "transparent",
              color: isActive ? "#f4f4f2" : "#8a8a86",
              border: isActive ? "1px solid rgba(226, 177, 60, 0.35)" : "1px solid transparent",
              boxShadow: isActive ? "0 2px 10px rgba(0, 0, 0, 0.45)" : "none",
              cursor: "pointer",
              transition: "all 0.2s ease"
            }}
            className={!isActive ? "hover:text-[#f4f4f2] hover:bg-white/[0.04]" : ""}
            role="tab"
            aria-selected={isActive}
          >
            {Icon && (
              <Icon
                size={16}
                style={{ color: isActive ? "#e2b13c" : "#8a8a86", transition: "color 0.2s" }}
              />
            )}
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span
                style={{
                  fontSize: "1.2rem",
                  fontFamily: "monospace",
                  color: isActive ? "#e2b13c" : "#8a8a86",
                  background: "rgba(255, 255, 255, 0.06)",
                  padding: "0.1rem 0.6rem",
                  borderRadius: "0.4rem"
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
