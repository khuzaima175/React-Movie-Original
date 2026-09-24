import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export function Modal({ isOpen, onClose, children, title, size = 'md' }) {
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement;
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      previousFocusRef.current?.focus();
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeStyles = {
    sm: { maxWidth: "480px" },
    md: { maxWidth: "620px" },
    lg: { maxWidth: "780px" },
    full: { maxWidth: "980px" }
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto bg-black/80 p-4 pt-16 sm:pt-24 backdrop-blur-md"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          style={sizeStyles[size] || sizeStyles.md}
          className="w-full rounded-2xl bg-[#141416] border border-white/10 shadow-2xl overflow-hidden my-4"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 bg-[#1c1d20]">
            <h2 id="modal-title" className="text-lg sm:text-xl font-semibold text-[#f4f4f2] tracking-tight">{title}</h2>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-[#8a8a86] hover:bg-[#242528] hover:text-[#f4f4f2] transition-colors focus:outline-none focus:ring-2 focus:ring-[#e2b13c]"
              aria-label="Close modal"
            >
              <X size={20} />
            </button>
          </div>
          {/* Modal Content */}
          <div className="p-6 sm:p-7">{children}</div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

export default Modal;
