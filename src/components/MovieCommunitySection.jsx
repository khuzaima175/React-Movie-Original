import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, Heart, Sparkles, Star, Users } from "lucide-react";
import { useApp } from "../context/AppContext";
import { hasSupabaseConfig } from "../services/supabaseClient";
import {
  computeProfileTasteVector,
  fetchMovieCommunityRatings,
  sortCommunityReviews,
  toggleReviewLike
} from "../services/communityService";
import { loadDefaultEmbeddingIndex } from "../services/embeddingService";
import "../styles/community.css";

export default function MovieCommunitySection({ tmdbId, imdbID, title, refreshKey = "" }) {
  const navigate = useNavigate();
  const { cloudUser = null, watched = [] } = useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState("taste");
  const [viewerVector, setViewerVector] = useState(null);
  const [likedIds, setLikedIds] = useState(() => new Set());
  const [likingIds, setLikingIds] = useState(() => new Set());
  const likingIdsRef = useRef(new Set());
  const [likeDeltas, setLikeDeltas] = useState(() => ({}));
  const [revealedSpoilers, setRevealedSpoilers] = useState(() => new Set());

  const enabled = hasSupabaseConfig();

  useEffect(() => {
    if (watched.length < 3) {
      setViewerVector(null);
      return undefined;
    }
    let active = true;
    loadDefaultEmbeddingIndex()
      .then((idx) => {
        if (active && idx) setViewerVector(computeProfileTasteVector(watched, idx));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [watched]);

  useEffect(() => {
    setData(null);
    setRevealedSpoilers(new Set());
    setLikeDeltas({});
    if (!enabled || (!tmdbId && !imdbID)) {
      return;
    }
    let active = true;
    setLoading(true);
    fetchMovieCommunityRatings({ tmdbId, imdbID, viewerUserId: cloudUser?.id || null })
      .then((res) => {
        if (!active) return;
        setData(res);
        setLikedIds(res?.likedIds instanceof Set ? res.likedIds : new Set());
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [enabled, tmdbId, imdbID, refreshKey, cloudUser?.id]);

  const sortedReviews = useMemo(() => {
    if (!data?.reviews) return [];
    const effectiveSort = sortBy === "taste" && !viewerVector ? "likes" : sortBy;
    return sortCommunityReviews(data.reviews, {
      sortBy: effectiveSort,
      viewerVector,
      profileVectorMap: data.profileVectorMap
    });
  }, [data, sortBy, viewerVector]);

  async function handleToggleLike(reviewId) {
    if (!cloudUser?.id) {
      navigate("/auth");
      return;
    }
    if (likingIdsRef.current.has(reviewId)) return;
    likingIdsRef.current.add(reviewId);
    setLikingIds(new Set(likingIdsRef.current));
    const currentlyLiked = likedIds.has(reviewId);
    try {
      const res = await toggleReviewLike({
        userId: cloudUser.id,
        ratingId: reviewId,
        currentlyLiked
      });
      if (res.ok) {
        setLikedIds((prev) => {
          const next = new Set(prev);
          if (res.isLiked) next.add(reviewId);
          else next.delete(reviewId);
          return next;
        });
        setLikeDeltas((prev) => ({
          ...prev,
          [reviewId]: (prev[reviewId] || 0) + (res.isLiked ? 1 : -1)
        }));
      }
    } finally {
      likingIdsRef.current.delete(reviewId);
      setLikingIds(new Set(likingIdsRef.current));
    }
  }

  if (!enabled) return null;
  if (loading && !data) return null;
  if (!data) return null;

  return (
    <section className="movie-community-section" aria-label="CinemaVault community ratings and reviews">
      <div className="movie-community-header">
        <div>
          <h2 className="public-section-title flex items-center gap-[0.8rem]">
            <Users size={18} className="text-emerald-400" aria-hidden="true" />
            <span>CinemaVault Community</span>
          </h2>
          <p className="mt-[0.3rem] mb-0 text-[1.35rem] text-[#9e9e99]">
            {data.count > 0
              ? `Public ratings and spoiler-safe reviews from opted-in CinemaVault members.`
              : `No public community ratings for ${title || "this film"} yet. Enable Public Profile in Account to share yours.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {sortedReviews.length > 1 && (
            <div className="together-role-toggle" role="tablist" aria-label="Sort community reviews">
              {viewerVector && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={sortBy === "taste"}
                  className={sortBy === "taste" ? "is-active" : ""}
                  onClick={() => setSortBy("taste")}
                >
                  Taste Match %
                </button>
              )}
              <button
                type="button"
                role="tab"
                aria-selected={sortBy === "likes" || (!viewerVector && sortBy === "taste")}
                className={sortBy === "likes" || (!viewerVector && sortBy === "taste") ? "is-active" : ""}
                onClick={() => setSortBy("likes")}
              >
                Most Liked
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sortBy === "recent"}
                className={sortBy === "recent" ? "is-active" : ""}
                onClick={() => setSortBy("recent")}
              >
                Recent
              </button>
            </div>
          )}

          {data.count > 0 && (
            <div className="movie-community-score-pill tabular-num">
              <Star size={16} className="text-amber-300" fill="currentColor" aria-hidden="true" />
              <strong className="text-[1.9rem] text-[#f4f4f2]">{data.average}/10</strong>
              <span className="text-[1.25rem] text-[#9e9e99]">
                ({data.count} {data.count === 1 ? "rating" : "ratings"})
              </span>
            </div>
          )}
        </div>
      </div>

      {sortedReviews.length > 0 ? (
        <div className="movie-community-reviews">
          {sortedReviews.slice(0, 12).map((rev) => {
            const isSpoilerHidden = Boolean(rev.contains_spoilers) && !revealedSpoilers.has(rev.id);
            const isLiked = likedIds.has(rev.id);
            const effectiveLikes = Math.max(0, (Number(rev.like_count) || 0) + (likeDeltas[rev.id] || 0));
            return (
              <article key={rev.id} className="community-review-card">
                <div className="community-review-head">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/u/${rev.username}`} className="community-review-author">
                      {rev.display_name || `@${rev.username}`}
                      <span className="ml-[0.55rem] text-[1.2rem] font-normal text-[#8f8f8a]">
                        @{rev.username}
                      </span>
                    </Link>
                    {rev.tasteMatchPct != null && (
                      <span className="taste-twin-badge tabular-num">
                        <Sparkles size={11} aria-hidden="true" />
                        {rev.tasteMatchPct}% Match
                      </span>
                    )}
                  </div>
                  <span className="community-review-score tabular-num">
                    <Star size={12} fill="currentColor" aria-hidden="true" />
                    {rev.user_rating}/10
                  </span>
                </div>

                {isSpoilerHidden ? (
                  <div className="community-spoiler-box">
                    <p className="community-review-note community-spoiler-blur" aria-hidden="true">
                      {rev.user_note}
                    </p>
                    <button
                      type="button"
                      className="community-spoiler-btn"
                      onClick={() =>
                        setRevealedSpoilers((prev) => {
                          const next = new Set(prev);
                          next.add(rev.id);
                          return next;
                        })
                      }
                    >
                      <Eye size={12} className="inline mr-[0.4rem]" aria-hidden="true" />
                      Reveal spoiler review
                    </button>
                  </div>
                ) : (
                  <p className="community-review-note">{rev.user_note}</p>
                )}

                <div className="flex items-center justify-end pt-1">
                  <button
                    type="button"
                    disabled={likingIds.has(rev.id)}
                    onClick={() => handleToggleLike(rev.id)}
                    aria-pressed={isLiked}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[1.2rem] border cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-wait ${
                      isLiked
                        ? "bg-rose-500/15 border-rose-500/40 text-rose-300"
                        : "bg-transparent border-white/10 text-[#9e9e99] hover:border-white/25 hover:text-[#f4f4f2]"
                    }`}
                  >
                    <Heart size={12} fill={isLiked ? "currentColor" : "none"} aria-hidden="true" />
                    <span className="tabular-num">{effectiveLikes}</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : data.count > 0 ? (
        <div className="flex flex-wrap gap-[0.8rem]">
          {data.allRatings.slice(0, 12).map((r) => (
            <Link
              key={r.id}
              to={`/u/${r.username}`}
              className="account-fav-chip no-underline hover:border-white/25"
            >
              <span>@{r.username}</span>
              <span className="text-amber-300 font-semibold tabular-num">{r.user_rating}/10</span>
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
