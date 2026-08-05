import { RotateCcw, X, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function ToastNotification({ toast, onUndo, onClose }) {
  if (!toast) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="toast-notification"
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ duration: 0.25 }}
        role="alert"
        aria-live="polite"
      >
        <div className="toast-content">
          <CheckCircle2 size={18} className="toast-icon" aria-hidden="true" />
          <span className="toast-message">
            Removed <strong>{toast.title}</strong> from Vault
          </span>
          {onUndo && (
            <button className="btn-toast-undo" onClick={() => onUndo(toast.item)}>
              <RotateCcw size={14} aria-hidden="true" /> Undo
            </button>
          )}
          <button className="btn-toast-close" onClick={onClose} aria-label="Dismiss notification">
            <X size={15} aria-hidden="true" />
          </button>
        </div>
        <div className="toast-progress-bar" />
      </motion.div>
    </AnimatePresence>
  );
}
