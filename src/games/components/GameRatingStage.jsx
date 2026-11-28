import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronDown, ChevronUp, Clock, Gamepad2, Minus, Plus, Sparkles, Trash2, Trophy } from "lucide-react";
import StarRatingStage from "../../components/StarRatingStage";
import { Select } from "../../components/ui/Select";
import { useGameVault } from "../context/GameVaultContext";
import { getDefaultPlatformLabel } from "../services/gameRigService";
import {
  GAME_CRAFT_ASPECTS,
  GAME_QUICK_TAGS,
  GAME_STATUS_OPTIONS,
  computeGameVaultCalibration
} from "../services/gameVaultStorage";
import { EASE } from "../../motion";

const HOUR_PRESETS = [5, 15, 30, 60, 100];

export default function GameRatingStage({
  game,
  existing = null,
  played = [],
  compact = false,
  onSave,
  onRemove,
  onAfterSave
}) {
  const navigate = useNavigate();
  const { rigProfile } = useGameVault();
  const [selectedScore, setSelectedScore] = useState(Number(existing?.userRating ?? 0) || 0);
  const [hoverScore, setHoverScore] = useState(0);
  const [status, setStatus] = useState(existing?.status || "completed");
  const [hours, setHours] = useState(
    existing?.hoursPlayed > 0 ? String(existing.hoursPlayed) : ""
  );
  const [platformPlayed, setPlatformPlayed] = useState(
    existing?.platformPlayed || getDefaultPlatformLabel(rigProfile) || game?.platforms?.[0] || "PC"
  );
  const [craft, setCraft] = useState(() => ({ ...(existing?.ratingBreakdown || {}) }));
  const [quickTags, setQuickTags] = useState(() =>
    Array.isArray(existing?.quickTags) ? [...existing.quickTags] : []
  );
  const [userNote, setUserNote] = useState(existing?.userNote || "");
  const [showDetails, setShowDetails] = useState(
    Boolean(existing?.userNote || existing?.ratingBreakdown || existing?.quickTags?.length)
  );
  const [saving, setSaving] = useState(false);
  const [savedPulse, setSavedPulse] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const hydratedExistingRef = useRef(Boolean(existing));
  const pulseTimerRef = useRef(null);

  // Sync form fields once if `existing` arrives asynchronously after mount (without clobbering save confirmation!)
  useEffect(() => {
    if (!hydratedExistingRef.current && existing) {
      hydratedExistingRef.current = true;
      setSelectedScore(Number(existing.userRating ?? 0) || 0);
      setStatus(existing.status || "completed");
      setHours(existing.hoursPlayed > 0 ? String(existing.hoursPlayed) : "");
      if (existing.platformPlayed) setPlatformPlayed(existing.platformPlayed);
      setCraft({ ...(existing.ratingBreakdown || {}) });
      setQuickTags(Array.isArray(existing.quickTags) ? [...existing.quickTags] : []);
      setUserNote(existing.userNote || "");
      if (existing.userNote || existing.ratingBreakdown || existing.quickTags?.length) {
        setShowDetails(true);
      }
    }
  }, [existing]);

  useEffect(() => () => {
    if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
  }, []);

  const previewScore = hoverScore || selectedScore;
  const calibration = useMemo(
    () => computeGameVaultCalibration(played, previewScore, game?.igdbId),
    [played, previewScore, game?.igdbId]
  );

  const platformOptions = useMemo(() => {
    const raw = [
      ...(game?.platforms || []),
      "PC",
      "PlayStation 5",
      "PlayStation 4",
      "Xbox Series X|S",
      "Xbox One",
      "Nintendo Switch",
      "Steam Deck",
      "Mobile"
    ];
    const dedup = [...new Set(raw.map((p) => String(p || "").trim()).filter(Boolean))];
    if (platformPlayed && !dedup.includes(platformPlayed)) dedup.unshift(platformPlayed);
    return dedup.map((p) => ({ value: p, label: p }));
  }, [game?.platforms, platformPlayed]);

  function adjustHours(delta) {
    const cur = Number(hours) || 0;
    const next = Math.max(0, Math.round((cur + delta) * 10) / 10);
    setHours(next > 0 ? String(next) : "");
  }

  function toggleTag(tag) {
    setQuickTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : prev.length < 6 ? [...prev, tag] : prev
    );
  }

  function setCraftScore(aspectId, val) {
    setCraft((prev) => {
      const next = { ...prev };
      if (next[aspectId] === val) delete next[aspectId];
      else next[aspectId] = val;
      return next;
    });
  }

  const STATUS_ALLOWS_UNRATED = new Set(["tried_bored", "on_hold", "playing", "dropped", "played"]);
  const canSaveWithoutScore = STATUS_ALLOWS_UNRATED.has(status);
  const canSubmit = Boolean(game) && (selectedScore >= 1 || canSaveWithoutScore);
  const currentStatusLabel = GAME_STATUS_OPTIONS.find((o) => o.id === status)?.label || status;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      const numHours = Number(hours);
      const isUpdate = Boolean(existing);
      await onSave?.(game, {
        userRating: selectedScore >= 1 ? selectedScore : 0,
        status,
        hoursPlayed: Number.isFinite(numHours) && numHours >= 0 ? numHours : 0,
        platformPlayed: platformPlayed.trim(),
        ratingBreakdown: Object.keys(craft).length > 0 ? craft : null,
        quickTags,
        userNote: userNote.trim()
      });
      setSavedMessage(
        selectedScore > 0
          ? `${isUpdate ? "Updated" : "Saved"} ${selectedScore}/10 (${currentStatusLabel}) in your Vault`
          : `${isUpdate ? "Updated" : "Saved"} as "${currentStatusLabel}" in your Vault`
      );
      setSavedPulse(true);
      if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = window.setTimeout(() => setSavedPulse(false), 2600);
      onAfterSave?.();
    } finally {
      setSaving(false);
    }
  }

  const craftCount = Object.keys(craft).length;

  return (
    <form onSubmit={handleSubmit} className={`gv-rating-studio ${compact ? "is-compact" : ""}`}>
      <StarRatingStage
        value={selectedScore}
        hoverValue={hoverScore}
        onChange={setSelectedScore}
        onHoverChange={setHoverScore}
        calibration={calibration}
        compact={compact}
        titleLabel="Game Rating Studio"
        mediaNoun="game"
        ariaLabel={`Rate ${game?.title || "this game"} from 1 to 10`}
        onSelectAnchor={(anchor) => {
          if (anchor?.igdbId) navigate(`/game/${anchor.igdbId}`);
        }}
      />

      {/* Status + Playtime + Platform Strip */}
      <div className="gv-studio-controls">
        <div className="gv-studio-row">
          <span className="gv-studio-label">
            <Trophy size={13} aria-hidden="true" /> Play Status
          </span>
          <div className="gv-chip-group">
            {GAME_STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`gv-chip gv-chip-sm ${status === opt.id ? "is-active" : ""}`}
                onClick={() => setStatus(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="gv-studio-two-col">
          <div className="gv-studio-field">
            <label htmlFor={`gv-hours-${game?.igdbId}`} className="gv-studio-label">
              <Clock size={13} aria-hidden="true" /> Playtime (hours)
            </label>
            <div className="gv-hours-row">
              <div className="gv-stepper">
                <button
                  type="button"
                  className="gv-stepper-btn"
                  onClick={() => adjustHours(-5)}
                  aria-label="Decrease playtime by 5 hours"
                >
                  <Minus size={13} />
                </button>
                <input
                  id={`gv-hours-${game?.igdbId}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="20000"
                  step="0.5"
                  placeholder="0"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  className="gv-stepper-input tabular-num"
                />
                <button
                  type="button"
                  className="gv-stepper-btn"
                  onClick={() => adjustHours(5)}
                  aria-label="Increase playtime by 5 hours"
                >
                  <Plus size={13} />
                </button>
              </div>
              <div className="gv-hours-presets">
                {HOUR_PRESETS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className={`gv-hour-pill ${Number(hours) === h ? "is-active" : ""}`}
                    onClick={() => setHours(String(h))}
                  >
                    {h}h
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="gv-studio-field">
            <span className="gv-studio-label">
              <Gamepad2 size={13} aria-hidden="true" /> Platform Played
            </span>
            <Select
              value={platformPlayed}
              onChange={setPlatformPlayed}
              options={platformOptions}
              ariaLabel="Platform Played"
              fullWidth
            />
          </div>
        </div>

        {/* Progressive Disclosure: Craft Breakdown, Quick Tags & Review Note */}
        <button
          type="button"
          className="gv-studio-drawer-toggle"
          onClick={() => setShowDetails((v) => !v)}
          aria-expanded={showDetails}
        >
          <span>
            <Sparkles size={13} aria-hidden="true" />
            {showDetails
              ? "Hide craft breakdown, tags & note"
              : `+ Add craft breakdown, tags & review note${
                  craftCount + quickTags.length > 0
                    ? ` (${craftCount + quickTags.length} set)`
                    : ""
                }`}
          </span>
          {showDetails ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>

        <AnimatePresence initial={false}>
          {showDetails && (
            <motion.div
              key="details-drawer"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.24, ease: EASE }}
              style={{ overflow: "hidden" }}
            >
              <div className="gv-studio-drawer">
                <div>
                  <span className="gv-studio-label mb-2">5-Aspect Game Craft Breakdown (1–5)</span>
                  <div className="gv-craft-grid">
                    {GAME_CRAFT_ASPECTS.map((aspect) => {
                      const cur = Number(craft[aspect.id] || 0);
                      return (
                        <div key={aspect.id} className="gv-craft-row">
                          <span className="gv-craft-name">{aspect.label}</span>
                          <div className="gv-craft-dots" role="group" aria-label={aspect.label}>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                type="button"
                                className={`gv-craft-dot ${cur >= n ? "is-filled" : ""}`}
                                onClick={() => setCraftScore(aspect.id, n)}
                                aria-label={`${aspect.label} ${n} of 5`}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <span className="gv-studio-label mb-2">Quick Gaming Tags</span>
                  <div className="gv-chip-group">
                    {GAME_QUICK_TAGS.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className={`gv-tag-pill ${quickTags.includes(tag) ? "is-active" : ""}`}
                        onClick={() => toggleTag(tag)}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label htmlFor={`gv-note-${game?.igdbId}`} className="gv-studio-label mb-2">
                    Personal Review Note
                  </label>
                  <textarea
                    id={`gv-note-${game?.igdbId}`}
                    value={userNote}
                    onChange={(e) => setUserNote(e.target.value)}
                    placeholder="Boss design, world-building, combat feel, favorite moment..."
                    className="gv-textarea"
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Commit Action Bar */}
        <div className="gv-studio-actions">
          <div className="flex flex-wrap items-center gap-3">
            {existing && onRemove ? (
              <button
                type="button"
                className="gv-btn gv-btn-sm gv-btn-danger-ghost"
                onClick={async () => {
                  await onRemove(game.igdbId);
                  onAfterSave?.();
                }}
              >
                <Trash2 size={14} /> Remove from Vault
              </button>
            ) : null}

            {savedPulse ? (
              <span
                role="status"
                aria-live="polite"
                className="gv-pill gv-pill-match inline-flex items-center gap-1.5 text-[1.22rem] font-semibold"
              >
                <Check size={14} aria-hidden="true" /> {savedMessage || "Saved to Game Vault"}
              </span>
            ) : !existing ? (
              <span className="text-[1.2rem] text-text-3">
                {selectedScore > 0
                  ? "Feeds your local EASE^R + 128-D neural taste profile immediately."
                  : status === "tried_bored"
                    ? "Logged neutrally — won't penalize this genre in case you give it another shot later!"
                    : canSaveWithoutScore
                      ? `You can save as "${currentStatusLabel}" with or without a 1–10 score.`
                      : "Click any bar (1–10) above to lock your score."}
              </span>
            ) : (
              <span className="text-[1.18rem] text-text-3">
                {status === "tried_bored"
                  ? "Neutral log — won't push away similar games if you try it again later."
                  : "Edit score, status, hours, craft sliders, or tags anytime."}
              </span>
            )}
          </div>

          <button
            type="submit"
            disabled={saving || !canSubmit}
            className={`gv-btn ${savedPulse ? "gv-btn-saved" : "gv-btn-primary"}`}
          >
            {savedPulse ? (
              <>
                <Check size={15} aria-hidden="true" />
                {selectedScore > 0 ? `Saved ${selectedScore}/10!` : "Saved to Vault!"}
              </>
            ) : selectedScore > 0 ? (
              existing ? `Update ${selectedScore}/10 Entry` : `Save ${selectedScore}/10 to Vault`
            ) : canSaveWithoutScore ? (
              existing ? `Update (${currentStatusLabel})` : `Save as ${currentStatusLabel}`
            ) : (
              "Select Rating (1–10)"
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
