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
        "inline-flex items-center gap-[0.6rem] text-[1.35rem] font-medium text-text-2 hover:text-text-1 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-accent rounded-control"
      }
      {...props}
    >
      {children}
    </button>
  );
};

Menu.Panel = function MenuPanel({ children, align = 'right' }) {
  const { isOpen, panelRef } = useContext(MenuContext);
  const alignClass =
    align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, scale: 0.96, y: -6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -6 }}
          transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
          className={`absolute ${alignClass} z-[200] mt-[1rem] min-w-[26.5rem] w-max max-w-[32rem] rounded-[1.2rem] bg-[#18191d]/98 backdrop-blur-xl border border-white/14 shadow-[0_18px_42px_rgba(0,0,0,0.78)] focus:outline-none p-[0.75rem]`}
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
      type="button"
      className="group flex w-full items-center gap-[1.1rem] rounded-[0.8rem] px-[1.3rem] py-[1.05rem] text-[1.45rem] font-medium text-[#d4d4d0] hover:bg-white/[0.07] hover:text-[#f4f4f2] transition-colors focus:outline-none focus:bg-white/[0.07] focus:text-[#f4f4f2] text-left cursor-pointer whitespace-nowrap"
      role="menuitem"
      onClick={(e) => { onClick?.(e); close(); }}
    >
      {Icon && (
        <Icon
          size={17}
          className="text-[#8a8a86] group-hover:text-[#e2b13c] transition-colors shrink-0"
          aria-hidden="true"
        />
      )}
      <span>{children}</span>
    </button>
  );
};

Menu.CheckboxItem = function MenuCheckboxItem({ children, checked, onChange }) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between gap-[1.1rem] rounded-[0.8rem] px-[1.3rem] py-[1.05rem] text-[1.45rem] font-medium text-[#d4d4d0] hover:bg-white/[0.07] hover:text-[#f4f4f2] transition-colors focus:outline-none focus:bg-white/[0.07] cursor-pointer whitespace-nowrap"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span>{children}</span>
      {checked && <Check size={17} className="text-[#e2b13c] shrink-0" aria-hidden="true" />}
    </button>
  );
};

Menu.Divider = function MenuDivider() {
  return <div className="my-[0.55rem] mx-[0.65rem] h-px bg-white/10" role="separator" />;
};

Menu.Label = function MenuLabel({ children }) {
  return (
    <div className="px-[1.3rem] pt-[0.75rem] pb-[0.6rem] text-[1.15rem] font-semibold uppercase tracking-[0.09em] text-[#8a8a86]">
      {children}
    </div>
  );
};

export default Menu;
