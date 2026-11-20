import React, { useState, useRef, useEffect, useLayoutEffect, useId, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { resolveMenuAlignment } from "../../services/navHelpers";
import { getNextSelectIndex } from "../../services/selectHelpers";

export function Select({
  value,
  onChange,
  options = [],
  id,
  ariaLabel,
  icon: Icon = null,
  align = "left",
  size = "md",
  fullWidth = false,
  className = "",
  placeholder = "Select...",
  disabled = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [coords, setCoords] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const optionRefs = useRef([]);
  const generatedId = useId();
  const listboxId = `cv-select-listbox-${generatedId.replace(/:/g, "")}`;
  const prefersReducedMotion = useReducedMotion();

  const selectedIndex = options.findIndex((opt) => String(opt.value) === String(value));
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;

  const closeMenu = useCallback((restoreFocus = false) => {
    setIsOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => {
        triggerRef.current?.focus();
      });
    }
  }, []);

  const openMenu = useCallback(
    (initialIndex) => {
      if (disabled || options.length === 0) return;
      const fallbackIdx =
        typeof initialIndex === "number" && initialIndex >= 0
          ? initialIndex
          : selectedIndex >= 0 && !options[selectedIndex]?.disabled
          ? selectedIndex
          : getNextSelectIndex(options, -1, "ArrowDown");
      setActiveIndex(fallbackIdx);
      setIsOpen(true);
    },
    [disabled, options, selectedIndex]
  );

  const commitOption = useCallback(
    (opt) => {
      if (!opt || opt.disabled) return;
      onChange?.(opt.value);
      closeMenu(true);
    },
    [onChange, closeMenu]
  );

  const updatePosition = useCallback(() => {
    const triggerEl = triggerRef.current;
    if (!triggerEl || typeof window === "undefined") return;

    const rect = triggerEl.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 12;
    const gap = 6;
    const estimatedPanelWidth = Math.min(
      Math.max(rect.width, panelRef.current?.offsetWidth || 184),
      viewportWidth - margin * 2
    );
    const resolvedAlign = resolveMenuAlignment(align, rect, viewportWidth, estimatedPanelWidth);
    const rawLeft =
      resolvedAlign === "right" ? rect.right - estimatedPanelWidth : rect.left;
    const clampedLeft = Math.max(
      margin,
      Math.min(rawLeft, viewportWidth - estimatedPanelWidth - margin)
    );

    const maxPanelHeight = Math.min(300, viewportHeight - margin * 2);
    const estimatedHeight = Math.min(
      panelRef.current?.offsetHeight || Math.max(88, options.length * 38 + 14),
      maxPanelHeight
    );
    const spaceBelow = viewportHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const openAbove = spaceBelow < Math.min(estimatedHeight, 180) && spaceAbove > spaceBelow;

    const top = openAbove
      ? Math.max(margin, rect.top - Math.min(estimatedHeight, spaceAbove) - gap)
      : Math.min(rect.bottom + gap, viewportHeight - margin - 80);

    const availableHeight = openAbove
      ? Math.min(maxPanelHeight, Math.max(100, spaceAbove - gap))
      : Math.min(maxPanelHeight, Math.max(100, spaceBelow - gap));

    setCoords({
      top,
      left: clampedLeft,
      minWidth: Math.min(Math.max(rect.width, 168), viewportWidth - margin * 2),
      maxHeight: availableHeight,
      openAbove,
      resolvedAlign,
    });
  }, [align, options.length]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setCoords(null);
      return;
    }
    updatePosition();
  }, [isOpen, updatePosition]);

  // Second pass once the portaled panel mounts so actual rendered width is clamped safely on 390px mobile
  useLayoutEffect(() => {
    if (!isOpen || !coords || !panelRef.current) return;
    updatePosition();
  }, [isOpen, Boolean(coords), updatePosition]);

  // Keep panel anchored if window scrolls/resizes (ignoring scroll inside listbox itself)
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleResize = () => updatePosition();
    const handleScroll = (e) => {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      updatePosition();
    };
    const handleOutside = (e) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target)
      ) {
        closeMenu(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeMenu(true);
        return;
      }
      if (e.key === "Tab") {
        closeMenu(false);
        return;
      }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        setActiveIndex((prev) => getNextSelectIndex(options, prev, e.key));
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const opt = options[activeIndex];
        if (opt && !opt.disabled) {
          commitOption(opt);
        }
      }
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);
    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen, options, activeIndex, updatePosition, closeMenu, commitOption]);

  // Scroll highlighted option into view when navigating with keyboard
  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    const node = optionRefs.current[activeIndex];
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [isOpen, activeIndex]);

  const handleTriggerKeyDown = (e) => {
    if (disabled) return;
    if (!isOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        openMenu(getNextSelectIndex(options, selectedIndex, "ArrowDown"));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        openMenu(getNextSelectIndex(options, selectedIndex, "ArrowUp"));
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
    }
  };

  const activeOptionId =
    isOpen && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined;

  const panelContent = (
    <AnimatePresence>
      {isOpen && coords && (
        <motion.div
          ref={panelRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          initial={
            prefersReducedMotion
              ? { opacity: 0 }
              : { opacity: 0, scale: 0.97, y: coords.openAbove ? 6 : -6 }
          }
          animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
          exit={
            prefersReducedMotion
              ? { opacity: 0 }
              : { opacity: 0, scale: 0.97, y: coords.openAbove ? 4 : -4 }
          }
          transition={{ duration: prefersReducedMotion ? 0.08 : 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="cv-select-panel"
          style={{
            position: "fixed",
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            minWidth: `${coords.minWidth}px`,
            maxHeight: `${coords.maxHeight}px`,
            transformOrigin: `${coords.openAbove ? "bottom" : "top"} ${coords.resolvedAlign}`,
          }}
        >
          {options.map((opt, idx) => {
            const isSelected = String(opt.value) === String(value);
            const isActive = idx === activeIndex;
            return (
              <button
                key={`${String(opt.value)}-${idx}`}
                ref={(el) => {
                  optionRefs.current[idx] = el;
                }}
                id={`${listboxId}-opt-${idx}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={Boolean(opt.disabled)}
                className={`cv-select-option ${isSelected ? "is-selected" : ""} ${
                  isActive ? "is-active" : ""
                }`}
                onMouseEnter={() => {
                  if (!opt.disabled) setActiveIndex(idx);
                }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commitOption(opt)}
              >
                <span className="cv-select-option-text">
                  <span className="cv-select-option-label">{opt.label}</span>
                  {opt.sublabel && (
                    <span className="cv-select-option-sublabel">{opt.sublabel}</span>
                  )}
                </span>
                {isSelected && (
                  <Check size={14} className="cv-select-check" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div
      className={`cv-select-root ${fullWidth ? "is-full-width" : ""} ${className}`.trim()}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={activeOptionId}
        aria-label={ariaLabel}
        onClick={() => (isOpen ? closeMenu(false) : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        className={`cv-select-trigger cv-select-${size} ${isOpen ? "is-open" : ""}`}
      >
        {Icon && <Icon size={size === "sm" ? 13 : 14} className="cv-select-icon" aria-hidden="true" />}
        <span className="cv-select-value">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          size={14}
          className={`cv-select-chevron ${isOpen ? "is-open" : ""}`}
          aria-hidden="true"
        />
      </button>

      {typeof document !== "undefined" ? createPortal(panelContent, document.body) : null}
    </div>
  );
}

export default Select;
