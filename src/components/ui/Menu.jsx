import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';

const MenuContext = createContext(null);

export function Menu({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  const toggle = () => setIsOpen((prev) => !prev);
  const close = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target) && 
          triggerRef.current && !triggerRef.current.contains(e.target)) {
        close();
      }
    };
    const handleEsc = (e) => { if (e.key === 'Escape') close(); };
    
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen]);

  return (
    <MenuContext.Provider value={{ isOpen, toggle, close, triggerRef, panelRef }}>
      <div className="relative inline-block text-left">{children}</div>
    </MenuContext.Provider>
  );
}

Menu.Trigger = function MenuTrigger({ children, ...props }) {
  const { isOpen, toggle, triggerRef } = useContext(MenuContext);
  return (
    <button
      ref={triggerRef}
      onClick={toggle}
      aria-haspopup="menu"
      aria-expanded={isOpen}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-text-2 hover:text-text-1 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-accent rounded-control"
      {...props}
    >
      {children}
    </button>
  );
};

Menu.Panel = function MenuPanel({ children, align = 'right' }) {
  const { isOpen, panelRef } = useContext(MenuContext);
  const alignClass = align === 'right' ? 'right-0' : 'left-0';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, scale: 0.95, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -8 }}
          transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
          className={`absolute ${alignClass} z-menu mt-2 w-56 origin-top-right rounded-menu bg-surface-2 shadow-sh-3 ring-1 ring-hairline focus:outline-none p-1`}
          role="menu"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

Menu.Item = function MenuItem({ children, onClick, icon: Icon }) {
  const { close } = useContext(MenuContext);
  return (
    <button
      className="flex w-full items-center gap-2 rounded-control px-3 py-2 text-sm text-text-2 hover:bg-surface-3 hover:text-text-1 transition-colors focus:outline-none focus:bg-surface-3 focus:text-text-1"
      role="menuitem"
      onClick={(e) => { onClick?.(e); close(); }}
    >
      {Icon && <Icon size={16} className="text-text-3" />}
      {children}
    </button>
  );
};

Menu.CheckboxItem = function MenuCheckboxItem({ children, checked, onChange }) {
  return (
    <button
      className="flex w-full items-center justify-between rounded-control px-3 py-2 text-sm text-text-2 hover:bg-surface-3 hover:text-text-1 transition-colors focus:outline-none focus:bg-surface-3"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span>{children}</span>
      {checked && <Check size={16} className="text-accent" />}
    </button>
  );
};

Menu.Divider = function MenuDivider() {
  return <div className="my-1 h-px bg-hairline" role="separator" />;
};

Menu.Label = function MenuLabel({ children }) {
  return <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-text-3">{children}</div>;
};

export default Menu;
