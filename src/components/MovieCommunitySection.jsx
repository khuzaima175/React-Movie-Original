import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, Star, Users } from "lucide-react";
import { hasSupabaseConfig } from "../services/supabaseClient";
import { fetchMovieCommunityRatings } from "../services/communityService";
import "../styles/community.css";

export default function MovieCommunitySection({ tmdbId, imdbID, title, refreshKey = "" }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [revealedSpoilers, setRevealedSpoilers] = useState(() => new Set());

  const enabled = hasSupabaseConfig();

  useEffect(() => {
    setData(null);
    setRevealedSpoilers(new Set());
    if (!enabled || (!tmdbId && !imdbID)) {
      return;
    }
    let active = true;
    setLoading(true);
    fetchMovieCommunityRatings({ tmdbId, imdbID })
      .then((res) => {
        if (active) setData(res);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [enabled, tmdbId, imdbID, refreshKey]);

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

      {data.reviews.length > 0 ? (
        <div className="movie-community-reviews">
          {data.reviews.slice(0, 12).map((rev) => {
            const isSpoilerHidden = Boolean(rev.contains_spoilers) && !revealedSpoilers.has(rev.id);
            return (
              <article key={rev.id} className="community-review-card">
                <div className="community-review-head">
                  <Link to={`/u/${rev.username}`} className="community-review-author">
                    {rev.display_name || `@${rev.username}`}
                    <span className="ml-[0.55rem] text-[1.2rem] font-normal text-[#8f8f8a]">
                      @{rev.username}
                    </span>
                  </Link>
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
