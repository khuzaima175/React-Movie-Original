import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Compass, Sparkles, Star, Bookmark } from "lucide-react";
import { useGameVault } from "../context/GameVaultContext";
import { GAME_PLATFORM_FAMILIES, fetchGamesBatch } from "../services/igdbService";
import { buildGameRecommendationIds, rankGameCandidates } from "../services/gameRankerService";
import { GAME_ORACLE_MOODS, curateGamesWithOracle } from "../services/gameOracleService";

export default function GamesOraclePage() {
  const { played, backlog, playedById, backlogIds, models, modelsLoading, setRateTarget, toggleBacklogGame } = useGameVault();
  const [selectedMood, setSelectedMood] = useState("any");
  const [customVibe, setCustomVibe] = useState("");
  const [platformFamily, setPlatformFamily] = useState("all");
  const [picks, setPicks] = useState([]);
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Game Oracle | GameVault";
  }, []);

  async function handleGenerate(e) {
    e?.preventDefault?.();
    if (played.length === 0) return;
    setLoading(true);
    setError("");
    try {
      const { allIds, maps } = buildGameRecommendationIds(played, backlog, models, {
        warmLimit: 50,
        coldLimit: 20,
        excludeBacklog: false
      });
      const hydrated = await fetchGamesBatch(allIds);
      const ranked = rankGameCandidates(hydrated, played, backlog, models, maps);
      const moodObj = GAME_ORACLE_MOODS.find((m) => m.id === selectedMood);
      const vibe = [moodObj?.prompt, customVibe.trim()].filter(Boolean).join(". ");

      const result = await curateGamesWithOracle({
        played,
        candidates: ranked,
        vibe,
        platformFamily,
        count: 12,
        useGemini: true
      });
      setPicks(result.picks);
      setSource(result.source);
    } catch {
      setError("Could not generate recommendations right now. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="gv-page page-rail">
      <div className="gv-section-header">
        <div>
          <span className="gv-kicker">
            <Compass size={13} /> Local ML + Editorial AI Curation
          </span>
          <h1 className="gv-hero-title" style={{ fontSize: "clamp(2.4rem, 3.6vw, 3.6rem)" }}>
            Game Oracle
          </h1>
          <p className="gv-section-sub">
            Your local EASE^R + Spectral-EASE + BGE-large models lock the mathematical match %; Gemini curates the pitch.
          </p>
        </div>
        {source && (
          <span className="gv-pill gv-pill-match">
            <Sparkles size={13} /> {source === "gemini" ? "Local ML + Gemini Curated" : "Local ML Engine (Offline)"}
          </span>
        )}
      </div>

      <form onSubmit={handleGenerate} className="gv-panel flex flex-col gap-5">
        <div>
          <label className="block text-[1.25rem] font-semibold text-text-2 mb-2">Pick a Mood or Gameplay Vibe</label>
          <div className="gv-chip-group">
            {GAME_ORACLE_MOODS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`gv-chip ${selectedMood === m.id ? "is-active" : ""}`}
                onClick={() => setSelectedMood(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label htmlFor="gv-vibe-input" className="block text-[1.25rem] font-semibold text-text-2 mb-2">
              Optional Specific Request
            </label>
            <input
              id="gv-vibe-input"
              type="text"
              value={customVibe}
              onChange={(e) => setCustomVibe(e.target.value)}
              placeholder="e.g. atmospheric dark fantasy under 25 hours, or tactical roguelike for Steam Deck..."
              className="gv-input"
            />
          </div>
          <div>
            <label htmlFor="gv-oracle-plat" className="block text-[1.25rem] font-semibold text-text-2 mb-2">
              Platform Focus
            </label>
            <select
              id="gv-oracle-plat"
              value={platformFamily}
              onChange={(e) => setPlatformFamily(e.target.value)}
              className="gv-input"
            >
              {GAME_PLATFORM_FAMILIES.map((pf) => (
                <option key={pf.id} value={pf.id}>
                  {pf.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={loading || modelsLoading || played.length === 0}
            className="gv-btn gv-btn-primary"
          >
            <Sparkles size={15} />
            {loading ? "Consulting Local Models & Oracle..." : "Generate 12 Personalized Picks"}
          </button>
          {played.length === 0 && (
            <span className="text-[1.3rem] text-text-3">
              Log at least 1 game on <Link to="/games" className="text-accent underline">Discover</Link> first.
            </span>
          )}
        </div>
      </form>

      {error && <p className="text-[1.4rem] text-danger mb-6">{error}</p>}

      {picks.length > 0 && (
        <div className="gv-oracle-grid">
          {picks.map((pick, idx) => {
            const logged = playedById.get(pick.igdbId);
            const inBacklog = backlogIds.has(pick.igdbId);
            return (
              <article key={pick.igdbId} className="gv-oracle-card">
                <Link to={`/game/${pick.igdbId}`}>
                  <img src={pick.coverUrl} alt={pick.title} className="gv-oracle-cover" loading="lazy" />
                </Link>
                <div className="flex flex-col min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-[1.15rem] font-bold text-text-3">#{idx + 1}</span>
                    <span className="gv-badge-match">{pick.matchScore}% Match</span>
                    {pick.isColdStart && <span className="gv-pill">Cold-Start AI</span>}
                    {pick.year && <span className="text-[1.2rem] text-text-3">{pick.year}</span>}
                  </div>
                  <Link to={`/game/${pick.igdbId}`} className="gv-card-title" style={{ fontSize: "1.7rem" }}>
                    {pick.title}
                  </Link>
                  {pick.anchorTitles?.length > 0 && (
                    <div className="text-[1.18rem] text-accent mt-1">
                      Because you loved {pick.anchorTitles.join(" & ")}
                    </div>
                  )}
                  <p className="gv-oracle-pitch">{pick.pitch}</p>
                  <div className="gv-card-reasons mb-3">
                    {(pick.matchReasons || []).map((r) => (
                      <span key={r} className="gv-reason-chip">{r}</span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-auto">
                    <button
                      type="button"
                      className={`gv-btn gv-btn-sm ${logged ? "gv-btn-primary" : ""}`}
                      onClick={() => setRateTarget({ ...pick, ...(logged || {}) })}
                    >
                      <Star size={13} /> {logged ? `Rated ${logged.userRating}/10` : "Rate"}
                    </button>
                    {!logged && (
                      <button type="button" className="gv-btn gv-btn-sm" onClick={() => toggleBacklogGame(pick)}>
                        <Bookmark size={13} /> {inBacklog ? "Saved" : "Backlog"}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
