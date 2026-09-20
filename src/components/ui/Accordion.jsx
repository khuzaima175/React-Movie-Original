import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

export function Accordion({ title, children, defaultOpen = false }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-hairline">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between py-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-control"
        aria-expanded={isOpen}
      >
        <span className="text-sm font-semibold text-text-1">{title}</span>
        <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={16} className="text-text-3" />
        </motion.div>
      </button>
      
      <motion.div
        initial={false}
        animate={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="grid"
      >
        <div className="overflow-hidden">
          <div className="pb-4 text-sm text-text-2">{children}</div>
        </div>
      </motion.div>
    </div>
  );
}

export default Accordion;
