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
    sm: { maxWidth: "520px" },
    md: { maxWidth: "680px" },
    lg: { maxWidth: "860px" },
    full: { maxWidth: "1040px" }
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          overflowY: "auto",
          background: "rgba(0, 0, 0, 0.84)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          padding: "2rem 1.6rem",
          paddingTop: "clamp(60px, 11vh, 120px)"
        }}
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
          style={{
            ...sizeStyles[size],
            width: "100%",
            borderRadius: "1.8rem",
            background: "#141416",
            border: "1px solid rgba(255, 255, 255, 0.14)",
            boxShadow: "0 32px 80px -16px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.05)",
            overflow: "hidden",
            margin: "1rem auto"
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
              padding: "2rem 2.8rem",
              background: "var(--surface-2)"
            }}
          >
            <h2
              id="modal-title"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "2.1rem",
                fontWeight: 600,
                color: "var(--text-1)",
                letterSpacing: "-0.02em",
                margin: 0
              }}
            >
              {title}
            </h2>
            <button
              onClick={onClose}
              style={{
                width: "3.4rem",
                height: "3.4rem",
                borderRadius: "6px",
                background: "var(--surface-3)",
                border: "none",
                color: "var(--text-2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "all 0.16s ease"
              }}
              className="hover:text-[#f3f1eb] hover:bg-white/[0.12]"
              aria-label="Close modal"
            >
              <X size={17} />
            </button>
          </div>

          {/* Modal Content */}
          <div style={{ padding: "2.8rem 3.2rem 3.2rem" }}>{children}</div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

export default Modal;
