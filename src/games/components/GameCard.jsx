import { memo } from "react";
import { Link } from "react-router-dom";
import { Bookmark, Check, Gamepad2, Star, Trophy } from "lucide-react";
import { useGameVault } from "../context/GameVaultContext";
import { GAME_STATUS_SHORT_LABELS } from "../services/gameVaultStorage";
import { useScrollReveal } from "../../hooks/useScrollReveal";
import { flyToVault } from "../../services/flyToVault";

const GameCard = memo(function GameCard({
  game,
  showMatch = true,
  index = 0,
  animateOnScroll = false,
  revealIndex = index
}) {
  const { playedById, backlogIds, setRateTarget, toggleBacklogGame } = useGameVault();
  const [revealRef, isRevealed] = useScrollReveal({
    rootMargin: "0px 0px -24px 0px",
    threshold: 0.05,
    eagerOffset: -20,
    disabled: !animateOnScroll || !game?.igdbId
  });
  if (!game?.igdbId) return null;

  const logged = playedById.get(game.igdbId);
  const inBacklog = backlogIds.has(game.igdbId);
  const primaryReason = Array.isArray(game.matchReasons) && game.matchReasons.length > 0
    ? game.matchReasons[0]
    : "";
  const revealDelayMs = animateOnScroll
    ? Math.min((revealIndex % 7) * 30, 180)
    : 0;

  const statusTag = logged?.status === "platinum"
    ? { label: "100%", className: "is-platinum", icon: Trophy }
    : logged?.status === "playing"
      ? { label: "Playing", className: "is-playing" }
      : logged?.status === "on_hold"
        ? { label: "Paused", className: "" }
        : logged?.status === "tried_bored"
          ? { label: "Bored", className: "" }
          : logged?.status === "dropped"
            ? { label: "Dropped", className: "" }
            : null;

  return (
    <article
      ref={animateOnScroll ? revealRef : undefined}
      className={`gv-card ${animateOnScroll ? `gv-card-reveal ${isRevealed ? "is-revealed" : ""}` : ""}`}
      style={animateOnScroll ? { "--gv-reveal-delay": `${revealDelayMs}ms` } : undefined}
    >
      <div className="gv-card-cover-wrap">
        <Link to={`/game/${game.igdbId}`} className="block w-full h-full" aria-label={game.title}>
          {game.coverUrl ? (
            <img
              src={game.coverUrl}
              alt={game.title}
              loading="lazy"
              decoding="async"
              className="gv-card-cover"
            />
          ) : (
            <div className="gv-card-placeholder">
              <Gamepad2 size={24} aria-hidden="true" />
              <span>{game.title}</span>
            </div>
          )}
        </Link>

        <div className="gv-card-sheen" aria-hidden="true" />
        <div className="gv-card-cover-vignette" aria-hidden="true" />

        {showMatch && Number.isFinite(Number(game.matchScore)) && (
          <div className="gv-card-top-badges">
            <span className="gv-badge-match tabular-num">{game.matchScore}% Match</span>
          </div>
        )}

        {(statusTag || logged?.hoursPlayed > 0) && (
          <div className="gv-card-bottom-strip">
            {statusTag && (
              <span className={`gv-mini-status ${statusTag.className}`}>
                {statusTag.icon && <statusTag.icon size={10} aria-hidden="true" />}
                {statusTag.label}
              </span>
            )}
            {logged?.hoursPlayed > 0 && (
              <span className="gv-mini-status tabular-num">{logged.hoursPlayed}h</span>
            )}
          </div>
        )}

        {/* Desktop-only floating quick actions (hidden on touch devices so mobile stays crisp) */}
        <div className="gv-card-hover-actions">
          <button
            type="button"
            className={`gv-card-hover-btn ${logged ? "is-active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setRateTarget({ ...game, ...(logged || {}) });
            }}
            title={
              logged?.userRating
                ? `Rated ${logged.userRating}/10`
                : logged
                  ? (GAME_STATUS_SHORT_LABELS[logged.status] || "Edit Entry")
                  : `Rate ${game.title}`
            }
            aria-label={logged ? `Edit rating for ${game.title}` : `Rate ${game.title}`}
          >
            <Star size={14} fill={logged?.userRating ? "currentColor" : "none"} aria-hidden="true" />
          </button>

          {!logged && (
            <button
              type="button"
              className={`gv-card-hover-btn ${inBacklog ? "is-active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                if (!inBacklog && game.coverUrl) flyToVault(e.currentTarget, game.coverUrl);
                toggleBacklogGame(game);
              }}
              title={inBacklog ? "Remove from Backlog" : "Save to Backlog"}
              aria-label={inBacklog ? `Remove ${game.title} from Backlog` : `Save ${game.title} to Backlog`}
            >
              {inBacklog ? <Check size={14} aria-hidden="true" /> : <Bookmark size={14} aria-hidden="true" />}
            </button>
          )}
        </div>
      </div>

      <div className="gv-card-body">
        <Link to={`/game/${game.igdbId}`} className="gv-card-title" title={game.title}>
          {game.title}
        </Link>

        <div className="gv-card-meta-row">
          <span className="truncate">
            {game.year ? <span className="tabular-num">{game.year}</span> : "—"}
          </span>

          {logged?.userRating > 0 ? (
            <span className="gv-card-score is-user tabular-num" title="Your Rating">
              <Star size={11} fill="currentColor" aria-hidden="true" />
              {logged.userRating}
            </span>
          ) : game.rating10 ? (
            <span className="gv-card-score tabular-num" title="IGDB Score">
              <Star size={11} fill="currentColor" aria-hidden="true" />
              {game.rating10.toFixed(1)}
            </span>
          ) : null}
        </div>

        {showMatch && primaryReason && (
          <div className="gv-card-reason" title={primaryReason}>
            {primaryReason}
          </div>
        )}
      </div>
    </article>
  );
});

export default GameCard;
