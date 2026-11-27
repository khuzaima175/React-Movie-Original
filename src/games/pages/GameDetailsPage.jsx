import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Bookmark, Play, Star, ExternalLink } from "lucide-react";
import { useGameVault } from "../context/GameVaultContext";
import { fetchGameDetails, fetchGamesBatch } from "../services/igdbService";
import { findSimilarGameIds, rankGameCandidates } from "../services/gameRankerService";
import { buildTrailerEmbedUrl } from "../../services/navHelpers";
import GameCard from "../components/GameCard";

export default function GameDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { played, backlog, playedById, backlogIds, models, setRateTarget, toggleBacklogGame } = useGameVault();
  const [game, setGame] = useState(null);
  const [similarGames, setSimilarGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showTrailer, setShowTrailer] = useState(false);

  const igdbId = Number(id);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setShowTrailer(false);
    fetchGameDetails(igdbId)
      .then((detail) => {
        if (!active) return;
        setGame(detail);
        if (detail?.title) {
          document.title = `${detail.title} | GameVault`;
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [igdbId]);

  // Compute Hybrid Similar Games via EASE^R + 128-D Tag-Dropout BGE-large cold-start vectors
  useEffect(() => {
    if (!game) return;
    let active = true;
    const simIds = findSimilarGameIds(game.igdbId, models, {
      limit: 12,
      fallbackIds: game.similarGameIds || []
    });
    if (simIds.length === 0) {
      setSimilarGames([]);
      return;
    }
    fetchGamesBatch(simIds)
      .then((items) => {
        if (!active) return;
        const ranked = played.length > 0 ? rankGameCandidates(items, played, backlog, models) : items;
        setSimilarGames(ranked);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [game, models, played, backlog]);

  const personalMatch = useMemo(() => {
    if (!game || played.length === 0 || (!models.easeIndex && !models.contentIndex)) return null;
    return rankGameCandidates([game], played, backlog, models)[0] || null;
  }, [game, played, backlog, models]);

  const logged = game ? playedById.get(game.igdbId) : null;
  const inBacklog = game ? backlogIds.has(game.igdbId) : false;
  const trailerUrl = game?.trailerKey ? buildTrailerEmbedUrl(game.trailerKey) : null;

  if (loading) {
    return (
      <div className="gv-page page-rail">
        <div className="gv-skeleton" style={{ height: "42rem" }} />
      </div>
    );
  }

  if (!game) {
    return (
      <div className="gv-page page-rail">
        <div className="gv-panel text-center py-12">
          <h2 className="gv-section-title mb-3">Game not found</h2>
          <button type="button" className="gv-btn" onClick={() => navigate("/games")}>
            Back to Game Discover
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gv-page page-rail">
      <button type="button" className="gv-btn gv-btn-sm mb-6" onClick={() => navigate(-1)}>
        <ArrowLeft size={14} /> Back
      </button>

      <div className="gv-details-grid mb-12">
        <div>
          {game.coverUrl && <img src={game.coverUrl} alt={game.title} className="gv-details-cover" />}
          <div className="flex flex-col gap-3 mt-4">
            <button
              type="button"
              className="gv-btn gv-btn-primary w-full"
              onClick={() => setRateTarget({ ...game, ...(logged || {}) })}
            >
              <Star size={15} />
              {logged?.userRating ? `Rated ${logged.userRating}/10 · Edit Log` : "Log & Rate Game"}
            </button>
            {!logged && (
              <button type="button" className="gv-btn w-full" onClick={() => toggleBacklogGame(game)}>
                <Bookmark size={15} /> {inBacklog ? "Saved in Backlog" : "Add to Backlog"}
              </button>
            )}
            {trailerUrl && (
              <button type="button" className="gv-btn w-full" onClick={() => setShowTrailer((v) => !v)}>
                <Play size={15} /> {showTrailer ? "Hide Trailer" : "Watch Trailer"}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div>
            <div className="gv-hero-meta mb-3">
              {personalMatch?.matchScore && (
                <span className="gv-pill gv-pill-match">{personalMatch.matchScore}% Personal Taste Match</span>
              )}
              {game.rating10 && (
                <span className="gv-pill gv-pill-accent">
                  IGDB {game.rating10.toFixed(1)}/10 ({game.ratingCount.toLocaleString()} ratings)
                </span>
              )}
              {game.year && <span className="gv-pill">{game.year}</span>}
              {game.isExclusive && <span className="gv-pill">Console Exclusive</span>}
            </div>

            <h1 className="gv-hero-title">{game.title}</h1>
          </div>

          {logged && (
            <div className="gv-panel" style={{ marginBottom: 0, padding: "1.4rem 1.8rem" }}>
              <div className="text-[1.35rem] font-semibold text-accent">
                Your Log: {logged.userRating}/10 · {String(logged.status || "completed").toUpperCase()}
                {logged.hoursPlayed > 0 ? ` · ${logged.hoursPlayed}h played` : ""}
                {logged.platformPlayed ? ` · ${logged.platformPlayed}` : ""}
              </div>
              {logged.userNote && <p className="text-[1.35rem] text-text-2 mt-2">{logged.userNote}</p>}
            </div>
          )}

          {personalMatch?.matchReasons?.length > 0 && (
            <div className="gv-card-reasons">
              {personalMatch.matchReasons.map((r) => (
                <span key={r} className="gv-pill">{r}</span>
              ))}
            </div>
          )}

          {game.summary && <p className="text-[1.5rem] leading-relaxed text-text-2">{game.summary}</p>}
          {game.storyline && game.storyline !== game.summary && (
            <p className="text-[1.4rem] leading-relaxed text-text-3">{game.storyline}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-hairline text-[1.3rem]">
            {game.developers?.length > 0 && (
              <div>
                <span className="text-text-3 block text-[1.15rem] uppercase tracking-wider">Developer</span>
                <span className="text-text-1 font-medium">{game.developers.join(", ")}</span>
              </div>
            )}
            {game.publishers?.length > 0 && (
              <div>
                <span className="text-text-3 block text-[1.15rem] uppercase tracking-wider">Publisher</span>
                <span className="text-text-1 font-medium">{game.publishers.join(", ")}</span>
              </div>
            )}
            {game.platforms?.length > 0 && (
              <div>
                <span className="text-text-3 block text-[1.15rem] uppercase tracking-wider">Platforms</span>
                <span className="text-text-1 font-medium">{game.platforms.join(" · ")}</span>
              </div>
            )}
            {(game.genres?.length > 0 || game.themes?.length > 0) && (
              <div>
                <span className="text-text-3 block text-[1.15rem] uppercase tracking-wider">Genres &amp; Themes</span>
                <span className="text-text-1 font-medium">
                  {[...(game.genres || []), ...(game.themes || [])].slice(0, 6).join(" · ")}
                </span>
              </div>
            )}
          </div>

          {game.igdbUrl && (
            <div>
              <a href={game.igdbUrl} target="_blank" rel="noreferrer" className="gv-btn gv-btn-sm">
                View on IGDB <ExternalLink size={13} />
              </a>
            </div>
          )}

          {showTrailer && trailerUrl && (
            <div style={{ aspectRatio: "16/9", width: "100%", borderRadius: "var(--r-md)", overflow: "hidden", border: "1px solid var(--hairline)" }}>
              <iframe
                src={trailerUrl}
                title={`${game.title} Trailer`}
                width="100%"
                height="100%"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                style={{ border: 0 }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Screenshots */}
      {game.screenshots?.length > 0 && (
        <section className="gv-section">
          <h2 className="gv-section-title mb-4">Screenshots</h2>
          <div className="gv-screenshots-grid">
            {game.screenshots.slice(0, 6).map((src) => (
              <img key={src} src={src} alt={`${game.title} screenshot`} loading="lazy" className="gv-screenshot" />
            ))}
          </div>
        </section>
      )}

      {/* Hybrid Similar Games */}
      {similarGames.length > 0 && (
        <section className="gv-section">
          <div className="gv-section-header">
            <div>
              <h2 className="gv-section-title">Similar Games</h2>
              <p className="gv-section-sub">
                Hybrid neighbors from our EASE^R (K=80) co-play graph &amp; 128-D neural cold-start embeddings.
              </p>
            </div>
          </div>
          <div className="gv-grid">
            {similarGames.map((sim) => (
              <GameCard key={sim.igdbId} game={sim} showMatch={played.length > 0} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
