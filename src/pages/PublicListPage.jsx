import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Bookmark, Check, Copy, Loader2, Sparkles, User } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { fetchPublicListBySlug, toggleBookmarkPublicList } from "../services/publicListsService";
import { loadDefaultEmbeddingIndex } from "../services/embeddingService";
import { buildTasteMatchContext, predictMovieMatch } from "../services/tasteMatchService";
import PosterImage from "../components/PosterImage";
import { Button } from "../components/ui/Button";
import "../styles/lists.css";

function moviePath(item) {
  if (item?.imdbID && /^tt\d+$/i.test(item.imdbID)) return `/movie/${item.imdbID}`;
  if (item?.tmdbId) return `/movie/tmdb_${item.tmdbId}`;
  return null;
}

export default function PublicListPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const {
    watched = [],
    watchlist = [],
    tasteRules = [],
    cloudUser = null,
    clonePublicListAction
  } = useApp();

  const [state, setState] = useState({
    loading: true,
    status: "loading",
    list: null,
    curator: null,
    isBookmarked: false,
    error: ""
  });
  const [embIdx, setEmbIdx] = useState(null);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [clonedId, setClonedId] = useState(null);

  useDocumentTitle(state.list?.name || "Curated List");

  useEffect(() => {
    let active = true;
    setState((prev) => ({ ...prev, loading: true }));
    fetchPublicListBySlug(slug, cloudUser?.id || null).then((res) => {
      if (!active) return;
      setState({
        loading: false,
        status: res.status,
        list: res.list || null,
        curator: res.curator || null,
        isBookmarked: Boolean(res.isBookmarked),
        error: res.error || ""
      });
    });
    return () => {
      active = false;
    };
  }, [slug, cloudUser?.id]);

  useEffect(() => {
    if (watched.length < 3) return undefined;
    let active = true;
    loadDefaultEmbeddingIndex()
      .then((idx) => {
        if (active && idx) setEmbIdx(idx);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [watched.length]);

  const tasteContext = useMemo(
    () =>
      buildTasteMatchContext({
        watched,
        watchlist,
        tasteRules,
        embeddingIndex: embIdx
      }),
    [watched, watchlist, tasteRules, embIdx]
  );

  const handleBookmark = async () => {
    if (!cloudUser?.id) {
      navigate("/auth");
      return;
    }
    if (!state.list?.id || bookmarkBusy) return;
    setBookmarkBusy(true);
    try {
      const res = await toggleBookmarkPublicList({
        userId: cloudUser.id,
        listId: state.list.id,
        currentlyBookmarked: state.isBookmarked
      });
      if (res.ok) {
        setState((prev) => ({
          ...prev,
          isBookmarked: res.isBookmarked,
          list: prev.list
            ? {
                ...prev.list,
                bookmark_count: Math.max(
                  0,
                  Number(prev.list.bookmark_count || 0) + (res.isBookmarked ? 1 : -1)
                )
              }
            : prev.list
        }));
      }
    } finally {
      setBookmarkBusy(false);
    }
  };

  const handleClone = () => {
    if (!state.list) return;
    const cloned = clonePublicListAction(state.list);
    if (cloned?.id) setClonedId(cloned.id);
  };

  if (state.loading) {
    return (
      <div className="public-list-page page-rail">
        <div className="lists-empty-state">
          <Loader2 size={20} className="spin-icon inline mr-[0.6rem]" aria-hidden="true" />
          <span>Loading curated list...</span>
        </div>
      </div>
    );
  }

  if (state.status !== "ok" || !state.list) {
    return (
      <div className="public-list-page page-rail">
        <div className="lists-empty-state">
          <h2>Curated List Not Found</h2>
          <p>This list may be private or no longer exists.</p>
          <Button variant="secondary" onClick={() => navigate("/explore")}>
            Back to Explore
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="public-list-page page-rail">
      <header className="public-list-hero">
        <div>
          <span className="lists-kicker">
            <Sparkles size={13} aria-hidden="true" />
            <span>Curated CinemaVault List</span>
          </span>
          <h1 className="public-list-title">{state.list.name}</h1>
          {state.list.description && <p className="public-list-desc">{state.list.description}</p>}
          <div className="public-list-meta tabular-num">
            {state.curator?.username && (
              <Link to={`/u/${state.curator.username}`} className="public-list-curator">
                <User size={13} aria-hidden="true" />
                <span>
                  Curated by @{state.curator.username}
                </span>
              </Link>
            )}
            <span>{state.list.items.length} films</span>
            <span>{state.list.bookmark_count || 0} bookmarks</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-[0.8rem]">
          <Button
            variant={state.isBookmarked ? "accent" : "secondary"}
            icon={state.isBookmarked ? Check : Bookmark}
            disabled={bookmarkBusy}
            onClick={handleBookmark}
          >
            {state.isBookmarked ? "Bookmarked" : "Bookmark List"}
          </Button>
          <Button
            variant="secondary"
            icon={clonedId ? Check : Copy}
            onClick={clonedId ? () => navigate(`/vault?tab=lists&list=${clonedId}`) : handleClone}
          >
            {clonedId ? "Open Cloned List" : "Clone to My Vault"}
          </Button>
        </div>
      </header>

      <div className="lists-items-grid">
        {state.list.items.map((item) => {
          const path = moviePath(item);
          const pred = tasteContext.ready ? predictMovieMatch(item, tasteContext) : null;
          return (
            <div key={item.id || item.imdbID || item.title} className="lists-movie-tile">
              <button
                type="button"
                className="lists-movie-poster-btn"
                onClick={() => path && navigate(path)}
              >
                <PosterImage src={item.poster} title={item.title} />
                {pred?.matchPct != null && (
                  <span className="lists-match-badge tabular-num">
                    {pred.matchPct}% Match
                  </span>
                )}
              </button>
              <div className="lists-movie-footer">
                <div className="min-w-0">
                  <strong className="truncate block">{item.title}</strong>
                  <span className="text-[1.15rem] text-[#8e8e8a]">{item.year}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
