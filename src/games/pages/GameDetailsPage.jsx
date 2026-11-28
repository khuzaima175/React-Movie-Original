import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  MessageSquare,
  Play,
  X
} from "lucide-react";
import { useGameVault } from "../context/GameVaultContext";
import { fetchGameDetails, fetchGamesBatch } from "../services/igdbService";
import { findSimilarGameIds, rankGameCandidates } from "../services/gameRankerService";
import { isGameCompatibleWithRig } from "../services/gameRigService";
import { buildTrailerEmbedUrl } from "../../services/navHelpers";
import { flyToVault } from "../../services/flyToVault";
import ScrollRevealSection from "../../components/ScrollRevealSection";
import GameRatingStage from "../components/GameRatingStage";
import GameCarouselRow from "../components/GameCarouselRow";
import { EASE } from "../../motion";

export default function GameDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    played,
    backlog,
    playedById,
    backlogIds,
    dismissedIds,
    models,
    rigProfile,
    savePlayedGame,
    removePlayedGame,
    toggleBacklogGame
  } = useGameVault();
  const [game, setGame] = useState(null);
  const [similarGames, setSimilarGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showTrailer, setShowTrailer] = useState(false);
  const [showFullStory, setShowFullStory] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState(-1);

  const igdbId = Number(id);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setShowTrailer(false);
    setLightboxIdx(-1);
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

  // Keyboard navigation for Screenshot Lightbox
  useEffect(() => {
    if (lightboxIdx < 0 || !game?.screenshots?.length) return undefined;
    const len = game.screenshots.length;
    const onKey = (e) => {
      if (e.key === "Escape") setLightboxIdx(-1);
      else if (e.key === "ArrowRight") setLightboxIdx((i) => (i + 1) % len);
      else if (e.key === "ArrowLeft") setLightboxIdx((i) => (i - 1 + len) % len);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIdx, game?.screenshots?.length]);

  // Hybrid Similar Games via EASE^R + 128-D Tag-Dropout BGE-large cold-start vectors
  useEffect(() => {
    if (!game) return undefined;
    let active = true;
    const simIds = findSimilarGameIds(game.igdbId, models, {
      limit: 14,
      fallbackIds: game.similarGameIds || []
    });
    if (simIds.length === 0) {
      setSimilarGames([]);
      return undefined;
    }
    fetchGamesBatch(simIds)
      .then((items) => {
        if (!active) return;
        const ranked = played.length > 0 ? rankGameCandidates(items, played, backlog, models, null, { dismissedIds }) : items;
        setSimilarGames(ranked);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [game, models, played, backlog, dismissedIds]);

  const personalMatch = useMemo(() => {
    if (!game || played.length === 0 || (!models.easeIndex && !models.contentIndex)) return null;
    return rankGameCandidates([game], played, backlog, models, null, { dismissedIds })[0] || null;
  }, [game, played, backlog, models, dismissedIds]);

  const logged = game ? playedById.get(game.igdbId) : null;
  const inBacklog = game ? backlogIds.has(game.igdbId) : false;
  const trailerUrl = game?.trailerKey ? buildTrailerEmbedUrl(game.trailerKey) : null;
  const rigCheck = useMemo(() => (game ? isGameCompatibleWithRig(game, rigProfile) : null), [game, rigProfile]);

  if (loading) {
    return (
      <div className="gv-page page-rail">
        <div className="gv-skeleton" style={{ height: "46rem" }} />
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

      {/* Full-Bleed Cinematic Backdrop Dossier Hero */}
      <div className="gv-details-backdrop-wrap">
        {(game.backdropUrl || game.coverUrl) && (
          <img src={game.backdropUrl || game.coverUrl} alt="" className="gv-details-backdrop-img" />
        )}
        <div className="gv-details-backdrop-scrim" />

        <div className="gv-details-grid">
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.4, ease: EASE }}
          >
            {game.coverUrl && <img src={game.coverUrl} alt={game.title} className="gv-details-cover" />}
            <div className="flex flex-col gap-3 mt-4">
              {!logged && (
                <button
                  type="button"
                  className={`gv-btn w-full ${inBacklog ? "gv-btn-saved" : ""}`}
                  onClick={(e) => {
                    if (!inBacklog && game.coverUrl) flyToVault(e.currentTarget, game.coverUrl);
                    toggleBacklogGame(game);
                  }}
                >
                  {inBacklog ? <Check size={15} /> : <Bookmark size={15} />}
                  {inBacklog ? "Saved in Backlog" : "Add to Backlog"}
                </button>
              )}
              <Link
                to={`/games/oracle?tab=chat&game=${game.igdbId}`}
                className="gv-btn w-full"
              >
                <MessageSquare size={15} /> Discuss This Game
              </Link>
              {trailerUrl && (
                <button type="button" className="gv-btn w-full" onClick={() => setShowTrailer((v) => !v)}>
                  <Play size={15} /> {showTrailer ? "Hide Trailer" : "Watch Trailer"}
                </button>
              )}
              {game.igdbUrl && (
                <a href={game.igdbUrl} target="_blank" rel="noreferrer" className="gv-btn gv-btn-sm w-full">
                  View on IGDB <ExternalLink size={13} />
                </a>
              )}
            </div>
          </motion.div>

          <motion.div
            className="flex flex-col gap-5"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, delay: 0.06, ease: EASE }}
          >
            <div>
              <div className="gv-hero-meta mb-3">
                {game.rating10 && (
                  <span className="gv-pill gv-pill-accent tabular-num">
                    IGDB {game.rating10.toFixed(1)}/10 ({game.ratingCount.toLocaleString()} ratings)
                  </span>
                )}
                {game.year && <span className="gv-pill tabular-num">{game.year}</span>}
                {game.isExclusive && <span className="gv-pill">Console Exclusive</span>}
                {rigCheck?.badgeLabel && (
                  <span className={`gv-pill ${rigCheck.compatible ? "gv-pill-match" : "gv-pill-accent"}`}>
                    {rigCheck.badgeLabel}
                  </span>
                )}
              </div>

              <h1 className="gv-hero-title">{game.title}</h1>
            </div>

            {/* Universal Personal Taste Match + Predicted Rating Tile */}
            {personalMatch && (
              <div className="gv-match-tile">
                <div>
                  <div className="text-[1.1rem] uppercase tracking-wider text-match font-bold">For You</div>
                  <div className="text-[2.2rem] font-bold text-match leading-none tabular-num">
                    {personalMatch.matchScore}% Match
                  </div>
                  {personalMatch.anchorTitles?.length > 0 && (
                    <div className="text-[1.15rem] text-accent mt-1">
                      Because you loved {personalMatch.anchorTitles.join(" & ")}
                    </div>
                  )}
                </div>
                {personalMatch.estRating && (
                  <div className="pl-4 border-l border-hairline">
                    <div className="text-[1.1rem] uppercase tracking-wider text-text-3 font-semibold">Est. Score</div>
                    <div className="text-[2rem] font-bold text-text-1 leading-none tabular-num">
                      {personalMatch.estRating.toFixed(1)}<span className="text-[1.25rem] text-text-3">/10</span>
                    </div>
                  </div>
                )}
                {personalMatch.matchReasons?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pl-4 border-l border-hairline">
                    {personalMatch.matchReasons.map((r) => (
                      <span key={r} className="gv-reason-chip">{r}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {game.summary && (
              <p className="text-[1.48rem] leading-relaxed text-text-2">
                {game.summary.length > 420 && !showFullStory
                  ? `${game.summary.slice(0, 420).trimEnd()}…`
                  : game.summary}
              </p>
            )}
            {game.storyline && game.storyline !== game.summary && (
              <div>
                <button
                  type="button"
                  className="gv-story-toggle"
                  onClick={() => setShowFullStory((v) => !v)}
                >
                  {showFullStory ? "Hide full storyline ↑" : "Read full storyline →"}
                </button>
                {showFullStory && (
                  <p className="text-[1.35rem] leading-relaxed text-text-3 mt-2.5">
                    {game.storyline}
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-hairline text-[1.3rem]">
              {game.developers?.length > 0 && (
                <div>
                  <span className="text-text-3 block text-[1.12rem] uppercase tracking-wider">Developer</span>
                  <span className="text-text-1 font-medium">{game.developers.join(", ")}</span>
                </div>
              )}
              {game.publishers?.length > 0 && (
                <div>
                  <span className="text-text-3 block text-[1.12rem] uppercase tracking-wider">Publisher</span>
                  <span className="text-text-1 font-medium">{game.publishers.join(", ")}</span>
                </div>
              )}
              {game.platforms?.length > 0 && (
                <div>
                  <span className="text-text-3 block text-[1.12rem] uppercase tracking-wider">Platforms</span>
                  <span className="text-text-1 font-medium">{game.platforms.join(" · ")}</span>
                </div>
              )}
              {(game.genres?.length > 0 || game.themes?.length > 0) && (
                <div>
                  <span className="text-text-3 block text-[1.12rem] uppercase tracking-wider">Genres &amp; Themes</span>
                  <span className="text-text-1 font-medium">
                    {[...(game.genres || []), ...(game.themes || [])].slice(0, 6).join(" · ")}
                  </span>
                </div>
              )}
            </div>

            {showTrailer && trailerUrl && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: EASE }}
                style={{ aspectRatio: "16/9", width: "100%", borderRadius: "var(--r-md)", overflow: "hidden", border: "1px solid var(--hairline)" }}
              >
                <iframe
                  src={trailerUrl}
                  title={`${game.title} Trailer`}
                  width="100%"
                  height="100%"
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  style={{ border: 0 }}
                />
              </motion.div>
            )}
          </motion.div>
        </div>
      </div>

      {/* Inline Flagship Ascending 10-Bar Game Rating Studio */}
      <ScrollRevealSection className="gv-section">
        <GameRatingStage
          key={`${game.igdbId}-${logged?.updatedAt || "new"}`}
          game={game}
          existing={logged}
          played={played}
          onSave={savePlayedGame}
          onRemove={removePlayedGame}
        />
      </ScrollRevealSection>

      {/* Interactive Screenshots with Full-Screen Lightbox */}
      {game.screenshots?.length > 0 && (
        <ScrollRevealSection className="gv-section">
          <h2 className="gv-section-title mb-4">Screenshots</h2>
          <div className="gv-screenshots-grid">
            {game.screenshots.slice(0, 6).map((src, idx) => (
              <button
                key={src}
                type="button"
                className="gv-screenshot-btn"
                onClick={() => setLightboxIdx(idx)}
                aria-label={`View screenshot ${idx + 1} full screen`}
              >
                <img src={src} alt={`${game.title} screenshot ${idx + 1}`} loading="lazy" className="gv-screenshot" />
              </button>
            ))}
          </div>
        </ScrollRevealSection>
      )}

      {/* Opt-In Smooth Horizontal Carousel for Hybrid Similar Games */}
      {similarGames.length > 0 && (
        <GameCarouselRow
          title="Similar Games"
          subtitle="Hybrid neighbors from our EASE^R (K=80) co-play graph & 128-D neural cold-start embeddings."
          games={similarGames}
          showMatch={played.length > 0}
        />
      )}

      {/* Screenshot Lightbox */}
      <AnimatePresence>
        {lightboxIdx >= 0 && game.screenshots?.[lightboxIdx] && (
          <motion.div
            className="gv-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Screenshot lightbox"
            onClick={() => setLightboxIdx(-1)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="relative max-w-[92vw] max-h-[88vh] flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="gv-carousel-arrow"
                onClick={() => setLightboxIdx((i) => (i - 1 + game.screenshots.length) % game.screenshots.length)}
                aria-label="Previous screenshot"
              >
                <ChevronLeft size={18} />
              </button>
              <motion.img
                key={game.screenshots[lightboxIdx]}
                src={game.screenshots[lightboxIdx]}
                alt={`${game.title} screenshot`}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2, ease: EASE }}
                style={{ maxWidth: "82vw", maxHeight: "84vh", borderRadius: "var(--r-md)", border: "1px solid var(--hairline-strong)" }}
              />
              <button
                type="button"
                className="gv-carousel-arrow"
                onClick={() => setLightboxIdx((i) => (i + 1) % game.screenshots.length)}
                aria-label="Next screenshot"
              >
                <ChevronRight size={18} />
              </button>
              <button
                type="button"
                className="gv-carousel-arrow"
                style={{ position: "absolute", top: "-4.4rem", right: 0 }}
                onClick={() => setLightboxIdx(-1)}
                aria-label="Close lightbox"
              >
                <X size={18} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
