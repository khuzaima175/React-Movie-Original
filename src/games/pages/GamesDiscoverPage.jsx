import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useGameVault } from "../context/GameVaultContext";
import { discoverGames, fetchGamesBatch } from "../services/igdbService";
import {
  buildGameRecommendationIds,
  filterDuplicateGameEditions,
  rankGameCandidates
} from "../services/gameRankerService";
import { STARTER_CALIBRATION_GAMES } from "../services/gameOracleService";
import ScrollRevealSection from "../../components/ScrollRevealSection";
import GameHeroBillboard from "../components/GameHeroBillboard";
import GameCarouselRow from "../components/GameCarouselRow";
import { EASE } from "../../motion";

export default function GamesDiscoverPage() {
  const {
    played,
    backlog,
    playedById,
    backlogIds,
    dismissedIds,
    models,
    modelsLoading,
    savePlayedGame,
    toggleBacklogGame,
    setRateTarget,
    openRoulette
  } = useGameVault();
  const [recentHits, setRecentHits] = useState([]);
  const [exclusives, setExclusives] = useState([]);
  const [topRated, setTopRated] = useState([]);
  const [forYouPicks, setForYouPicks] = useState([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingForYou, setLoadingForYou] = useState(false);
  const [skippedIds, setSkippedIds] = useState(() => new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Discover Games | GameVault";
    let active = true;
    setLoadingCatalog(true);
    setError("");
    Promise.all([
      discoverGames({ preset: "recent_hits", limit: 16 }),
      discoverGames({ preset: "exclusives", limit: 16 }),
      discoverGames({ preset: "top_rated", limit: 16 })
    ])
      .then(([recent, excl, top]) => {
        if (!active) return;
        setRecentHits(recent);
        setExclusives(excl);
        setTopRated(top);
      })
      .catch(() => {
        if (active) setError("Could not reach IGDB proxy. Check IGDB_CLIENT_ID & IGDB_CLIENT_SECRET.");
      })
      .finally(() => {
        if (active) setLoadingCatalog(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Personalized local ML picks (deduped against played editions + dismissed games)
  useEffect(() => {
    if (modelsLoading || played.length === 0 || (!models.easeIndex && !models.contentIndex)) {
      setForYouPicks([]);
      return undefined;
    }
    let active = true;
    setLoadingForYou(true);
    const { allIds, maps } = buildGameRecommendationIds(played, backlog, models, { warmLimit: 32, coldLimit: 14 });
    fetchGamesBatch(allIds.slice(0, 28))
      .then((hydrated) => {
        if (!active) return;
        const clean = filterDuplicateGameEditions(hydrated, played).filter((g) => !dismissedIds.has(g.igdbId));
        const ranked = rankGameCandidates(clean, played, backlog, models, maps);
        setForYouPicks(ranked.slice(0, 16));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingForYou(false);
      });
    return () => {
      active = false;
    };
  }, [played, backlog, dismissedIds, models, modelsLoading]);

  const starterCards = useMemo(() => {
    return STARTER_CALIBRATION_GAMES.filter((g) => !playedById.has(g.igdbId) && !skippedIds.has(g.igdbId)).slice(0, 8);
  }, [playedById, skippedIds]);

  const heroSlides = useMemo(() => {
    if (forYouPicks.length > 0) return forYouPicks.slice(0, 5);
    if (recentHits.length > 0) return recentHits.slice(0, 5);
    return topRated.slice(0, 5);
  }, [forYouPicks, recentHits, topRated]);

  return (
    <div className="gv-page page-rail">
      {error && (
        <div className="gv-panel" style={{ borderColor: "var(--danger)" }}>
          <p className="text-[1.4rem] text-danger">{error}</p>
        </div>
      )}

      {/* Multi-Slide Rotating Editorial Hero Billboard with Ken Burns + Scroll Parallax */}
      <GameHeroBillboard
        slides={heroSlides}
        isPersonalized={forYouPicks.length > 0}
        playedById={playedById}
        backlogIds={backlogIds}
        onRate={setRateTarget}
        onToggleBacklog={toggleBacklogGame}
        onOpenRoulette={() => openRoulette(forYouPicks.length > 0 ? forYouPicks : recentHits)}
      />

      {/* Animated 1-Tap Taste Calibration Strip (when < 3 games rated) */}
      {played.length < 3 && starterCards.length > 0 && (
        <ScrollRevealSection className="gv-panel" delay={0.04}>
          <div className="gv-section-header" style={{ marginBottom: "1.4rem" }}>
            <div>
              <span className="gv-kicker">
                <Sparkles size={13} /> Instant Taste Calibration ({played.length} / 3)
              </span>
              <h2 className="gv-section-title">Tap a few games you know to unlock local ML picks</h2>
              <p className="gv-section-sub">
                Runs 100% locally in your browser across 24,439 PC, PlayStation, Nintendo &amp; Xbox games.
              </p>
            </div>
            <Link to="/games/vault" className="gv-btn gv-btn-sm">
              Import Steam IDs / JSON
            </Link>
          </div>

          <div className="gv-grid-compact">
            <AnimatePresence mode="popLayout">
              {starterCards.map((g) => (
                <motion.div
                  key={g.igdbId}
                  layout
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.88, y: -10 }}
                  transition={{ duration: 0.24, ease: EASE }}
                  className="gv-card"
                >
                  <Link to={`/game/${g.igdbId}`} className="gv-card-cover-wrap">
                    <img src={g.coverUrl} alt={g.title} loading="lazy" className="gv-card-cover" />
                    <div className="gv-card-sheen" aria-hidden="true" />
                  </Link>
                  <div className="gv-card-body">
                    <div className="gv-card-title">{g.title}</div>
                    <div className="gv-card-meta">{g.primaryGenre} · {g.year}</div>
                    <div className="gv-card-footer">
                      <button
                        type="button"
                        className="gv-card-action is-active"
                        onClick={() => savePlayedGame(g, { userRating: 9, status: "completed" })}
                      >
                        Love (9)
                      </button>
                      <button
                        type="button"
                        className="gv-card-action"
                        onClick={() => savePlayedGame(g, { userRating: 7, status: "played" })}
                      >
                        Like (7)
                      </button>
                      <button
                        type="button"
                        className="gv-card-action"
                        onClick={() => setSkippedIds((prev) => new Set([...prev, g.igdbId]))}
                        title="Skip"
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </ScrollRevealSection>
      )}

      {/* Opt-In Smooth Horizontal Carousels */}
      {played.length > 0 && (
        <GameCarouselRow
          title="Games You'll Love"
          subtitle="Powered locally by EASE^R (K=80) + Spectral-EASE + Tag-Dropout BGE-large cold-start vectors."
          games={forYouPicks}
          showMatch
          loading={loadingForYou}
          seeAllTo="/games/explore"
          seeAllLabel="Open Taste Tuner"
        />
      )}

      <GameCarouselRow
        title="2024–2026 Standouts"
        subtitle="Recent hits covered by our 24.4k neural cold-start embedding index."
        games={recentHits}
        showMatch={false}
        loading={loadingCatalog}
        seeAllTo="/games/explore?tab=catalog&sort=recent"
        seeAllLabel="Explore Recent"
      />

      <GameCarouselRow
        title="Console Exclusives & Icons"
        subtitle="PlayStation & Nintendo classics bridged seamlessly into your taste space."
        games={exclusives}
        showMatch={false}
        loading={loadingCatalog}
      />

      <GameCarouselRow
        title="All-Time Acclaimed"
        subtitle="Highest-rated canonical games across every generation."
        games={topRated}
        showMatch={false}
        loading={loadingCatalog}
      />
    </div>
  );
}
