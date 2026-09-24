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
      <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
        {/* Source Pool Selector */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255, 255, 255, 0.08)", paddingBottom: "1.4rem" }}>
          <span style={{ fontSize: "1.2rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8a8a86" }}>
            Pick Movie From
          </span>
          <div style={{ display: "flex", gap: "0.8rem" }}>
            <button
              onClick={() => {
                setSource("watchlist");
                setPickedMovie(null);
              }}
              disabled={watchlist.length === 0}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                padding: "0.6rem 1.2rem",
                fontSize: "1.25rem",
                fontWeight: source === "watchlist" ? 600 : 500,
                borderRadius: "0.8rem",
                border: source === "watchlist" ? "1px solid #e2b13c" : "1px solid rgba(255, 255, 255, 0.1)",
                background: source === "watchlist" ? "rgba(226, 177, 60, 0.14)" : "#1c1d20",
                color: source === "watchlist" ? "#e2b13c" : "#b6b6b2",
                cursor: watchlist.length === 0 ? "not-allowed" : "pointer",
                opacity: watchlist.length === 0 ? 0.4 : 1,
                transition: "all 0.2s ease"
              }}
            >
              <Bookmark size={14} aria-hidden="true" />
              <span>Watchlist ({watchlist.length})</span>
            </button>

            <button
              onClick={() => {
                setSource("watched");
                setPickedMovie(null);
              }}
              disabled={watched.length === 0}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                padding: "0.6rem 1.2rem",
                fontSize: "1.25rem",
                fontWeight: source === "watched" ? 600 : 500,
                borderRadius: "0.8rem",
                border: source === "watched" ? "1px solid #e2b13c" : "1px solid rgba(255, 255, 255, 0.1)",
                background: source === "watched" ? "rgba(226, 177, 60, 0.14)" : "#1c1d20",
                color: source === "watched" ? "#e2b13c" : "#b6b6b2",
                cursor: watched.length === 0 ? "not-allowed" : "pointer",
                opacity: watched.length === 0 ? 0.4 : 1,
                transition: "all 0.2s ease"
              }}
            >
              <Film size={14} aria-hidden="true" />
              <span>Vault ({watched.length})</span>
            </button>
          </div>
        </div>

        {/* Roulette Display Box */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2.4rem", borderRadius: "1.2rem", border: "1px solid rgba(255, 255, 255, 0.1)", background: "rgba(28, 29, 32, 0.6)", minHeight: "260px", textAlign: "center" }}>
          {pickedMovie ? (
            <motion.div
              key={pickedMovie.imdbID || pickedMovie.id || pickedMovie.title}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "2rem", width: "100%", maxWidth: "420px", textAlign: "left" }}
            >
              <div style={{ width: "9.6rem", height: "14.4rem", flexShrink: 0, borderRadius: "0.8rem", overflow: "hidden", border: "1px solid rgba(255, 255, 255, 0.12)", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
                <PosterImage
                  src={pickedMovie.poster || pickedMovie.Poster}
                  title={pickedMovie.title || pickedMovie.Title}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem", flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "1.2rem", color: "#e2b13c", fontWeight: 600 }}>
                  <Sparkles size={14} aria-hidden="true" />
                  <span>Oracle Pick</span>
                </div>
                <h3 style={{ fontSize: "1.7rem", fontWeight: 700, color: "#f4f4f2", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {pickedMovie.title || pickedMovie.Title}
                </h3>
                <div style={{ display: "flex", alignItems: "center", gap: "1.2rem", fontSize: "1.25rem", color: "#8a8a86", fontFamily: "monospace" }}>
                  <span>{pickedMovie.year || pickedMovie.Year}</span>
                  {(pickedMovie.imdbRating || pickedMovie.userRating) && (
                    <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "#f4f4f2" }}>
                      <Star size={13} style={{ color: "#e2b13c", fill: "currentColor" }} aria-hidden="true" />
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
                    style={{ display: "inline-flex", alignItems: "center", gap: "0.6rem", fontSize: "1.3rem", fontWeight: 600, color: "#e2b13c", background: "none", border: "none", cursor: "pointer", padding: "0.4rem 0", textDecoration: "underline" }}
                  >
                    <span>View Movie Details</span>
                    <ArrowRight size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            </motion.div>
          ) : activePool.length === 0 ? (
            <div style={{ color: "#8a8a86", fontSize: "1.4rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
              <p style={{ color: "#f4f4f2", fontWeight: 500 }}>No films found in your {source === "watchlist" ? "Watchlist" : "Vault"}.</p>
              <p style={{ fontSize: "1.25rem", color: "#8a8a86" }}>Bookmark or rate titles to activate the roulette!</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem", alignItems: "center" }}>
              <div style={{ width: "4.8rem", height: "4.8rem", borderRadius: "50%", background: "#242528", border: "1px solid rgba(255, 255, 255, 0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#e2b13c" }}>
                <Dices size={24} aria-hidden="true" />
              </div>
              <p style={{ fontSize: "1.5rem", color: "#f4f4f2", fontWeight: 600 }}>Can't decide what to watch tonight?</p>
              <p style={{ fontSize: "1.3rem", color: "#8a8a86" }}>Spin the wheel across your {activePool.length} saved titles.</p>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "1.2rem", paddingTop: "0.8rem" }}>
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
