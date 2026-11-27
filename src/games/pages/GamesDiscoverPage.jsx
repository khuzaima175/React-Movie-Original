import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Compass, Star, Bookmark, SlidersHorizontal, Gamepad2 } from "lucide-react";
import { useGameVault } from "../context/GameVaultContext";
import { discoverGames, fetchGamesBatch } from "../services/igdbService";
import { buildGameRecommendationIds, rankGameCandidates } from "../services/gameRankerService";
import { STARTER_CALIBRATION_GAMES } from "../services/gameOracleService";
import GameCard from "../components/GameCard";

export default function GamesDiscoverPage() {
  const { played, backlog, playedById, backlogIds, models, modelsLoading, savePlayedGame, toggleBacklogGame, setRateTarget } = useGameVault();
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
      discoverGames({ preset: "recent_hits", limit: 12 }),
      discoverGames({ preset: "exclusives", limit: 12 }),
      discoverGames({ preset: "top_rated", limit: 12 })
    ])
      .then(([recent, excl, top]) => {
        if (!active) return;
        setRecentHits(recent);
        setExclusives(excl);
        setTopRated(top);
      })
      .catch(() => {
        if (active) setError("Could not reach IGDB proxy. Check IGDB_CLIENT_ID & IGDB_CLIENT_SECRET in .env.");
      })
      .finally(() => {
        if (active) setLoadingCatalog(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Compute personalized For-You picks whenever played vault or local ML models update
  useEffect(() => {
    if (modelsLoading || played.length === 0 || (!models.easeIndex && !models.contentIndex)) {
      setForYouPicks([]);
      return;
    }
    let active = true;
    setLoadingForYou(true);
    const { allIds, maps } = buildGameRecommendationIds(played, backlog, models, { warmLimit: 24, coldLimit: 10 });
    fetchGamesBatch(allIds.slice(0, 20))
      .then((hydrated) => {
        if (!active) return;
        const ranked = rankGameCandidates(hydrated, played, backlog, models, maps);
        setForYouPicks(ranked.slice(0, 12));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingForYou(false);
      });
    return () => {
      active = false;
    };
  }, [played, backlog, models, modelsLoading]);

  const starterCards = useMemo(() => {
    return STARTER_CALIBRATION_GAMES.filter((g) => !playedById.has(g.igdbId) && !skippedIds.has(g.igdbId)).slice(0, 8);
  }, [playedById, skippedIds]);

  const heroGame = forYouPicks[0] || recentHits[0] || topRated[0] || null;
  const heroLogged = heroGame ? playedById.get(heroGame.igdbId) : null;
  const heroInBacklog = heroGame ? backlogIds.has(heroGame.igdbId) : false;

  return (
    <div className="gv-page page-rail">
      {error && (
        <div className="gv-panel" style={{ borderColor: "var(--danger)" }}>
          <p className="text-[1.4rem] text-danger">{error}</p>
        </div>
      )}

      {/* Featured Hero */}
      {heroGame ? (
        <section className="gv-hero">
          {(heroGame.backdropUrl || heroGame.coverUrl) && (
            <img src={heroGame.backdropUrl || heroGame.coverUrl} alt="" className="gv-hero-bg" />
          )}
          <div className="gv-hero-scrim" />
          <div className="gv-hero-content">
            <span className="gv-kicker">
              <Gamepad2 size={14} aria-hidden="true" />
              {forYouPicks.length > 0 ? "Top Local ML Pick For You" : "Featured 2024–2026 Standout"}
            </span>
            <h1 className="gv-hero-title">{heroGame.title}</h1>
            <div className="gv-hero-meta">
              {heroGame.matchScore && <span className="gv-pill gv-pill-match">{heroGame.matchScore}% Match</span>}
              {heroGame.rating10 && <span className="gv-pill gv-pill-accent">IGDB {heroGame.rating10.toFixed(1)}/10</span>}
              {heroGame.year && <span className="gv-pill">{heroGame.year}</span>}
              {heroGame.genres?.slice(0, 2).map((g) => (
                <span key={g} className="gv-pill">{g}</span>
              ))}
            </div>
            {heroGame.summary && <p className="gv-hero-summary">{heroGame.summary}</p>}
            <div className="gv-actions-row">
              <Link to={`/game/${heroGame.igdbId}`} className="gv-btn gv-btn-primary">
                Inspect Dossier
              </Link>
              <button
                type="button"
                className="gv-btn"
                onClick={() => setRateTarget({ ...heroGame, ...(heroLogged || {}) })}
              >
                <Star size={15} /> {heroLogged ? `Rated ${heroLogged.userRating}/10` : "Rate Game"}
              </button>
              {!heroLogged && (
                <button type="button" className="gv-btn" onClick={() => toggleBacklogGame(heroGame)}>
                  <Bookmark size={15} /> {heroInBacklog ? "In Backlog" : "Add to Backlog"}
                </button>
              )}
              <Link to="/games/oracle" className="gv-btn">
                <Compass size={15} /> Open Game Oracle
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <div className="gv-skeleton" style={{ height: "34rem", marginBottom: "3.2rem" }} />
      )}

      {/* Fast 1-Tap Starter Calibration Strip (shown when < 3 games rated) */}
      {played.length < 3 && starterCards.length > 0 && (
        <section className="gv-panel">
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
            {starterCards.map((g) => (
              <div key={g.igdbId} className="gv-card">
                <Link to={`/game/${g.igdbId}`} className="gv-card-cover-wrap">
                  <img src={g.coverUrl} alt={g.title} loading="lazy" className="gv-card-cover" />
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
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Personalized For You Section */}
      {played.length > 0 && (
        <section className="gv-section">
          <div className="gv-section-header">
            <div>
              <h2 className="gv-section-title">Games You&apos;ll Love</h2>
              <p className="gv-section-sub">
                Powered locally by EASE^R (K=80) + Spectral-EASE + Tag-Dropout BGE-large cold-start vectors.
              </p>
            </div>
            <Link to="/games/explore" className="gv-btn gv-btn-sm">
              <SlidersHorizontal size={14} /> Open Taste Tuner
            </Link>
          </div>
          {loadingForYou ? (
            <div className="gv-grid">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="gv-skeleton" style={{ aspectRatio: "3/4.8" }} />
              ))}
            </div>
          ) : (
            <div className="gv-grid">
              {forYouPicks.map((game) => (
                <GameCard key={game.igdbId} game={game} showMatch />
              ))}
            </div>
          )}
        </section>
      )}

      {/* 2024-2026 Hits */}
      <section className="gv-section">
        <div className="gv-section-header">
          <div>
            <h2 className="gv-section-title">2024–2026 Standouts</h2>
            <p className="gv-section-sub">Recent hits covered by our 24.4k neural cold-start embedding index.</p>
          </div>
          <Link to="/games/explore?tab=catalog&sort=recent" className="gv-btn gv-btn-sm">
            Explore More
          </Link>
        </div>
        {loadingCatalog ? (
          <div className="gv-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="gv-skeleton" style={{ aspectRatio: "3/4.8" }} />
            ))}
          </div>
        ) : (
          <div className="gv-grid">
            {recentHits.map((game) => (
              <GameCard key={game.igdbId} game={game} showMatch={false} />
            ))}
          </div>
        )}
      </section>

      {/* PlayStation & Nintendo Exclusives */}
      <section className="gv-section">
        <div className="gv-section-header">
          <div>
            <h2 className="gv-section-title">Console Exclusives &amp; Icons</h2>
            <p className="gv-section-sub">PlayStation &amp; Nintendo classics bridged seamlessly into your taste space.</p>
          </div>
        </div>
        <div className="gv-grid">
          {exclusives.map((game) => (
            <GameCard key={game.igdbId} game={game} showMatch={false} />
          ))}
        </div>
      </section>

      {/* All-Time Acclaimed */}
      <section className="gv-section">
        <div className="gv-section-header">
          <div>
            <h2 className="gv-section-title">All-Time Acclaimed</h2>
            <p className="gv-section-sub">Highest-rated canonical games across every generation.</p>
          </div>
        </div>
        <div className="gv-grid">
          {topRated.map((game) => (
            <GameCard key={game.igdbId} game={game} showMatch={false} />
          ))}
        </div>
      </section>
    </div>
  );
}
