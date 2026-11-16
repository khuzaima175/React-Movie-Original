import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { EASE } from '../../motion';

const SIZE_MAX_WIDTH = {
  sm: '52rem',
  md: '68rem',
  lg: '86rem',
  full: '104rem'
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export function Modal({ isOpen, onClose, children, title, size = 'md' }) {
  const previousFocusRef = useRef(null);
  const dialogRef = useRef(null);
  const titleId = useId();

  // Scroll lock + focus restore (runs on open/close transitions only)
  useEffect(() => {
    if (!isOpen) return undefined;
    previousFocusRef.current = document.activeElement;
    document.body.style.overflow = 'hidden';

    // Move focus into the dialog once it has mounted
    const focusTimer = window.setTimeout(() => {
      const node = dialogRef.current;
      if (!node || node.contains(document.activeElement)) return;
      const first = node.querySelector(FOCUSABLE_SELECTOR);
      (first || node).focus?.();
    }, 30);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = '';
      const previous = previousFocusRef.current;
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, [isOpen]);

  // Escape to close + Tab focus trap
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const node = dialogRef.current;
      if (!node) return;
      const focusable = Array.from(node.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null
      );
      if (focusable.length === 0) {
        e.preventDefault();
        node.focus?.();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !node.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !node.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="cv-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose?.();
          }}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="cv-modal-panel"
            style={{ maxWidth: SIZE_MAX_WIDTH[size] || SIZE_MAX_WIDTH.md }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cv-modal-header">
              <h2 id={titleId} className="cv-modal-title">
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="cv-modal-close"
                aria-label="Close modal"
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>

            <div className="cv-modal-body">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export default Modal;
