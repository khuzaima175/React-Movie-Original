import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { EASE } from "../../motion";
import GameRatingStage from "./GameRatingStage";

export default function GameRateModal({
  game,
  existing = null,
  played = [],
  onClose,
  onSave,
  onRemove
}) {
  useEffect(() => {
    if (!game) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [game, onClose]);

  return (
    <AnimatePresence>
      {game && (
        <motion.div
          className="gv-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={`Rate ${game.title}`}
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            className="gv-modal gv-modal-wide"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.24, ease: EASE }}
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-4 min-w-0">
                {game.coverUrl && (
                  <img
                    src={game.coverUrl}
                    alt={game.title}
                    className="shrink-0"
                    style={{ width: "5.2rem", height: "6.9rem", objectFit: "cover", borderRadius: "6px" }}
                  />
                )}
                <div className="min-w-0">
                  <div className="gv-kicker">Game Rating Studio</div>
                  <h2 className="text-[2rem] font-semibold text-text-1 truncate">{game.title}</h2>
                  <div className="text-[1.25rem] text-text-3 truncate">
                    {[game.year, ...(game.genres || []).slice(0, 2)].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>
              <button type="button" className="gv-btn gv-btn-sm shrink-0" onClick={onClose} aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <GameRatingStage
              game={game}
              existing={existing}
              played={played}
              onSave={onSave}
              onRemove={onRemove}
              onAfterSave={onClose}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
