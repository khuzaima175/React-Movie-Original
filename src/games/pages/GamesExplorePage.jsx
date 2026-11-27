import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, RotateCcw, Sparkles } from "lucide-react";
import { useGameVault } from "../context/GameVaultContext";
import {
  GAME_GENRES,
  GAME_PLATFORM_FAMILIES,
  discoverGames,
  fetchGamesBatch
} from "../services/igdbService";
import {
  DEFAULT_GAME_TUNER_STATE,
  applyGameTuner,
  buildGameRecommendationIds,
  rankGameCandidates
} from "../services/gameRankerService";
import GameCard from "../components/GameCard";

export default function GamesExplorePage() {
  const { played, backlog, models, modelsLoading } = useGameVault();
  const [mode, setMode] = useState(() => (played.length > 0 ? "for-you" : "catalog"));
  const [platformFamily, setPlatformFamily] = useState("all");
  const [genreId, setGenreId] = useState("");
  const [sort, setSort] = useState("rating");
  const [tuner, setTuner] = useState(DEFAULT_GAME_TUNER_STATE);
  const [forYouPool, setForYouPool] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = "Explore Games | GameVault";
  }, []);

  // Load For-You ML pool (60 games: warm + cold-start)
  useEffect(() => {
    if (mode !== "for-you") return;
    if (modelsLoading || played.length === 0) return;
    let active = true;
    setLoading(true);
    const { allIds, maps } = buildGameRecommendationIds(played, backlog, models, { warmLimit: 42, coldLimit: 18 });
    fetchGamesBatch(allIds)
      .then((hydrated) => {
        if (!active) return;
        const ranked = rankGameCandidates(hydrated, played, backlog, models, maps);
        setForYouPool(ranked);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, played, backlog, models, modelsLoading]);

  // Load IGDB Catalog when in catalog mode
  useEffect(() => {
    if (mode !== "catalog") return;
    let active = true;
    setLoading(true);
    discoverGames({
      preset: "catalog",
      platformFamily,
      genreId: genreId ? Number(genreId) : null,
      sort,
      limit: 36
    })
      .then((items) => {
        if (!active) return;
        const enriched = played.length > 0 && (models.easeIndex || models.contentIndex)
          ? rankGameCandidates(items, played, backlog, models)
          : items;
        setCatalogItems(enriched);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, platformFamily, genreId, sort, played, backlog, models]);

  const displayedItems = useMemo(() => {
    const base = mode === "for-you" ? forYouPool : catalogItems;
    const filtered = base.filter((g) => {
      if (mode === "for-you") {
        if (platformFamily !== "all" && !(g.platformFamilies || []).includes(platformFamily)) return false;
        if (genreId && !(g.genreIds || []).includes(Number(genreId))) return false;
      }
      return true;
    });
    return applyGameTuner(filtered, tuner, {
      contentIndex: models.contentIndex,
      tunerAxes: models.tunerAxes,
      played
    });
  }, [mode, forYouPool, catalogItems, platformFamily, genreId, tuner, models, played]);

  const tunerIsNeutral =
    tuner.era === 0 && tuner.familiarity === 0 && tuner.pacing === 0 && tuner.tone === 0 && !tuner.antiBubble;

  return (
    <div className="gv-page page-rail">
      <div className="gv-section-header">
        <div>
          <span className="gv-kicker">
            <SlidersHorizontal size={13} /> Game Explore Workbench
          </span>
          <h1 className="gv-hero-title" style={{ fontSize: "clamp(2.4rem, 3.4vw, 3.4rem)" }}>
            {mode === "for-you" ? "Games Matched To Your Taste" : "Explore IGDB Catalog"}
          </h1>
          <p className="gv-section-sub">
            Re-rank instantaneously in your browser with popularity-decorrelated Intensity &amp; Tone neural axes.
          </p>
        </div>

        <div className="gv-chip-group">
          <button
            type="button"
            className={`gv-chip ${mode === "for-you" ? "is-active" : ""}`}
            onClick={() => setMode("for-you")}
          >
            <Sparkles size={13} style={{ display: "inline", marginRight: "0.4rem" }} />
            For You ({played.length > 0 ? forYouPool.length || "ML" : "Rate 1+"})
          </button>
          <button
            type="button"
            className={`gv-chip ${mode === "catalog" ? "is-active" : ""}`}
            onClick={() => setMode("catalog")}
          >
            IGDB Catalog
          </button>
        </div>
      </div>

      {/* Platform + Genre + Sort Filter Bar */}
      <div className="gv-filter-bar">
        <div className="gv-chip-group">
          {GAME_PLATFORM_FAMILIES.map((pf) => (
            <button
              key={pf.id}
              type="button"
              className={`gv-chip ${platformFamily === pf.id ? "is-active" : ""}`}
              onClick={() => setPlatformFamily(pf.id)}
            >
              {pf.label}
            </button>
          ))}
        </div>

        <select
          aria-label="Filter by genre"
          value={genreId}
          onChange={(e) => setGenreId(e.target.value)}
          className="gv-input"
          style={{ width: "auto", minWidth: "16rem" }}
        >
          <option value="">All Genres</option>
          {GAME_GENRES.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>

        {mode === "catalog" && (
          <select
            aria-label="Sort catalog"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="gv-input"
            style={{ width: "auto", minWidth: "15rem" }}
          >
            <option value="rating">Highest Rated</option>
            <option value="recent">Newest Releases</option>
            <option value="hypes">Most Hyped</option>
          </select>
        )}
      </div>

      {/* Live <1ms Taste Tuner Panel */}
      <section className="gv-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[1.6rem] font-semibold text-text-1">Live Neural Taste Tuner</h2>
            <p className="text-[1.2rem] text-text-3">
              Adjust dials to steer picks in &lt;1 ms using your 128-D Intensity (AUC 0.968) &amp; Tone (AUC 0.996) vectors.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className={`gv-chip ${tuner.antiBubble ? "is-active" : ""}`}
              onClick={() => setTuner((prev) => ({ ...prev, antiBubble: !prev.antiBubble }))}
            >
              Break My Bubble
            </button>
            {!tunerIsNeutral && (
              <button
                type="button"
                className="gv-btn gv-btn-sm"
                onClick={() => setTuner(DEFAULT_GAME_TUNER_STATE)}
              >
                <RotateCcw size={13} /> Reset
              </button>
            )}
          </div>
        </div>

        <div className="gv-tuner-grid">
          <div className="gv-slider-box">
            <div className="gv-slider-title">
              <span>Intensity</span>
              <span className="text-accent tabular-num">{tuner.pacing > 0 ? `+${tuner.pacing}` : tuner.pacing}</span>
            </div>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.2"
              value={tuner.pacing}
              onChange={(e) => setTuner((p) => ({ ...p, pacing: Number(e.target.value) }))}
              className="gv-range"
            />
            <div className="gv-slider-labels">
              <span>Cozy / Chill</span>
              <span>High-Octane Action</span>
            </div>
          </div>

          <div className="gv-slider-box">
            <div className="gv-slider-title">
              <span>Tone</span>
              <span className="text-accent tabular-num">{tuner.tone > 0 ? `+${tuner.tone}` : tuner.tone}</span>
            </div>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.2"
              value={tuner.tone}
              onChange={(e) => setTuner((p) => ({ ...p, tone: Number(e.target.value) }))}
              className="gv-range"
            />
            <div className="gv-slider-labels">
              <span>Dark / Horror</span>
              <span>Warm / Playful</span>
            </div>
          </div>

          <div className="gv-slider-box">
            <div className="gv-slider-title">
              <span>Era</span>
              <span className="text-accent tabular-num">{tuner.era > 0 ? `+${tuner.era}` : tuner.era}</span>
            </div>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.2"
              value={tuner.era}
              onChange={(e) => setTuner((p) => ({ ...p, era: Number(e.target.value) }))}
              className="gv-range"
            />
            <div className="gv-slider-labels">
              <span>Retro / Classics</span>
              <span>2024–2026 New</span>
            </div>
          </div>

          <div className="gv-slider-box">
            <div className="gv-slider-title">
              <span>Familiarity</span>
              <span className="text-accent tabular-num">{tuner.familiarity > 0 ? `+${tuner.familiarity}` : tuner.familiarity}</span>
            </div>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.2"
              value={tuner.familiarity}
              onChange={(e) => setTuner((p) => ({ ...p, familiarity: Number(e.target.value) }))}
              className="gv-range"
            />
            <div className="gv-slider-labels">
              <span>Blockbusters</span>
              <span>Hidden Gems</span>
            </div>
          </div>
        </div>
      </section>

      {/* Results Grid */}
      {mode === "for-you" && played.length === 0 ? (
        <div className="gv-panel text-center py-12">
          <h3 className="text-[1.8rem] font-semibold text-text-1 mb-2">Rate at least 1 game to unlock For You</h3>
          <p className="text-[1.35rem] text-text-3 mb-5">
            Switch to IGDB Catalog above or calibrate 3 starter games on Discover.
          </p>
          <button type="button" className="gv-btn gv-btn-primary" onClick={() => setMode("catalog")}>
            Browse IGDB Catalog
          </button>
        </div>
      ) : loading ? (
        <div className="gv-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="gv-skeleton" style={{ aspectRatio: "3/4.8" }} />
          ))}
        </div>
      ) : displayedItems.length === 0 ? (
        <div className="gv-panel text-center py-10">
          <p className="text-[1.45rem] text-text-2">No games matched those exact filters. Try clearing Genre or Platform.</p>
        </div>
      ) : (
        <div className="gv-grid">
          {displayedItems.map((game) => (
            <GameCard key={game.igdbId} game={game} showMatch={played.length > 0} />
          ))}
        </div>
      )}
    </div>
  );
}
