import { useEffect, useState } from "react";
import { X, Trash2 } from "lucide-react";
import { GAME_STATUS_OPTIONS } from "../services/gameVaultStorage";

export default function GameRateModal({ game, existing = null, onClose, onSave, onRemove }) {
  const [rating, setRating] = useState(Number(existing?.userRating ?? game?.userRating ?? 8) || 8);
  const [hours, setHours] = useState(String(existing?.hoursPlayed ?? game?.hoursPlayed ?? ""));
  const [status, setStatus] = useState(existing?.status || game?.status || "completed");
  const [platformPlayed, setPlatformPlayed] = useState(existing?.platformPlayed || game?.platforms?.[0] || "PC");
  const [userNote, setUserNote] = useState(existing?.userNote || "");

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!game) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    const numHours = Number(hours);
    await onSave?.(game, {
      userRating: rating,
      hoursPlayed: Number.isFinite(numHours) && numHours >= 0 ? numHours : 0,
      status,
      platformPlayed: platformPlayed.trim(),
      userNote: userNote.trim()
    });
    onClose?.();
  }

  return (
    <div className="gv-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Rate ${game.title}`} onClick={onClose}>
      <div className="gv-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-4">
            {game.coverUrl && (
              <img
                src={game.coverUrl}
                alt={game.title}
                style={{ width: "5.2rem", aspectRatio: "3/4", objectFit: "cover", borderRadius: "6px" }}
              />
            )}
            <div>
              <div className="gv-kicker">Game Rating Studio</div>
              <h2 className="text-[2rem] font-semibold text-text-1">{game.title}</h2>
              <div className="text-[1.25rem] text-text-3">
                {[game.year, ...(game.genres || []).slice(0, 2)].filter(Boolean).join(" · ")}
              </div>
            </div>
          </div>
          <button type="button" className="gv-btn gv-btn-sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div>
            <label className="block text-[1.25rem] font-semibold text-text-2 mb-1">
              Your Score: <span className="text-accent">{rating} / 10</span>
            </label>
            <div className="gv-star-grid">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => (
                <button
                  key={val}
                  type="button"
                  className={`gv-star-btn ${rating === val ? "is-active" : ""}`}
                  onClick={() => setRating(val)}
                >
                  {val}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[1.25rem] font-semibold text-text-2 mb-2">Status</label>
              <div className="gv-chip-group">
                {GAME_STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`gv-chip ${status === opt.id ? "is-active" : ""}`}
                    onClick={() => setStatus(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="gv-hours" className="block text-[1.25rem] font-semibold text-text-2 mb-2">
                  Playtime (hrs)
                </label>
                <input
                  id="gv-hours"
                  type="number"
                  min="0"
                  max="20000"
                  step="0.5"
                  placeholder="e.g. 42"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  className="gv-input"
                />
              </div>
              <div>
                <label htmlFor="gv-platform" className="block text-[1.25rem] font-semibold text-text-2 mb-2">
                  Platform
                </label>
                <input
                  id="gv-platform"
                  type="text"
                  placeholder="PC / PS5 / Switch"
                  value={platformPlayed}
                  onChange={(e) => setPlatformPlayed(e.target.value)}
                  className="gv-input"
                />
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="gv-note" className="block text-[1.25rem] font-semibold text-text-2 mb-2">
              Personal Notes (optional)
            </label>
            <textarea
              id="gv-note"
              placeholder="Boss fights, atmosphere, favorite moment..."
              value={userNote}
              onChange={(e) => setUserNote(e.target.value)}
              className="gv-textarea"
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            {existing && onRemove ? (
              <button
                type="button"
                className="gv-btn gv-btn-sm"
                style={{ color: "var(--danger)" }}
                onClick={async () => {
                  await onRemove(game.igdbId);
                  onClose?.();
                }}
              >
                <Trash2 size={14} /> Remove from Vault
              </button>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-3">
              <button type="button" className="gv-btn gv-btn-sm" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="gv-btn gv-btn-primary">
                Save to Game Vault
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
