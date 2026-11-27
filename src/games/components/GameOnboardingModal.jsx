import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  Cpu,
  Gamepad2,
  Monitor,
  Sparkles,
  X
} from "lucide-react";
import {
  PC_SPEC_TIERS,
  RIG_PLATFORM_CHOICES,
  detectLocalGpuInfo,
  getRigPlatformFamilies,
  isGameCompatibleWithRig
} from "../services/gameRigService";
import { STARTER_CALIBRATION_GAMES } from "../services/gameOracleService";
import { EASE } from "../../motion";

export default function GameOnboardingModal({
  isOpen,
  onClose,
  rigProfile,
  onSaveRig,
  playedById,
  onRateStarter
}) {
  const [step, setStep] = useState(1);
  const [platforms, setPlatforms] = useState(() =>
    Array.isArray(rigProfile?.platforms) && rigProfile.platforms.length > 0 ? rigProfile.platforms : ["pc"]
  );
  const [pcSpecTier, setPcSpecTier] = useState(rigProfile?.pcSpecTier || "mid");
  const [detectedGpu, setDetectedGpu] = useState(rigProfile?.detectedGpu || "");
  const [respectRigLimits, setRespectRigLimits] = useState(rigProfile?.respectRigLimits !== false);
  const [detectStatus, setDetectStatus] = useState("");
  const [ratedNow, setRatedNow] = useState(0);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") handleFinish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, platforms, pcSpecTier, detectedGpu, respectRigLimits]);

  const hasPc = platforms.includes("pc");

  function togglePlatform(pid) {
    setPlatforms((prev) => {
      if (prev.includes(pid)) {
        return prev.length > 1 ? prev.filter((x) => x !== pid) : prev;
      }
      return [...prev, pid];
    });
  }

  function handleAutoDetectGpu() {
    const info = detectLocalGpuInfo();
    if (info.renderer) {
      setDetectedGpu(info.renderer);
      if (info.tier) setPcSpecTier(info.tier);
      setDetectStatus(`Detected: ${info.renderer} → ${info.tier === "entry" ? "Entry / Older PC" : info.tier === "high" ? "High-End PC" : "Mid-Range PC"}`);
    } else {
      setDetectStatus("Browser hid GPU name — use the quick question below instead!");
    }
  }

  const draftRig = useMemo(
    () => ({ completed: true, platforms, pcSpecTier, detectedGpu, respectRigLimits }),
    [platforms, pcSpecTier, detectedGpu, respectRigLimits]
  );

  // Filter 32 iconic starter games to match user's platforms & PC spec tier (so GTX 750 Ti users see playable icons!)
  const tailoredStarterGames = useMemo(() => {
    const fams = getRigPlatformFamilies(draftRig);
    return STARTER_CALIBRATION_GAMES.filter((g) => {
      if (fams.length > 0 && Array.isArray(g.platformFamilies)) {
        if (!g.platformFamilies.some((f) => fams.includes(f))) return false;
      }
      if (respectRigLimits && !isGameCompatibleWithRig(g, draftRig).compatible) {
        return false;
      }
      return true;
    }).slice(0, 16);
  }, [draftRig, respectRigLimits]);

  function handleFinish() {
    onSaveRig?.({
      completed: true,
      platforms,
      pcSpecTier,
      detectedGpu,
      respectRigLimits
    });
    onClose?.();
  }

  function handleNextFromStep1() {
    if (hasPc) setStep(2);
    else setStep(3);
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="gv-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="GameVault Rig & Taste Setup"
          onClick={handleFinish}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            className="gv-modal gv-modal-wide"
            style={{ maxWidth: "74rem" }}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.24, ease: EASE }}
          >
            {/* Header + Step Indicator */}
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <div className="gv-kicker">
                  <Gamepad2 size={13} /> Step {step} of 3 · Personalize GameVault
                </div>
                <h2 className="gv-section-title">
                  {step === 1
                    ? "What Do You Play On?"
                    : step === 2
                      ? "What Kind of PC Do You Have?"
                      : "Tap Iconic Games You've Played"}
                </h2>
                <p className="gv-section-sub">
                  {step === 1
                    ? "Pick every platform you own so GameVault prioritizes games you can actually play."
                    : step === 2
                      ? "So we don't recommend heavy 2025 UE5 AAA games to a GTX 750 Ti or integrated laptop."
                      : "Tap a few big titles across FPS, RPG, Open-World & Sims to calibrate your local ML engine."}
                </p>
              </div>
              <button type="button" className="gv-btn gv-btn-sm shrink-0" onClick={handleFinish} aria-label="Skip setup">
                <X size={16} />
              </button>
            </div>

            {/* STEP 1: Platforms */}
            {step === 1 && (
              <div className="flex flex-col gap-5">
                <div className="gv-rig-grid">
                  {RIG_PLATFORM_CHOICES.map((p) => {
                    const active = platforms.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`gv-rig-card ${active ? "is-active" : ""}`}
                        onClick={() => togglePlatform(p.id)}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="text-[1.45rem] font-semibold text-text-1">{p.label}</span>
                          <span className={`gv-rig-check ${active ? "is-active" : ""}`}>
                            {active && <Check size={13} />}
                          </span>
                        </div>
                        <span className="text-[1.18rem] text-text-3">{p.family.toUpperCase()}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-hairline">
                  <button type="button" className="gv-btn gv-btn-sm" onClick={handleFinish}>
                    Skip for now
                  </button>
                  <button type="button" className="gv-btn gv-btn-primary" onClick={handleNextFromStep1}>
                    Continue →
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: PC Hardware / Spec Tier */}
            {step === 2 && (
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-lg bg-surface-2/80 border border-hairline">
                  <div className="flex items-center gap-3">
                    <Cpu size={18} className="text-accent shrink-0" />
                    <div className="text-[1.25rem] text-text-2">
                      {detectStatus || "Not sure what GPU you have? Detect it locally in 1 click (stays in your browser)."}
                    </div>
                  </div>
                  <button type="button" className="gv-btn gv-btn-sm" onClick={handleAutoDetectGpu}>
                    <Monitor size={13} /> Auto-Detect My GPU
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                  {PC_SPEC_TIERS.map((tier) => {
                    const active = pcSpecTier === tier.id;
                    return (
                      <button
                        key={tier.id}
                        type="button"
                        className={`gv-rig-card ${active ? "is-active" : ""}`}
                        onClick={() => setPcSpecTier(tier.id)}
                      >
                        <div className="flex items-center justify-between w-full mb-1">
                          <span className="text-[1.45rem] font-semibold text-text-1">{tier.label}</span>
                          <span className={`gv-rig-check ${active ? "is-active" : ""}`}>
                            {active && <Check size={13} />}
                          </span>
                        </div>
                        <div className="text-[1.12rem] font-semibold text-accent mb-1">{tier.gpuExamples}</div>
                        <p className="text-[1.18rem] text-text-3 leading-snug">{tier.desc}</p>
                      </button>
                    );
                  })}
                </div>

                {/* Plain-English Fallback Question if User Doesn't Know GPU Names */}
                <div className="p-4 rounded-lg bg-surface-2/50 border border-hairline">
                  <div className="text-[1.22rem] font-semibold text-text-2 mb-2.5">
                    Don&apos;t know your GPU? Answer 1 quick question: Can your PC smoothly run Cyberpunk 2077 or Red Dead Redemption 2?
                  </div>
                  <div className="gv-chip-group">
                    <button
                      type="button"
                      className={`gv-chip gv-chip-sm ${pcSpecTier === "entry" ? "is-active" : ""}`}
                      onClick={() => setPcSpecTier("entry")}
                    >
                      No — mostly older games / indies
                    </button>
                    <button
                      type="button"
                      className={`gv-chip gv-chip-sm ${pcSpecTier === "mid" ? "is-active" : ""}`}
                      onClick={() => setPcSpecTier("mid")}
                    >
                      Yes — on Low / Medium (1080p)
                    </button>
                    <button
                      type="button"
                      className={`gv-chip gv-chip-sm ${pcSpecTier === "high" ? "is-active" : ""}`}
                      onClick={() => setPcSpecTier("high")}
                    >
                      Yes — High / Ultra easily
                    </button>
                  </div>
                </div>

                <label className="flex items-center gap-3 text-[1.25rem] text-text-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={respectRigLimits}
                    onChange={(e) => setRespectRigLimits(e.target.checked)}
                    style={{ accentColor: "var(--accent)", width: "1.6rem", height: "1.6rem" }}
                  />
                  <span>Prioritize games my PC/console rig can smoothly run (you can toggle this off anytime in Explore)</span>
                </label>

                <div className="flex items-center justify-between pt-3 border-t border-hairline">
                  <button type="button" className="gv-btn gv-btn-sm" onClick={() => setStep(1)}>
                    ← Back
                  </button>
                  <button type="button" className="gv-btn gv-btn-primary" onClick={() => setStep(3)}>
                    Pick Favorite Games →
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: Fast Iconic Calibration Deck */}
            {step === 3 && (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" style={{ maxHeight: "48vh", overflowY: "auto", paddingRight: "0.4rem" }}>
                  {tailoredStarterGames.map((g) => {
                    const logged = playedById?.get(g.igdbId);
                    return (
                      <div key={g.igdbId} className={`gv-onboard-game ${logged ? "is-logged" : ""}`}>
                        <img src={g.coverUrl} alt={g.title} loading="lazy" className="gv-onboard-cover" />
                        <div className="p-2.5 flex flex-col gap-1.5 flex-1">
                          <div className="text-[1.22rem] font-semibold text-text-1 line-clamp-2 leading-tight">
                            {g.title}
                          </div>
                          <div className="text-[1.08rem] text-text-3">{g.primaryGenre} · {g.year}</div>
                          <div className="flex gap-1.5 mt-auto pt-1">
                            <button
                              type="button"
                              className={`gv-card-action ${logged?.userRating >= 9 ? "is-active" : ""}`}
                              onClick={() => {
                                setRatedNow((n) => n + 1);
                                onRateStarter?.(g, { userRating: 9, status: "completed" });
                              }}
                            >
                              {logged?.userRating >= 9 ? "★ 9" : "Love"}
                            </button>
                            <button
                              type="button"
                              className={`gv-card-action ${logged && logged.userRating < 9 ? "is-active" : ""}`}
                              onClick={() => {
                                setRatedNow((n) => n + 1);
                                onRateStarter?.(g, { userRating: 7, status: "played" });
                              }}
                            >
                              {logged && logged.userRating < 9 ? "★ 7" : "Like"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-hairline">
                  <button type="button" className="gv-btn gv-btn-sm" onClick={() => setStep(hasPc ? 2 : 1)}>
                    ← Back
                  </button>
                  <div className="flex items-center gap-3">
                    {ratedNow > 0 && (
                      <span className="text-[1.22rem] text-match font-semibold">
                        <Sparkles size={13} style={{ display: "inline", marginRight: "0.3rem" }} />
                        {ratedNow} rated!
                      </span>
                    )}
                    <button type="button" className="gv-btn gv-btn-primary" onClick={handleFinish}>
                      Finish &amp; Explore GameVault
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
