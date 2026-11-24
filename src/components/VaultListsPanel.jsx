import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bookmark,
  Check,
  Copy,
  Globe,
  Lock,
  Plus,
  Share2,
  Sparkles,
  Trash2,
  ArrowLeft,
  GitCompareArrows
} from "lucide-react";
import { useApp } from "../context/AppContext";
import {
  CANON_CHECKLISTS,
  computeChecklistProgress
} from "../services/listsService";
import { findMatchingMovie } from "../services/movieIdentity";
import { findTmdbByTitleAndYear } from "../services/tmdbService";
import PosterImage from "./PosterImage";
import { Button } from "./ui/Button";
import "../styles/lists.css";

export default function VaultListsPanel({
  mode = "lists", // "lists" | "checklists"
  selectedListId = null,
  onSelectListId
}) {
  const navigate = useNavigate();
  const {
    watched = [],
    watchlist = [],
    customLists = [],
    createCustomListAction,
    deleteCustomListAction,
    toggleMovieInListAction,
    setListVisibilityAction,
    cloneChecklistToCustomList,
    addToWatchlist,
    toggleCompare,
    cloudUser
  } = useApp();

  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [copiedSlug, setCopiedSlug] = useState(null);
  const [activeChecklistId, setActiveChecklistId] = useState(null);
  const [checklistFilter, setChecklistFilter] = useState("all"); // "all" | "remaining" | "watched"

  const selectedList = useMemo(
    () => customLists.find((l) => l.id === selectedListId) || null,
    [customLists, selectedListId]
  );

  const checklistProgressList = useMemo(
    () => CANON_CHECKLISTS.map((pack) => computeChecklistProgress(pack, watched, watchlist)),
    [watched, watchlist]
  );

  const activeChecklist = useMemo(
    () => checklistProgressList.find((c) => c.id === activeChecklistId) || null,
    [checklistProgressList, activeChecklistId]
  );

  const handleCreateSubmit = (e) => {
    e.preventDefault();
    const cleaned = newName.trim();
    if (!cleaned) return;
    const created = createCustomListAction({ name: cleaned, description: newDesc.trim() });
    setNewName("");
    setNewDesc("");
    setShowCreateForm(false);
    if (created?.id) onSelectListId?.(created.id);
  };

  const handleToggleShare = (list) => {
    const updated = setListVisibilityAction(list.id, { isPublic: !list.isPublic, slug: list.slug });
    if (updated?.isPublic && updated?.slug && typeof window !== "undefined") {
      const shareUrl = `${window.location.origin}/list/${updated.slug}`;
      navigator.clipboard?.writeText(shareUrl).catch(() => {});
      setCopiedSlug(updated.slug);
      setTimeout(() => setCopiedSlug(null), 2200);
    }
  };

  const handleCopyLink = (slug) => {
    if (!slug || typeof window === "undefined") return;
    navigator.clipboard?.writeText(`${window.location.origin}/list/${slug}`).catch(() => {});
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2200);
  };

  const handleOpenMovie = async (item) => {
    if (item?.imdbID && /^tt\d+$/i.test(item.imdbID)) {
      navigate(`/movie/${item.imdbID}`);
      return;
    }
    if (item?.tmdbId) {
      navigate(`/movie/tmdb_${item.tmdbId}`);
      return;
    }
    const stub = await findTmdbByTitleAndYear(item?.title, item?.year).catch(() => null);
    if (stub?.tmdbId) {
      navigate(`/movie/tmdb_${stub.tmdbId}`);
    }
  };

  if (mode === "checklists") {
    if (activeChecklist) {
      const visibleEntries = activeChecklist.entries.filter((entry) => {
        if (checklistFilter === "remaining") return !entry.isWatched;
        if (checklistFilter === "watched") return entry.isWatched;
        return true;
      });

      return (
        <section className="lists-panel-shell">
          <div className="lists-detail-head">
            <button
              type="button"
              className="lists-back-btn"
              onClick={() => setActiveChecklistId(null)}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              <span>All Checklists</span>
            </button>

            <div className="flex flex-wrap gap-[0.8rem] items-center">
              <div className="together-role-toggle" role="tablist" aria-label="Filter checklist">
                {["all", "remaining", "watched"].map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={checklistFilter === tab}
                    className={checklistFilter === tab ? "is-active" : ""}
                    onClick={() => setChecklistFilter(tab)}
                  >
                    {tab === "all" ? "All" : tab === "remaining" ? "Unseen" : "Watched"}
                  </button>
                ))}
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={Plus}
                onClick={() => {
                  const rawPack = CANON_CHECKLISTS.find((p) => p.id === activeChecklist.id);
                  const created = cloneChecklistToCustomList(rawPack);
                  if (created?.id) onSelectListId?.(created.id);
                }}
              >
                Clone as Editable List
              </Button>
            </div>
          </div>

          <div className="lists-hero-summary">
            <h2>{activeChecklist.name}</h2>
            <p>{activeChecklist.description}</p>
            <div className="checklist-progress-wrap">
              <div className="checklist-progress-bar">
                <div
                  className="checklist-progress-fill"
                  style={{ width: `${activeChecklist.completionPct}%` }}
                />
              </div>
              <span className="tabular-num">
                {activeChecklist.watchedCount}/{activeChecklist.totalCount} watched ({activeChecklist.completionPct}%)
              </span>
            </div>
          </div>

          <div className="checklist-rows">
            {visibleEntries.map((entry, idx) => (
              <div key={`${entry.title}-${entry.year}`} className="checklist-row-item">
                <button
                  type="button"
                  className="checklist-row-main"
                  onClick={() => handleOpenMovie(entry)}
                >
                  <span className="checklist-row-num tabular-num">{String(idx + 1).padStart(2, "0")}</span>
                  <div className="checklist-row-copy">
                    <strong>{entry.title}</strong>
                    <span>
                      {entry.year} · {entry.director}
                    </span>
                  </div>
                </button>
                <div className="checklist-row-status">
                  {entry.isWatched ? (
                    <span className="checklist-badge is-watched tabular-num">
                      <Check size={12} aria-hidden="true" />
                      {entry.userRating ? `Watched · ${entry.userRating}/10` : "Watched"}
                    </span>
                  ) : entry.isWatchlist ? (
                    <span className="checklist-badge is-watchlist">In Watchlist</span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Bookmark}
                      onClick={() =>
                        addToWatchlist({
                          imdbID: entry.imdbID || `canon_${entry.title}_${entry.year}`,
                          ...(entry.tmdbId ? { tmdbId: entry.tmdbId } : {}),
                          title: entry.title,
                          year: entry.year,
                          director: entry.director
                        })
                      }
                    >
                      + Watchlist
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      );
    }

    return (
      <section className="lists-panel-shell">
        <div className="vault-lists-grid">
          {checklistProgressList.map((pack) => (
            <button
              key={pack.id}
              type="button"
              className="vault-list-card is-checklist"
              onClick={() => setActiveChecklistId(pack.id)}
            >
              <div className="vault-list-card-top">
                <span className="lists-kicker">
                  <Sparkles size={12} aria-hidden="true" />
                  <span>Canon Checklist</span>
                </span>
                <span className="lists-pct-pill tabular-num">{pack.completionPct}%</span>
              </div>
              <h3>{pack.name}</h3>
              <p>{pack.description}</p>
              <div className="checklist-progress-bar mt-auto">
                <div className="checklist-progress-fill" style={{ width: `${pack.completionPct}%` }} />
              </div>
              <span className="lists-card-meta tabular-num">
                {pack.watchedCount} of {pack.totalCount} watched
              </span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  // Custom Lists Detail View
  if (selectedList) {
    const items = selectedList.items || [];
    const seenCount = items.filter((item) => Boolean(findMatchingMovie(watched, item))).length;

    return (
      <section className="lists-panel-shell">
        <div className="lists-detail-head">
          <button
            type="button"
            className="lists-back-btn"
            onClick={() => onSelectListId?.(null)}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            <span>All Lists</span>
          </button>

          <div className="flex flex-wrap gap-[0.8rem] items-center">
            {cloudUser && (
              <Button
                variant={selectedList.isPublic ? "accent" : "secondary"}
                size="sm"
                icon={selectedList.isPublic ? Globe : Lock}
                onClick={() => handleToggleShare(selectedList)}
              >
                {selectedList.isPublic ? "Public (Click to Make Private)" : "Share Publicly"}
              </Button>
            )}
            {selectedList.isPublic && selectedList.slug && (
              <Button
                variant="secondary"
                size="sm"
                icon={copiedSlug === selectedList.slug ? Check : Copy}
                onClick={() => handleCopyLink(selectedList.slug)}
              >
                {copiedSlug === selectedList.slug ? "Copied Link" : "Copy /list Link"}
              </Button>
            )}
            {items.length >= 2 && items.length <= 3 && (
              <Button
                variant="ghost"
                size="sm"
                icon={GitCompareArrows}
                onClick={() => {
                  items.forEach((m) => toggleCompare?.(m));
                  navigate("/compare");
                }}
              >
                Compare Films
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              onClick={() => {
                deleteCustomListAction(selectedList.id);
                onSelectListId?.(null);
              }}
            >
              Delete List
            </Button>
          </div>
        </div>

        <div className="lists-hero-summary">
          <h2>{selectedList.name}</h2>
          {selectedList.description && <p>{selectedList.description}</p>}
          <span className="lists-card-meta tabular-num">
            {items.length} film{items.length === 1 ? "" : "s"} · {seenCount} watched
            {selectedList.isPublic ? " · Publicly shareable" : " · Private"}
          </span>
        </div>

        {items.length === 0 ? (
          <div className="lists-empty-state">
            <p>This list is empty. Open any film page and click &ldquo;Save to List&rdquo; to add titles here.</p>
          </div>
        ) : (
          <div className="lists-items-grid">
            {items.map((item) => (
              <div key={item.id || item.imdbID || item.title} className="lists-movie-tile">
                <button
                  type="button"
                  className="lists-movie-poster-btn"
                  onClick={() => handleOpenMovie(item)}
                >
                  <PosterImage src={item.poster} title={item.title} />
                </button>
                <div className="lists-movie-footer">
                  <div className="min-w-0">
                    <strong className="truncate block">{item.title}</strong>
                    <span className="text-[1.15rem] text-[#8e8e8a]">{item.year}</span>
                  </div>
                  <button
                    type="button"
                    className="lists-remove-item-btn"
                    title="Remove from list"
                    aria-label={`Remove ${item.title} from ${selectedList.name}`}
                    onClick={() => toggleMovieInListAction(selectedList.id, item)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="lists-panel-shell">
      <div className="lists-panel-toolbar">
        <div>
          <h3 className="m-0 text-[1.8rem] text-[#f4f4f2]">Your Curated Lists</h3>
          <p className="m-0 text-[1.3rem] text-[#9e9e99]">
            Organize themed collections and share them with a public link.
          </p>
        </div>
        <Button
          variant="accent"
          size="sm"
          icon={Plus}
          onClick={() => setShowCreateForm((prev) => !prev)}
        >
          New List
        </Button>
      </div>

      {showCreateForm && (
        <form className="lists-create-form" onSubmit={handleCreateSubmit}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="List title (e.g. Rainy Tuesday in 1997)"
            aria-label="List title"
            maxLength={80}
            required
          />
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Short editorial note (optional)"
            aria-label="List description"
            maxLength={300}
          />
          <div className="flex gap-[0.8rem]">
            <Button type="submit" variant="primary" size="sm">
              Create List
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreateForm(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {customLists.length === 0 ? (
        <div className="lists-empty-state">
          <p>No custom lists yet. Click &ldquo;New List&rdquo; or use &ldquo;Save to List&rdquo; on any movie page.</p>
        </div>
      ) : (
        <div className="vault-lists-grid">
          {customLists.map((list) => {
            const items = list.items || [];
            const seenCount = items.filter((item) => Boolean(findMatchingMovie(watched, item))).length;
            const thumbs = items.slice(0, 4);
            return (
              <div key={list.id} className="vault-list-card">
                <button
                  type="button"
                  className="vault-list-card-body"
                  onClick={() => onSelectListId?.(list.id)}
                >
                  <div className="list-collage-thumb">
                    {thumbs.length === 0 ? (
                      <div className="list-collage-empty">Empty</div>
                    ) : (
                      thumbs.map((m, idx) => (
                        <div key={`${m.id || m.title}-${idx}`} className="list-collage-cell">
                          <PosterImage src={m.poster} title={m.title} />
                        </div>
                      ))
                    )}
                  </div>
                  <h3>{list.name}</h3>
                  {list.description && <p>{list.description}</p>}
                  <span className="lists-card-meta tabular-num">
                    {items.length} film{items.length === 1 ? "" : "s"} · {seenCount} watched
                  </span>
                </button>

                {list.isPublic && list.slug && (
                  <div className="vault-list-card-footer">
                    <span className="lists-public-pill">
                      <Share2 size={11} aria-hidden="true" /> Public
                    </span>
                    <button
                      type="button"
                      className="lists-copy-mini"
                      onClick={() => handleCopyLink(list.slug)}
                    >
                      {copiedSlug === list.slug ? "Copied!" : "Copy link"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
