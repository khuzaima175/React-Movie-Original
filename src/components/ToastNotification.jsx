import { useEffect, useRef } from "react";
import { RotateCcw, X, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const TOAST_MS = 5000;

export default function ToastNotification({ toast, onUndo, onClose, duration = TOAST_MS }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Owns the dismiss timer: restarts for each new toast, pauses on hover/focus.
  const timerRef = useRef(null);
  const remainingRef = useRef(duration);
  const startedAtRef = useRef(0);

  function startTimer() {
    clearTimeout(timerRef.current);
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => closeRef.current?.(), remainingRef.current);
  }

  function pauseTimer() {
    clearTimeout(timerRef.current);
    remainingRef.current = Math.max(600, remainingRef.current - (Date.now() - startedAtRef.current));
  }

  useEffect(() => {
    if (!toast) return undefined;
    remainingRef.current = duration;
    startTimer();
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, duration]);

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key="cinema-toast"
          className="cinema-toast-wrapper"
          initial={{ opacity: 0, y: -28, scale: 0.92, x: "-50%" }}
          animate={{ opacity: 1, y: 0, scale: 1, x: "-50%" }}
          exit={{ opacity: 0, y: -20, scale: 0.94, x: "-50%", transition: { duration: 0.18 } }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
          role="status"
          aria-live="polite"
          onMouseEnter={pauseTimer}
          onMouseLeave={startTimer}
          onFocus={pauseTimer}
          onBlur={startTimer}
        >
          <div className="cinema-toast-pill">
            <div className="cinema-toast-icon">
              <motion.span
                initial={{ scale: 0, rotate: -45 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 520, damping: 18, delay: 0.08 }}
                style={{ display: "inline-flex" }}
              >
                <Check size={16} className="text-[#f3f1eb]" strokeWidth={2.5} aria-hidden="true" />
              </motion.span>
            </div>

            <span className="cinema-toast-text">
              {toast.message ? (
                toast.message
              ) : (
                <>
                  Removed <span className="cinema-toast-movie-title">{toast.title}</span> from{" "}
                  {toast.tab === "watchlist" ? "Watchlist" : "Vault"}
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

            <span className="cinema-toast-progress" aria-hidden="true">
              <span
                key={toast.title || toast.message || "t"}
                className="cinema-toast-progress-bar"
                style={{ animationDuration: `${duration}ms` }}
              />
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
