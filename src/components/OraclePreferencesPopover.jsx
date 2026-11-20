import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Tv,
  SlidersHorizontal,
  KeyRound,
  Globe,
  Sparkles,
  Loader2,
  Plus,
  Check,
  X,
  Pin,
  Pencil,
  Trash2,
  ShieldCheck
} from "lucide-react";
import { AVAILABLE_REGIONS, POPULAR_WATCH_PROVIDERS } from "../services/tmdbService";
import { MAX_TASTE_RULES, MAX_RULE_TEXT_LENGTH } from "../services/tasteRulesService";
import { resolveMenuAlignment } from "../services/navHelpers";
import { Button, Select } from "./ui";

const TABS = [
  { id: "streaming", label: "Streaming", icon: Tv },
  { id: "rules", label: "Taste Rules", icon: SlidersHorizontal },
  { id: "key", label: "AI Key", icon: KeyRound }
];

export default function OraclePreferencesPopover({
  isOpen,
  onClose,
  triggerRef,
  userRegion = "GLOBAL",
  setUserRegion,
  userWatchProviders = [],
  setUserWatchProviders,
  toggleWatchProvider,
  tasteRules = [],
  onAddRule,
  onToggleRule,
  onEditRule,
  onDeleteRule,
  onPinRule,
  onAutoDraft,
  isDraftingRules = false,
  watchedCount = 0,
  usingOwnKey = false,
  onOpenKeyModal,
  initialTab = "streaming"
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [newRulePolarity, setNewRulePolarity] = useState("prefer");
  const [newRuleText, setNewRuleText] = useState("");
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [editingRuleText, setEditingRuleText] = useState("");
  const [isMobileSheet, setIsMobileSheet] = useState(false);
  const [coords, setCoords] = useState(null);
  const panelRef = useRef(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  const updatePosition = useCallback(() => {
    if (typeof window === "undefined") return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const mobile = vw <= 640;
    setIsMobileSheet(mobile);
    if (mobile) {
      setCoords(null);
      return;
    }

    const triggerEl = triggerRef?.current;
    if (!triggerEl) {
      setCoords({ top: 120, left: Math.max(16, (vw - 460) / 2), width: Math.min(460, vw - 32), align: "right" });
      return;
    }

    const rect = triggerEl.getBoundingClientRect();
    const margin = 16;
    const panelWidth = Math.min(460, vw - margin * 2);
    const resolvedAlign = resolveMenuAlignment("right", rect, vw, panelWidth);
    const rawLeft = resolvedAlign === "right" ? rect.right - panelWidth : rect.left;
    const left = Math.max(margin, Math.min(rawLeft, vw - panelWidth - margin));

    const maxPanelHeight = Math.min(540, vh - margin * 2);
    const spaceBelow = vh - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const openAbove = spaceBelow < 320 && spaceAbove > spaceBelow;
    const top = openAbove
      ? Math.max(margin, rect.top - Math.min(maxPanelHeight, spaceAbove) - 8)
      : Math.min(rect.bottom + 8, vh - margin - 260);
    const maxHeight = openAbove
      ? Math.min(maxPanelHeight, Math.max(260, spaceAbove - 8))
      : Math.min(maxPanelHeight, Math.max(260, spaceBelow - 8));

    setCoords({ top, left, width: panelWidth, maxHeight, openAbove, align: resolvedAlign });
  }, [triggerRef]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleResize = () => updatePosition();
    const handleScroll = (e) => {
      if (panelRef.current?.contains(e.target)) return;
      if (e.target?.closest?.(".cv-select-panel")) return;
      updatePosition();
    };
    const handleOutside = (e) => {
      if (panelRef.current?.contains(e.target)) return;
      if (triggerRef?.current?.contains(e.target)) return;
      // Ignore clicks inside portaled <Select> dropdown listboxes
      if (e.target?.closest?.(".cv-select-panel")) return;
      onClose?.();
    };
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
        requestAnimationFrame(() => triggerRef?.current?.focus());
      }
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);
    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [isOpen, onClose, triggerRef, updatePosition]);

  const handleAddRuleSubmit = (e) => {
    e.preventDefault();
    const cleaned = newRuleText.trim();
    if (!cleaned || !onAddRule) return;
    onAddRule(cleaned, newRulePolarity);
    setNewRuleText("");
  };

  const handleSaveRuleEdit = (ruleId) => {
    const cleaned = editingRuleText.trim();
    if (cleaned && onEditRule) {
      onEditRule(ruleId, { text: cleaned });
    }
    setEditingRuleId(null);
    setEditingRuleText("");
  };

  const activeRulesCount = (tasteRules || []).filter((r) => r.active !== false).length;
  const streamingCount = (userRegion !== "GLOBAL" ? 1 : 0) + (userWatchProviders.length > 0 ? 1 : 0);

  const body = (
    <AnimatePresence>
      {isOpen && (
        <>
          {isMobileSheet && (
            <motion.div
              className="oracle-prefs-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              onClick={onClose}
              aria-hidden="true"
            />
          )}

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-label="Film Oracle Filters and Rules"
            className={`oracle-prefs-popover ${isMobileSheet ? "is-mobile-sheet" : ""}`}
            style={
              !isMobileSheet && coords
                ? {
                    position: "fixed",
                    top: `${coords.top}px`,
                    left: `${coords.left}px`,
                    width: `${coords.width}px`,
                    maxHeight: `${coords.maxHeight}px`,
                    transformOrigin: `${coords.openAbove ? "bottom" : "top"} ${coords.align}`
                  }
                : undefined
            }
            initial={
              prefersReducedMotion
                ? { opacity: 0 }
                : isMobileSheet
                ? { opacity: 0, y: 28 }
                : { opacity: 0, scale: 0.97, y: coords?.openAbove ? 6 : -6 }
            }
            animate={
              prefersReducedMotion
                ? { opacity: 1 }
                : isMobileSheet
                ? { opacity: 1, y: 0 }
                : { opacity: 1, scale: 1, y: 0 }
            }
            exit={
              prefersReducedMotion
                ? { opacity: 0 }
                : isMobileSheet
                ? { opacity: 0, y: 24 }
                : { opacity: 0, scale: 0.97, y: coords?.openAbove ? 4 : -4 }
            }
            transition={{ duration: prefersReducedMotion ? 0.08 : 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {isMobileSheet && <div className="oracle-prefs-sheet-handle" aria-hidden="true" />}

            <div className="oracle-prefs-header">
              <div className="oracle-prefs-tabs" role="tablist" aria-label="Oracle Preferences">
                {TABS.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  const badge =
                    tab.id === "streaming"
                      ? streamingCount
                      : tab.id === "rules"
                      ? activeRulesCount
                      : usingOwnKey
                      ? 1
                      : 0;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={`oracle-prefs-tab ${isActive ? "is-active" : ""}`}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="oracle-prefs-tab-bg"
                          className="oracle-prefs-tab-bg"
                          transition={{ type: "spring", stiffness: 460, damping: 34 }}
                        />
                      )}
                      <Icon size={13} className="oracle-prefs-tab-icon" aria-hidden="true" />
                      <span className="oracle-prefs-tab-label">{tab.label}</span>
                      {badge > 0 && (
                        <span className="oracle-prefs-tab-count tabular-num">{badge}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                className="oracle-prefs-close"
                onClick={onClose}
                aria-label="Close Filters and Rules"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="oracle-prefs-body">
              {activeTab === "streaming" && (
                <div className="oracle-prefs-pane">
                  <div className="streaming-toolbar-row">
                    <div className="streaming-region-select">
                      <Select
                        value={userRegion}
                        onChange={(val) => setUserRegion?.(val)}
                        ariaLabel="Select Streaming Region"
                        icon={Globe}
                        size="sm"
                        fullWidth
                        options={AVAILABLE_REGIONS.map((reg) => ({
                          value: reg.code,
                          label: reg.name,
                          sublabel: reg.code === "GLOBAL" ? "All regions" : reg.code
                        }))}
                      />
                    </div>

                    <div className="streaming-quick-links">
                      <button
                        type="button"
                        className="streaming-link-btn"
                        onClick={() =>
                          setUserWatchProviders?.(POPULAR_WATCH_PROVIDERS.map((p) => p.id))
                        }
                      >
                        Select all
                      </button>
                      <span aria-hidden="true">·</span>
                      <button
                        type="button"
                        className="streaming-link-btn"
                        onClick={() => setUserWatchProviders?.([])}
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  {userRegion === "GLOBAL" && userWatchProviders.length > 0 && (
                    <p className="mood-parse-note">
                      Choose a specific country above for accurate local streaming availability.
                    </p>
                  )}

                  <div className="streaming-providers-grid oracle-prefs-providers-grid">
                    <button
                      type="button"
                      className={`streaming-provider-btn ${
                        userWatchProviders.length === 0 ? "active" : ""
                      }`}
                      onClick={() => setUserWatchProviders?.([])}
                    >
                      <Globe size={13} aria-hidden="true" />
                      <span>All Platforms</span>
                    </button>

                    {POPULAR_WATCH_PROVIDERS.map((provider) => {
                      const isSelected = userWatchProviders.includes(provider.id);
                      return (
                        <button
                          key={provider.id}
                          type="button"
                          className={`streaming-provider-btn ${isSelected ? "active" : ""}`}
                          onClick={() => toggleWatchProvider?.(provider.id)}
                        >
                          <span>{provider.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeTab === "rules" && (
                <div className="oracle-prefs-pane">
                  <div className="oracle-prefs-rules-head">
                    <p className="oracle-prefs-hint">
                      Persistent Prefer or Avoid constraints applied to every recommendation run.
                    </p>
                    <button
                      type="button"
                      className="taste-rules-draft-btn"
                      onClick={onAutoDraft}
                      disabled={isDraftingRules || watchedCount === 0}
                      title={
                        watchedCount === 0
                          ? "Rate at least 1 film to auto-draft rules"
                          : "Synthesize Prefer/Avoid rules from your rated Vault"
                      }
                    >
                      {isDraftingRules ? (
                        <Loader2 size={13} className="spin-icon" aria-hidden="true" />
                      ) : (
                        <Sparkles size={13} aria-hidden="true" />
                      )}
                      <span>{isDraftingRules ? "Drafting..." : "Auto-Draft from Vault"}</span>
                    </button>
                  </div>

                  <form className="taste-rule-form" onSubmit={handleAddRuleSubmit}>
                    <div className="rule-polarity-switch" role="group" aria-label="Rule polarity">
                      <button
                        type="button"
                        className={`polarity-btn ${
                          newRulePolarity === "prefer" ? "is-selected prefer" : ""
                        }`}
                        onClick={() => setNewRulePolarity("prefer")}
                      >
                        Prefer
                      </button>
                      <button
                        type="button"
                        className={`polarity-btn ${
                          newRulePolarity === "avoid" ? "is-selected avoid" : ""
                        }`}
                        onClick={() => setNewRulePolarity("avoid")}
                      >
                        Avoid
                      </button>
                    </div>
                    <input
                      type="text"
                      className="taste-rule-input"
                      maxLength={MAX_RULE_TEXT_LENGTH}
                      value={newRuleText}
                      onChange={(e) => setNewRuleText(e.target.value)}
                      placeholder={
                        newRulePolarity === "avoid"
                          ? 'e.g. "No slow-burn period dramas"'
                          : 'e.g. "Cyberpunk noir under 130m"'
                      }
                      aria-label="New Taste Rule"
                    />
                    <Button
                      type="submit"
                      variant="secondary"
                      size="sm"
                      disabled={!newRuleText.trim() || (tasteRules || []).length >= MAX_TASTE_RULES}
                    >
                      <Plus size={13} aria-hidden="true" />
                      <span>Add</span>
                    </Button>
                  </form>

                  {(tasteRules || []).length === 0 ? (
                    <p className="taste-rules-empty">
                      No custom rules yet. Add up to {MAX_TASTE_RULES} constraints, or auto-draft from your Vault.
                    </p>
                  ) : (
                    <ul className="taste-rules-list">
                      {(tasteRules || []).map((rule) => (
                        <li
                          key={rule.id}
                          className={`taste-rule-item is-${rule.polarity} ${
                            rule.active !== false ? "is-active" : "is-inactive"
                          }`}
                        >
                          {editingRuleId === rule.id ? (
                            <div className="taste-rule-edit-row">
                              <input
                                type="text"
                                className="taste-rule-input"
                                maxLength={MAX_RULE_TEXT_LENGTH}
                                value={editingRuleText}
                                onChange={(e) => setEditingRuleText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    handleSaveRuleEdit(rule.id);
                                  } else if (e.key === "Escape") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setEditingRuleId(null);
                                  }
                                }}
                                autoFocus
                              />
                              <button
                                type="button"
                                className="rule-icon-btn"
                                onClick={() => handleSaveRuleEdit(rule.id)}
                                aria-label="Save rule edit"
                              >
                                <Check size={13} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="rule-icon-btn"
                                onClick={() => setEditingRuleId(null)}
                                aria-label="Cancel rule edit"
                              >
                                <X size={13} aria-hidden="true" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="taste-rule-toggle-main"
                                onClick={() => onToggleRule?.(rule.id)}
                                title={
                                  rule.active !== false
                                    ? "Click to pause rule"
                                    : "Click to enable rule"
                                }
                              >
                                <span className="rule-polarity-tag">
                                  {rule.polarity === "avoid" ? "Avoid" : "Prefer"}
                                </span>
                                <span className="rule-text-span">{rule.text}</span>
                              </button>
                              <div className="taste-rule-item-actions">
                                <button
                                  type="button"
                                  className={`rule-icon-btn ${rule.pinned ? "is-pinned" : ""}`}
                                  onClick={() => onPinRule?.(rule.id)}
                                  aria-label={rule.pinned ? "Unpin rule" : "Pin rule"}
                                  title={rule.pinned ? "Pinned to prompt top" : "Pin rule"}
                                >
                                  <Pin size={13} aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  className="rule-icon-btn"
                                  onClick={() => {
                                    setEditingRuleId(rule.id);
                                    setEditingRuleText(rule.text);
                                  }}
                                  aria-label="Edit rule"
                                  title="Edit rule"
                                >
                                  <Pencil size={13} aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  className="rule-icon-btn danger"
                                  onClick={() => onDeleteRule?.(rule.id)}
                                  aria-label="Delete rule"
                                  title="Delete rule"
                                >
                                  <Trash2 size={13} aria-hidden="true" />
                                </button>
                              </div>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {activeTab === "key" && (
                <div className="oracle-prefs-pane oracle-prefs-key-pane">
                  <div className="oracle-key-status-card">
                    <div className="oracle-key-status-head">
                      <ShieldCheck size={16} aria-hidden="true" />
                      <strong>
                        {usingOwnKey ? "Personal API Key Active" : "Shared Free Pool Active"}
                      </strong>
                    </div>
                    <p className="oracle-prefs-hint">
                      {usingOwnKey
                        ? "Your browser-stored personal Gemini key is active for Oracle curation and Film Companion chats. Keys are never stored on our servers."
                        : "CinemaVault includes a built-in shared AI quota. Connect your own free Google AI Studio key anytime for dedicated high-volume requests."}
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        onClose?.();
                        onOpenKeyModal?.();
                      }}
                    >
                      <KeyRound size={13} aria-hidden="true" />
                      <span>{usingOwnKey ? "Manage Personal Key" : "Add Personal AI Key"}</span>
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="oracle-prefs-footer">
              <span className="oracle-prefs-footer-note">
                Changes apply automatically to your next picks.
              </span>
              <Button type="button" variant="primary" size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return typeof document !== "undefined" ? createPortal(body, document.body) : null;
}
