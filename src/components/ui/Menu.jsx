import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';
import { resolveMenuAlignment } from '../../services/navHelpers';

const MenuContext = createContext(null);

export function Menu({ children, className = '' }) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const close = useCallback((restoreFocus = false) => {
    setIsOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => {
        triggerRef.current?.focus();
      });
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleClickOutside = (e) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target)
      ) {
        close(false);
      }
    };
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    };

    document.addEventListener('pointerdown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, close]);

  return (
    <MenuContext.Provider value={{ isOpen, toggle, close, triggerRef, panelRef }}>
      <div className={`relative inline-block text-left ${className}`.trim()}>{children}</div>
    </MenuContext.Provider>
  );
}

Menu.Trigger = function MenuTrigger({ children, className = '', ...props }) {
  const { isOpen, toggle, triggerRef } = useContext(MenuContext);
  return (
    <button
      ref={triggerRef}
      type="button"
      onClick={toggle}
      aria-haspopup="menu"
      aria-expanded={isOpen}
      className={
        className ||
        'inline-flex items-center gap-[0.6rem] text-[1.35rem] font-medium text-text-2 hover:text-text-1 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-accent rounded-control'
      }
      {...props}
    >
      {children}
    </button>
  );
};

Menu.Panel = function MenuPanel({ children, align = 'right' }) {
  const { isOpen, triggerRef, panelRef } = useContext(MenuContext);
  const [coords, setCoords] = useState(null);

  const updatePosition = useCallback(() => {
    const triggerEl = triggerRef.current;
    if (!triggerEl || typeof window === 'undefined') return;

    const rect = triggerEl.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 12;
    const gap = 8;
    const maxAllowedWidth = Math.max(200, Math.min(300, viewportWidth - margin * 2));
    const measuredWidth = panelRef.current?.offsetWidth || 260;
    const effectiveWidth = Math.min(measuredWidth, maxAllowedWidth);

    const resolvedAlign = resolveMenuAlignment(align, rect, viewportWidth, effectiveWidth);
    const rawLeft = resolvedAlign === 'right' ? rect.right - effectiveWidth : rect.left;
    const clampedLeft = Math.max(
      margin,
      Math.min(rawLeft, viewportWidth - effectiveWidth - margin)
    );

    const estimatedHeight = panelRef.current?.offsetHeight || 240;
    const spaceBelow = viewportHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const openAbove = spaceBelow < Math.min(estimatedHeight, 220) && spaceAbove > spaceBelow;

    const top = openAbove
      ? Math.max(margin, rect.top - Math.min(estimatedHeight, spaceAbove) - gap)
      : Math.min(rect.bottom + gap, Math.max(margin, viewportHeight - margin - 120));

    const maxHeight = openAbove
      ? Math.max(140, spaceAbove - gap)
      : Math.max(140, spaceBelow - gap);

    setCoords({
      top,
      left: clampedLeft,
      maxWidth: maxAllowedWidth,
      maxHeight,
      openAbove,
      resolvedAlign
    });
  }, [align, triggerRef, panelRef]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setCoords(null);
      return;
    }
    updatePosition();
  }, [isOpen, updatePosition]);

  useLayoutEffect(() => {
    if (!isOpen || !coords || !panelRef.current) return;
    updatePosition();
  }, [isOpen, Boolean(coords), updatePosition, panelRef]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleResize = () => updatePosition();
    const handleScroll = (e) => {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      updatePosition();
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen, updatePosition, panelRef]);

  const panelNode = (
    <AnimatePresence>
      {isOpen && coords && (
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, scale: 0.96, y: coords.openAbove ? 6 : -6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: coords.openAbove ? 6 : -6 }}
          transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
          style={{
            position: 'fixed',
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            minWidth: `${Math.min(248, coords.maxWidth)}px`,
            maxWidth: `${coords.maxWidth}px`,
            maxHeight: `${coords.maxHeight}px`,
            transformOrigin: `${coords.openAbove ? 'bottom' : 'top'} ${coords.resolvedAlign}`
          }}
          className="z-[10010] overflow-y-auto overscroll-contain rounded-[12px] bg-[#16181e] border border-white/12 shadow-[0_18px_42px_rgba(0,0,0,0.8)] focus:outline-none p-[0.65rem]"
          role="menu"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(panelNode, document.body);
  }
  return panelNode;
};

Menu.Item = function MenuItem({ children, onClick, icon: Icon, danger = false }) {
  const { close } = useContext(MenuContext);
  return (
    <button
      type="button"
      className={`group flex w-full min-w-0 items-center gap-[1.05rem] rounded-[6px] px-[1.15rem] py-[0.95rem] text-[1.35rem] font-medium transition-colors focus:outline-none text-left cursor-pointer ${
        danger
          ? 'text-[#e5484d] hover:bg-[#e5484d]/10 focus:bg-[#e5484d]/10'
          : 'text-[#c8c7c1] hover:bg-white/[0.06] hover:text-[#f3f1eb] focus:bg-white/[0.06] focus:text-[#f3f1eb]'
      }`}
      role="menuitem"
      onClick={(e) => {
        onClick?.(e);
        close(false);
      }}
    >
      {Icon && (
        <Icon
          size={16}
          className={`${danger ? 'text-[#e5484d]' : 'text-[#6e6d68] group-hover:text-[#f3f1eb]'} transition-colors shrink-0`}
          aria-hidden="true"
        />
      )}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
};

Menu.CheckboxItem = function MenuCheckboxItem({ children, checked, onChange }) {
  return (
    <button
      type="button"
      className="flex w-full min-w-0 items-center justify-between gap-[1.05rem] rounded-[6px] px-[1.15rem] py-[0.95rem] text-[1.35rem] font-medium text-[#c8c7c1] hover:bg-white/[0.06] hover:text-[#f3f1eb] transition-colors focus:outline-none focus:bg-white/[0.06] cursor-pointer"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="min-w-0 truncate">{children}</span>
      {checked && <Check size={16} className="text-[#f3f1eb] shrink-0" aria-hidden="true" />}
    </button>
  );
};

Menu.Divider = function MenuDivider() {
  return <div className="my-[0.55rem] mx-[0.65rem] h-px bg-white/10" role="separator" />;
};

Menu.Label = function MenuLabel({ children }) {
  return (
    <div className="px-[1.15rem] pt-[0.65rem] pb-[0.55rem] text-[1.1rem] font-semibold uppercase tracking-[0.09em] text-[#8a8a86]">
      {children}
    </div>
  );
};

export default Menu;
