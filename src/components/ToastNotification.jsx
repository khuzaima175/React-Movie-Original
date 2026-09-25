import { RotateCcw, X, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function ToastNotification({ toast, onUndo, onClose }) {
  if (!toast) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="cinema-toast-wrapper"
        initial={{ opacity: 0, y: -24, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.94 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        role="alert"
        aria-live="polite"
      >
        <div className="cinema-toast-pill">
          <div className="cinema-toast-icon">
            <Check size={16} className="text-[#e2b13c]" strokeWidth={2.5} aria-hidden="true" />
          </div>

          <span className="cinema-toast-text">
            {toast.message ? (
              toast.message
            ) : (
              <>
                Removed <span className="cinema-toast-movie-title">{toast.title}</span> from {toast.tab === "watchlist" ? "Watchlist" : "Vault"}
              </>
            )}
          </span>

          {onUndo && toast.item && (
            <button
              type="button"
              onClick={() => onUndo(toast.item)}
              className="cinema-toast-undo-btn"
              aria-label="Undo movie deletion"
            >
              <RotateCcw size={13} aria-hidden="true" />
              <span>Undo</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="cinema-toast-close-btn"
            aria-label="Dismiss notification"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

