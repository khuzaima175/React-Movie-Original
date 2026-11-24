import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Check, ExternalLink, Heart, RotateCcw, Sparkles, X } from "lucide-react";
import PosterImage from "./PosterImage";
import { Button } from "./ui/Button";
import { evaluateSwipeRound } from "../services/watchTogetherService";
import { resolveProviderLaunchUrl } from "../services/watchLinkService";

function movieLink(item) {
  if (item?.imdbID && /^tt\d+$/i.test(item.imdbID)) return `/movie/${item.imdbID}`;
  if (item?.tmdbId) return `/movie/tmdb_${item.tmdbId}`;
  return null;
}

export default function WatchTogetherSwipeDeck({
  deck = [],
  role = "host",
  hostName = "You",
  guestName = "Partner",
  hostVotes = {},
  guestVotes = {},
  onVote,
  onRestart,
  busy = false
}) {
  const activeVotes = role === "guest" ? guestVotes : hostVotes;
  const evaluation = useMemo(
    () => evaluateSwipeRound({ deck, votesA: hostVotes, votesB: guestVotes }),
    [deck, hostVotes, guestVotes]
  );

  const nextUnvotedIndex = useMemo(
    () =>
      deck.findIndex((item) => {
        const key = String(item?.tmdbId ?? item?.id ?? "");
        return key && !activeVotes?.[key];
      }),
    [deck, activeVotes]
  );

  const currentItem = nextUnvotedIndex >= 0 ? deck[nextUnvotedIndex] : null;
  const votedCount = deck.filter((item) => Boolean(activeVotes?.[String(item?.tmdbId ?? item?.id ?? "")])).length;

  if (deck.length === 0) {
    return (
      <div className="together-empty-card">
        <Sparkles size={26} aria-hidden="true" />
        <h3>No swipe deck ready yet</h3>
        <p>Pick a @username or create a room to build your joint shortlist.</p>
      </div>
    );
  }

  if (evaluation.mutualMatches.length > 0) {
    const topMatch = evaluation.mutualMatches[0];
    const detailPath = movieLink(topMatch);
    const firstProvider = Array.isArray(topMatch.streamProviders) ? topMatch.streamProviders[0] : null;
    const launch = resolveProviderLaunchUrl({
      providerId: firstProvider?.id || null,
      providerName: firstProvider?.name || "JustWatch",
      title: topMatch.title,
      year: topMatch.year,
      watchProviderLink: topMatch.watchProviderLink
    });

    return (
      <div className="together-match-celebration" role="status" aria-live="polite">
        <span className="together-match-kicker">
          <Heart size={14} aria-hidden="true" />
          <span>It&apos;s a Movie Night Match!</span>
        </span>

        <div className="together-match-hero">
          <div className="together-match-poster">
            <PosterImage src={topMatch.poster} title={topMatch.title} />
          </div>
          <div className="together-match-copy">
            <h2>{topMatch.title}</h2>
            <p className="together-match-meta">
              {topMatch.year || "Film"}
              {topMatch.genre ? ` · ${topMatch.genre}` : ""}
            </p>
            <div className="together-dual-pills tabular-num">
              <span>{hostName}: {topMatch.matchPctA ?? 85}%</span>
              <span>{guestName}: {topMatch.matchPctB ?? 85}%</span>
              <span className="is-joint">{topMatch.jointMatchPct ?? 85}% Joint Fit</span>
            </div>
            {topMatch.overview && <p className="together-match-overview">{topMatch.overview}</p>}

            <div className="together-match-actions">
              <a
                href={launch.href}
                target="_blank"
                rel="noopener noreferrer"
                className="together-launch-btn"
              >
                <ExternalLink size={15} aria-hidden="true" />
                <span>{firstProvider ? `Watch on ${firstProvider.name}` : "Find Where to Stream"}</span>
              </a>
              {detailPath && (
                <Link to={detailPath} className="together-detail-link">
                  Open Film Details
                </Link>
              )}
              {onRestart && (
                <Button variant="ghost" size="sm" icon={RotateCcw} onClick={onRestart}>
                  Keep Swiping
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!currentItem) {
    return (
      <div className="together-compromise-card">
        <h3>Deck Finished — Top 3 Compromises</h3>
        <p className="together-sub">
          You haven&apos;t hit a mutual swipe yet (waiting on {role === "host" ? guestName : hostName}, or pick from your highest joint scores):
        </p>
        <div className="together-compromise-grid">
          {evaluation.fallbackCompromises.map((item) => {
            const detailPath = movieLink(item);
            return (
              <div key={item.tmdbId || item.title} className="together-compromise-tile">
                <div className="together-compromise-poster">
                  <PosterImage src={item.poster} title={item.title} />
                </div>
                <div className="together-compromise-info">
                  <strong>{item.title}</strong>
                  <span className="tabular-num">
                    {item.jointMatchPct ?? 82}% Joint · {hostName} {item.matchPctA ?? 82}% / {guestName} {item.matchPctB ?? 82}%
                  </span>
                  {detailPath && (
                    <Link to={detailPath} className="together-detail-link">
                      View Film
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {onRestart && (
          <div className="mt-[1.4rem]">
            <Button variant="secondary" icon={RotateCcw} onClick={onRestart}>
              Reset My Swipes
            </Button>
          </div>
        )}
      </div>
    );
  }

  const cardId = currentItem.tmdbId ?? currentItem.id;
  const detailPath = movieLink(currentItem);

  return (
    <div className="together-swipe-stage">
      <div className="together-swipe-progress tabular-num">
        <span>
          Card {votedCount + 1} of {deck.length}
        </span>
        <span>{currentItem.balanceLabel || "Shared Ground"}</span>
      </div>

      <article className="together-swipe-card">
        <div className="together-swipe-poster">
          <PosterImage src={currentItem.poster} title={currentItem.title} />
          <span className="together-swipe-joint-badge tabular-num">
            {currentItem.jointMatchPct ?? 84}% Together
          </span>
        </div>

        <div className="together-swipe-body">
          <div className="together-dual-pills tabular-num">
            <span>{hostName}: {currentItem.matchPctA ?? 84}%</span>
            <span>{guestName}: {currentItem.matchPctB ?? 84}%</span>
          </div>

          <h3 className="together-swipe-title">{currentItem.title}</h3>
          <p className="together-swipe-meta">
            {currentItem.year || "Film"}
            {currentItem.genre ? ` · ${currentItem.genre}` : ""}
          </p>
          {currentItem.overview && <p className="together-swipe-overview">{currentItem.overview}</p>}

          {detailPath && (
            <Link to={detailPath} className="together-detail-link">
              Inspect cast &amp; streaming
            </Link>
          )}

          <div className="together-swipe-actions">
            <button
              type="button"
              className="together-vote-btn is-pass"
              disabled={busy}
              onClick={() => onVote?.(cardId, "no")}
            >
              <X size={18} aria-hidden="true" />
              <span>Pass</span>
            </button>
            <button
              type="button"
              className="together-vote-btn is-yes"
              disabled={busy}
              onClick={() => onVote?.(cardId, "yes")}
            >
              <Check size={18} aria-hidden="true" />
              <span>Watch Tonight</span>
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}
