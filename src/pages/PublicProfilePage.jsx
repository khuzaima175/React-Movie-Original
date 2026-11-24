import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Check,
  Eye,
  Film,
  Loader2,
  Sparkles,
  Star,
  UserPlus,
  Users
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import {
  aggregateCommunityRatings,
  computeProfileTasteVector,
  computeTasteTwinCompatibility,
  fetchPublicProfileByUsername,
  pickUnseenFavoritesFromProfile,
  toggleFollowUser
} from "../services/communityService";
import { fetchPublicListsByUsername } from "../services/publicListsService";
import { loadDefaultEmbeddingIndex } from "../services/embeddingService";
import PosterImage from "../components/PosterImage";
import { Button } from "../components/ui/Button";
import "../styles/community.css";

function movieTargetPath(item) {
  if (item?.imdb_id && /^tt\d+$/i.test(item.imdb_id)) return `/movie/${item.imdb_id}`;
  if (item?.tmdb_id) return `/movie/tmdb_${item.tmdb_id}`;
  return null;
}

export default function PublicProfilePage() {
  const { username = "" } = useParams();
  const navigate = useNavigate();
  const { cloudUser, watched = [] } = useApp();

  const cleanHandle = String(username || "").replace(/^@+/, "").toLowerCase();
  useDocumentTitle(cleanHandle ? `@${cleanHandle}` : "Public Profile");

  const [state, setState] = useState({
    loading: true,
    status: "loading",
    profile: null,
    ratings: [],
    followerCount: 0,
    followingCount: 0,
    isFollowing: false,
    error: ""
  });
  const [viewerVector, setViewerVector] = useState(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [revealedSpoilers, setRevealedSpoilers] = useState(() => new Set());
  const [publicLists, setPublicLists] = useState([]);

  useEffect(() => {
    let active = true;
    setRevealedSpoilers(new Set());
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    Promise.all([
      fetchPublicProfileByUsername(cleanHandle, cloudUser?.id || null),
      fetchPublicListsByUsername(cleanHandle).catch(() => [])
    ]).then(([res, lists]) => {
      if (!active) return;
      setPublicLists(Array.isArray(lists) ? lists : []);
      setState({
        loading: false,
        status: res.status,
        profile: res.profile || null,
        ratings: res.ratings || [],
        followerCount: res.followerCount || 0,
        followingCount: res.followingCount || 0,
        isFollowing: Boolean(res.isFollowing),
        error: res.error || ""
      });
    });
    return () => {
      active = false;
    };
  }, [cleanHandle, cloudUser?.id]);

  // Compute viewer's local 64-D taste vector so we can display a real Taste Twin % badge
  useEffect(() => {
    if (!state.profile?.taste_vector || watched.length < 3) {
      setViewerVector(null);
      return;
    }
    let active = true;
    loadDefaultEmbeddingIndex()
      .then((idx) => {
        if (!active || !idx) return;
        setViewerVector(computeProfileTasteVector(watched, idx));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [state.profile?.taste_vector, watched]);

  const agg = useMemo(() => aggregateCommunityRatings(state.ratings), [state.ratings]);
  const maxHistCount = useMemo(
    () => Math.max(1, ...Object.values(agg.histogram || {})),
    [agg.histogram]
  );

  const isOwnProfile = Boolean(cloudUser?.id && state.profile?.user_id === cloudUser.id);
  const tasteTwin = useMemo(() => {
    if (isOwnProfile || !viewerVector || !state.profile?.taste_vector) return null;
    return computeTasteTwinCompatibility(viewerVector, state.profile.taste_vector);
  }, [isOwnProfile, viewerVector, state.profile?.taste_vector]);

  const topFour = useMemo(() => {
    const keys = Array.isArray(state.profile?.favorite_movie_keys)
      ? state.profile.favorite_movie_keys
      : [];
    if (keys.length === 0) {
      return [...state.ratings]
        .sort((a, b) => Number(b.user_rating || 0) - Number(a.user_rating || 0))
        .slice(0, 4);
    }
    const byKey = new Map(state.ratings.map((r) => [r.movie_key, r]));
    const matched = keys.map((k) => byKey.get(k)).filter(Boolean);
    return matched.length > 0
      ? matched
      : [...state.ratings]
          .sort((a, b) => Number(b.user_rating || 0) - Number(a.user_rating || 0))
          .slice(0, 4);
  }, [state.profile?.favorite_movie_keys, state.ratings]);

  const unseenFavorites = useMemo(() => {
    if (isOwnProfile) return [];
    return pickUnseenFavoritesFromProfile(state.ratings, watched, 6);
  }, [isOwnProfile, state.ratings, watched]);

  const handleToggleFollow = async () => {
    if (!cloudUser?.id) {
      navigate("/auth");
      return;
    }
    if (!state.profile?.user_id || followBusy) return;
    setFollowBusy(true);
    try {
      const res = await toggleFollowUser({
        followerId: cloudUser.id,
        followingId: state.profile.user_id,
        currentlyFollowing: state.isFollowing
      });
      if (res.ok) {
        setState((prev) => ({
          ...prev,
          isFollowing: res.isFollowing,
          followerCount: Math.max(0, prev.followerCount + (res.isFollowing ? 1 : -1))
        }));
      }
    } finally {
      setFollowBusy(false);
    }
  };

  if (state.loading) {
    return (
      <div className="public-profile-shell">
        <div className="page-rail flex items-center justify-center gap-[1rem] py-[8rem] text-[1.45rem] text-[#b6b6b2]">
          <Loader2 size={18} className="animate-spin" aria-hidden="true" />
          <span>Loading @{cleanHandle}...</span>
        </div>
      </div>
    );
  }

  if (state.status !== "ok" || !state.profile) {
    return (
      <div className="public-profile-shell">
        <div className="page-rail max-w-[60rem]">
          <div className="public-profile-hero flex-col">
            <span className="public-profile-kicker">Community Profile</span>
            <h1 className="public-profile-name">Profile not found</h1>
            <p className="public-profile-bio">
              {state.status === "unconfigured"
                ? "Community profiles require cloud sync configuration."
                : `@${cleanHandle || "user"} does not have a public CinemaVault profile right now. Profiles are private unless explicitly opted in.`}
            </p>
            <div className="flex flex-wrap gap-[1rem] mt-[0.8rem]">
              <Button variant="secondary" onClick={() => navigate("/")}>
                Back to Discover
              </Button>
              <Button variant="ghost" onClick={() => navigate("/account")}>
                Manage Your Profile
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const profile = state.profile;
  const displayTitle = profile.display_name || `@${profile.username}`;

  return (
    <div className="public-profile-shell">
      <div className="page-rail">
        <header className="public-profile-hero">
          <div className="public-profile-identity">
            <span className="public-profile-kicker">
              <Film size={13} aria-hidden="true" />
              <span>CinemaVault Public Profile</span>
            </span>
            <h1 className="public-profile-name">{displayTitle}</h1>
            <span className="public-profile-handle">@{profile.username}</span>
            {profile.bio && <p className="public-profile-bio">{profile.bio}</p>}

            <div className="public-profile-meta-row tabular-num">
              <span>
                <strong>{profile.watched_count || agg.count}</strong> films logged
              </span>
              {agg.average != null && (
                <span>
                  <strong>{agg.average}</strong>/10 avg rating
                </span>
              )}
              <span className="inline-flex items-center gap-[0.45rem]">
                <Users size={14} aria-hidden="true" />
                <strong>{state.followerCount}</strong> followers · <strong>{state.followingCount}</strong> following
              </span>
            </div>
          </div>

          <div className="public-profile-actions">
            {tasteTwin && (
              <div className="taste-twin-pill" title="Computed from 64-D CVEM taste vectors">
                <Sparkles size={18} aria-hidden="true" />
                <span className="taste-twin-pct tabular-num">{tasteTwin.matchPct}%</span>
                <span className="taste-twin-label">
                  <strong>{tasteTwin.label}</strong>
                  <span>Taste Compatibility</span>
                </span>
              </div>
            )}

            {isOwnProfile ? (
              <Button variant="secondary" onClick={() => navigate("/account")}>
                Edit Public Profile
              </Button>
            ) : (
              <div className="flex flex-wrap gap-[0.8rem]">
                <Button
                  variant={state.isFollowing ? "secondary" : "accent"}
                  icon={state.isFollowing ? Check : UserPlus}
                  disabled={followBusy}
                  onClick={handleToggleFollow}
                >
                  {state.isFollowing ? "Following" : "Follow"}
                </Button>
                <Button
                  variant="secondary"
                  icon={Users}
                  onClick={() => navigate(`/together?partner=${encodeURIComponent(profile.username)}`)}
                >
                  Watch Together
                </Button>
              </div>
            )}
          </div>
        </header>

        {topFour.length > 0 && (
          <section className="public-section" aria-label="Favorite films">
            <div className="public-section-head">
              <h2 className="public-section-title">Top Showcase</h2>
              <span className="public-section-sub">Signature favorites</span>
            </div>
            <div className="public-top4-grid">
              {topFour.map((item) => {
                const path = movieTargetPath(item);
                return (
                  <button
                    key={item.movie_key}
                    type="button"
                    className="public-poster-tile"
                    onClick={() => path && navigate(path)}
                  >
                    <div className="public-poster-frame">
                      <PosterImage src={item.poster} title={item.title} />
                      <span className="public-poster-rating tabular-num">{item.user_rating}/10</span>
                    </div>
                    <span className="public-poster-title">{item.title}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {unseenFavorites.length > 0 && (
          <section className="public-section" aria-label="Films they loved that you haven't seen">
            <div className="public-section-head">
              <h2 className="public-section-title">Films They Loved You Haven&apos;t Seen</h2>
              <span className="public-section-sub">8–10/10 ratings missing from your Vault</span>
            </div>
            <div className="public-unseen-grid">
              {unseenFavorites.map((item) => {
                const path = movieTargetPath(item);
                return (
                  <button
                    key={item.movie_key}
                    type="button"
                    className="public-poster-tile"
                    onClick={() => path && navigate(path)}
                  >
                    <div className="public-poster-frame">
                      <PosterImage src={item.poster} title={item.title} />
                      <span className="public-poster-rating tabular-num">{item.user_rating}/10</span>
                    </div>
                    <span className="public-poster-title">{item.title}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {agg.count > 0 && (
          <section className="public-histogram-card" aria-label="Rating distribution">
            <div className="public-section-head mb-0">
              <h2 className="public-section-title text-[1.7rem]">Rating Distribution</h2>
              <span className="public-section-sub tabular-num">{agg.count} rated films</span>
            </div>
            <div className="public-histogram-bars">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => {
                const cnt = agg.histogram[score] || 0;
                const pct = Math.max(4, Math.round((cnt / maxHistCount) * 100));
                return (
                  <div key={score} className="public-hist-col" title={`${score}/10: ${cnt} film${cnt === 1 ? "" : "s"}`}>
                    <div className="public-hist-bar" style={{ height: `${cnt === 0 ? 4 : pct}%`, opacity: cnt === 0 ? 0.18 : 1 }} />
                    <span className="public-hist-label tabular-num">{score}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {publicLists.length > 0 && (
          <section className="public-section" aria-label="Curated lists">
            <div className="public-section-head">
              <h2 className="public-section-title">Curated Lists</h2>
              <span className="public-section-sub tabular-num">
                {publicLists.length} public collection{publicLists.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="public-unseen-grid">
              {publicLists.map((list) => (
                <Link
                  key={list.id}
                  to={`/list/${list.slug}`}
                  className="community-review-card no-underline text-inherit block"
                >
                  <strong className="text-[1.45rem] text-[#f4f4f2] block mb-[0.3rem]">
                    {list.name}
                  </strong>
                  {list.description && (
                    <span className="text-[1.25rem] text-[#b6b6b2] block mb-[0.5rem]">
                      {list.description}
                    </span>
                  )}
                  <span className="text-[1.15rem] text-[#8e8e8a] tabular-num">
                    {list.items?.length || 0} films · {list.bookmark_count || 0} bookmarks
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="public-section" aria-label="Recent ratings and reviews">
          <div className="public-section-head">
            <h2 className="public-section-title">Watch Diary &amp; Reviews</h2>
            <span className="public-section-sub tabular-num">
              {agg.reviews.length} written review{agg.reviews.length === 1 ? "" : "s"}
            </span>
          </div>

          {state.ratings.length === 0 ? (
            <p className="text-[1.4rem] text-[#9e9e99]">No rated films logged yet.</p>
          ) : (
            <div className="public-diary-list">
              {state.ratings.slice(0, 30).map((item) => {
                const path = movieTargetPath(item);
                const note = String(item.user_note || "").trim();
                const isSpoilerHidden = Boolean(item.contains_spoilers) && !revealedSpoilers.has(item.id);
                return (
                  <article key={item.id || item.movie_key} className="community-review-card">
                    <div className="community-review-head">
                      {path ? (
                        <Link to={path} className="community-review-author">
                          {item.title} {item.year ? `(${item.year})` : ""}
                        </Link>
                      ) : (
                        <span className="community-review-author">{item.title}</span>
                      )}
                      <span className="community-review-score tabular-num">
                        <Star size={12} fill="currentColor" aria-hidden="true" />
                        {item.user_rating}/10
                      </span>
                    </div>

                    {note ? (
                      isSpoilerHidden ? (
                        <div className="community-spoiler-box">
                          <p className="community-review-note community-spoiler-blur" aria-hidden="true">
                            {note}
                          </p>
                          <button
                            type="button"
                            className="community-spoiler-btn"
                            onClick={() =>
                              setRevealedSpoilers((prev) => {
                                const next = new Set(prev);
                                next.add(item.id);
                                return next;
                              })
                            }
                          >
                            <Eye size={12} className="inline mr-[0.4rem]" aria-hidden="true" />
                            Reveal spoiler review
                          </button>
                        </div>
                      ) : (
                        <p className="community-review-note">{note}</p>
                      )
                    ) : (
                      <span className="text-[1.25rem] text-[#80807b]">Rated without written notes</span>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
