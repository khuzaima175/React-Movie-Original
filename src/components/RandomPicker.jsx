import { useState, useEffect } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { useApp } from "../context/AppContext";
import PosterImage from "./PosterImage";
import { Dices, Sparkles, Film, Bookmark, Star, ArrowRight, RotateCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function RandomPicker({ isOpen, onClose, onSelectMovie }) {
  const { watchlist = [], watched = [] } = useApp();
  const [source, setSource] = useState("watchlist"); // "watchlist" | "watched"
  const [isSpinning, setIsSpinning] = useState(false);
  const [pickedMovie, setPickedMovie] = useState(null);

  const activePool = source === "watchlist" ? watchlist : watched;

  useEffect(() => {
    if (isOpen) {
      if (watchlist.length > 0) {
        setSource("watchlist");
      } else if (watched.length > 0) {
        setSource("watched");
      }
      setPickedMovie(null);
      setIsSpinning(false);
    }
  }, [isOpen, watchlist.length, watched.length]);

  function handleRoll() {
    if (activePool.length === 0) return;

    setIsSpinning(true);
    setPickedMovie(null);

    let counter = 0;
    const maxSteps = 14;
    const intervalTime = 75;

    const interval = setInterval(() => {
      const randomIndex = Math.floor(Math.random() * activePool.length);
      setPickedMovie(activePool[randomIndex]);
      counter++;
      if (counter >= maxSteps) {
        clearInterval(interval);
        // Final random pick
        const finalIndex = Math.floor(Math.random() * activePool.length);
        setPickedMovie(activePool[finalIndex]);
        setIsSpinning(false);
      }
    }, intervalTime);
  }

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Cinema Roulette" size="md">
      <div className="space-y-6">
        {/* Source Pool Selector */}
        <div className="flex items-center justify-between border-b border-hairline pb-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-3">
            Pick Movie From
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setSource("watchlist");
                setPickedMovie(null);
              }}
              disabled={watchlist.length === 0}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-control border transition-colors ${
                source === "watchlist"
                  ? "bg-surface-3 border-accent text-accent font-semibold"
                  : "bg-surface-2 border-hairline text-text-3 hover:text-text-1 disabled:opacity-40"
              }`}
            >
              <Bookmark size={13} aria-hidden="true" />
              <span>Watchlist ({watchlist.length})</span>
            </button>

            <button
              onClick={() => {
                setSource("watched");
                setPickedMovie(null);
              }}
              disabled={watched.length === 0}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-control border transition-colors ${
                source === "watched"
                  ? "bg-surface-3 border-accent text-accent font-semibold"
                  : "bg-surface-2 border-hairline text-text-3 hover:text-text-1 disabled:opacity-40"
              }`}
            >
              <Film size={13} aria-hidden="true" />
              <span>Vault ({watched.length})</span>
            </button>
          </div>
        </div>

        {/* Roulette Display Box */}
        <div className="flex flex-col items-center justify-center p-6 rounded-card border border-hairline bg-surface-2/60 min-h-[260px] text-center">
          {pickedMovie ? (
            <motion.div
              key={pickedMovie.imdbID || pickedMovie.id || pickedMovie.title}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex flex-col sm:flex-row items-center gap-5 w-full max-w-sm"
            >
              <div className="w-24 h-36 flex-shrink-0 rounded-poster overflow-hidden border border-hairline shadow-sh-2">
                <PosterImage
                  src={pickedMovie.poster || pickedMovie.Poster}
                  title={pickedMovie.title || pickedMovie.Title}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="text-left space-y-2 flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-xs text-accent font-medium">
                  <Sparkles size={13} aria-hidden="true" />
                  <span>Oracle Pick</span>
                </div>
                <h3 className="text-base font-bold text-text-1 truncate">
                  {pickedMovie.title || pickedMovie.Title}
                </h3>
                <div className="flex items-center gap-3 text-xs text-text-3 font-mono">
                  <span>{pickedMovie.year || pickedMovie.Year}</span>
                  {(pickedMovie.imdbRating || pickedMovie.userRating) && (
                    <span className="flex items-center gap-1 text-text-2">
                      <Star size={12} className="text-accent fill-current" aria-hidden="true" />
                      {pickedMovie.userRating || pickedMovie.imdbRating}
                    </span>
                  )}
                  {pickedMovie.runtime && <span>{parseInt(pickedMovie.runtime, 10)}m</span>}
                </div>

                {!isSpinning && (
                  <button
                    onClick={() => {
                      onSelectMovie?.(pickedMovie.imdbID || pickedMovie.id);
                      onClose();
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline pt-1"
                  >
                    <span>View Movie Details</span>
                    <ArrowRight size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            </motion.div>
          ) : activePool.length === 0 ? (
            <div className="text-text-3 text-sm space-y-2">
              <p>No films found in your {source === "watchlist" ? "Watchlist" : "Vault"}.</p>
              <p className="text-xs text-text-3/70">Bookmark or rate titles to activate the roulette!</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-full bg-surface-3 border border-hairline flex items-center justify-center mx-auto text-accent">
                <Dices size={24} aria-hidden="true" />
              </div>
              <p className="text-sm text-text-2 font-medium">Can't decide what to watch tonight?</p>
              <p className="text-xs text-text-3">Spin the wheel across your {activePool.length} saved titles.</p>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>

          <Button
            variant="accent"
            size="md"
            icon={isSpinning ? RotateCw : Dices}
            loading={isSpinning}
            disabled={activePool.length === 0}
            onClick={handleRoll}
          >
            {isSpinning ? "Rolling..." : pickedMovie ? "Roll Again" : "Spin Roulette"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
