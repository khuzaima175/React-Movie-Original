import { RotateCcw, X, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function ToastNotification({ toast, onUndo, onClose }) {
  if (!toast) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed top-6 left-1/2 -translate-x-1/2 z-[10000] w-auto max-w-md pointer-events-auto"
        initial={{ opacity: 0, y: -20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        role="alert"
        aria-live="polite"
      >
        <div className="flex items-center gap-3 px-4 py-3 rounded-card bg-surface-2 border border-hairline shadow-sh-3 text-text-1">
          <CheckCircle2 size={16} className="text-accent flex-shrink-0" aria-hidden="true" />
          <span className="text-xs sm:text-sm font-medium">
            {toast.message ? (
              toast.message
            ) : (
              <>
                Removed <strong className="font-semibold text-text-1">{toast.title}</strong> from Vault
              </>
            )}
          </span>
          {onUndo && toast.item && (
            <button
              onClick={() => onUndo(toast.item)}
              className="inline-flex items-center gap-1 ml-1 px-2 py-1 text-xs font-semibold rounded-control bg-surface-3 hover:bg-surface-1 text-accent hover:text-[#f2c968] border border-hairline transition-colors"
            >
              <RotateCcw size={12} aria-hidden="true" /> Undo
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded-control text-text-3 hover:text-text-1 hover:bg-surface-3 transition-colors ml-1"
            aria-label="Dismiss notification"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
