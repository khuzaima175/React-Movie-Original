import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Dices, Gamepad2, Sparkles, Star, X } from "lucide-react";
import { EASE, springSnappy } from "../../motion";
import { rankBacklogForNextPlay } from "../services/gameRankerService";

export default function GameRouletteModal({
  isOpen,
  onClose,
  played = [],
  backlog = [],
  models = {},
  extraCandidates = []
}) {
  const navigate = useNavigate();
  const [sourceMode, setSourceMode] = useState(() => (backlog.length > 0 ? "backlog" : "picks"));
  const [spinning, setSpinning] = useState(false);
  const [current, setCurrent] = useState(null);
  const [winner, setWinner] = useState(null);
  const timerRef = useRef(null);

  const rankedBacklog = useMemo(
    () => rankBacklogForNextPlay(backlog, played, models),
    [backlog, played, models]
  );

  const pool = useMemo(() => {
    if (sourceMode === "backlog" && rankedBacklog.length > 0) return rankedBacklog;
    if (sourceMode === "replay" && played.length > 0) return played.filter((g) => (g.userRating || 0) >= 8);
    if (extraCandidates.length > 0) return extraCandidates;
    return rankedBacklog.length > 0 ? rankedBacklog : played;
  }, [sourceMode, rankedBacklog, played, extraCandidates]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setWinner(null);
      setCurrent(null);
      setSpinning(false);
    }
  }, [isOpen]);

  function spinRoulette() {
    if (pool.length === 0 || spinning) return;
    setSpinning(true);
    setWinner(null);

    const targetIdx = Math.floor(Math.random() * pool.length);
    const totalTicks = Math.min(20, Math.max(12, pool.length * 2));
    let tick = 0;

    const step = () => {
      tick++;
      const isFinal = tick >= totalTicks;
      const item = isFinal ? pool[targetIdx] : pool[Math.floor(Math.random() * pool.length)];
      setCurrent(item);
      if (isFinal) {
        setWinner(item);
        setSpinning(false);
        return;
      }
      const delay = 55 + Math.pow(tick / totalTicks, 2.2) * 240;
      timerRef.current = window.setTimeout(step, delay);
    };
    step();
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="gv-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Game Roulette — What to Play Next"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            className="gv-modal gv-roulette-modal"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.94, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.24, ease: EASE }}
          >
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <div className="gv-kicker">
                  <Dices size={13} /> Game Roulette
                </div>
                <h2 className="gv-section-title">What Should You Play Next?</h2>
              </div>
              <button type="button" className="gv-btn gv-btn-sm" onClick={onClose} aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <div className="gv-chip-group mb-5">
              <button
                type="button"
                className={`gv-chip gv-chip-sm ${sourceMode === "backlog" ? "is-active" : ""}`}
                onClick={() => setSourceMode("backlog")}
                disabled={backlog.length === 0}
              >
                My Backlog ({backlog.length})
              </button>
              <button
                type="button"
                className={`gv-chip gv-chip-sm ${sourceMode === "picks" ? "is-active" : ""}`}
                onClick={() => setSourceMode("picks")}
                disabled={extraCandidates.length === 0}
              >
                Top ML Picks ({extraCandidates.length})
              </button>
              <button
                type="button"
                className={`gv-chip gv-chip-sm ${sourceMode === "replay" ? "is-active" : ""}`}
                onClick={() => setSourceMode("replay")}
                disabled={played.length === 0}
              >
                Favorite Replays
              </button>
            </div>

            <div className={`gv-roulette-stage ${winner ? "has-winner" : ""}`}>
              {current ? (
                <motion.div
                  key={current.igdbId}
                  className="gv-roulette-card"
                  initial={{ opacity: 0.4, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={springSnappy}
                >
                  {current.coverUrl ? (
                    <img src={current.coverUrl} alt={current.title} className="gv-roulette-cover" />
                  ) : (
                    <div className="gv-roulette-cover flex items-center justify-center bg-surface-3">
                      <Gamepad2 size={32} className="text-text-3" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      {winner && (
                        <span className="gv-pill gv-pill-accent">
                          <Sparkles size={12} /> Tonight&apos;s Pick
                        </span>
                      )}
                      {Number.isFinite(Number(current.matchScore)) && (
                        <span className="gv-pill gv-pill-match">{current.matchScore}% Match</span>
                      )}
                      {current.rating10 && (
                        <span className="gv-pill">IGDB {current.rating10.toFixed(1)}</span>
                      )}
                    </div>
                    <h3 className="text-[2.1rem] font-semibold text-text-1 leading-tight mb-1">
                      {current.title}
                    </h3>
                    <p className="text-[1.25rem] text-text-3">
                      {[current.year, ...(current.genres || []).slice(0, 2)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </motion.div>
              ) : (
                <div className="text-center py-8">
                  <Dices size={34} className="mx-auto mb-3 text-accent opacity-80" />
                  <p className="text-[1.45rem] text-text-2">
                    {pool.length > 0
                      ? `Ready to spin across ${pool.length} game${pool.length === 1 ? "" : "s"}.`
                      : "Add games to your Backlog or log a few titles first."}
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 mt-5">
              <button
                type="button"
                disabled={spinning || pool.length === 0}
                className="gv-btn gv-btn-primary"
                onClick={spinRoulette}
              >
                <Dices size={15} />
                {spinning ? "Spinning..." : winner ? "Spin Again" : "Spin Roulette"}
              </button>

              {winner && (
                <button
                  type="button"
                  className="gv-btn"
                  onClick={() => {
                    onClose?.();
                    navigate(`/game/${winner.igdbId}`);
                  }}
                >
                  <Star size={14} /> Open {winner.title}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
