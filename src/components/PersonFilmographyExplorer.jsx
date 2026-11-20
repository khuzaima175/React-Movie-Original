import { useEffect, useMemo, useState } from "react";
import { Bookmark, Check, Film, Search, Star } from "lucide-react";
import Tabs from "./ui/Tabs";
import Select from "./ui/Select";
import PosterImage from "./PosterImage";
import { prepareWatchlistPayload } from "../services/ratingTiers";
import {
  PERSON_DEPARTMENT_TABS,
  annotateCreditsWithVaultState,
  filterAndSortPersonCredits
} from "../services/personService";

function toMovieActionCandidate(credit) {
  const tmdbRating = Number(credit.voteAverage) > 0
    ? Number(Number(credit.voteAverage).toFixed(1))
    : null;
  return {
    id: credit.tmdbId,
    tmdbId: credit.tmdbId,
    imdbID: credit.watchedEntry?.imdbID || credit.imdbId || undefined,
    title: credit.title,
    Title: credit.title,
    year: credit.year,
    Year: credit.year,
    poster: credit.poster,
    Poster: credit.poster,
    imdbRating: tmdbRating,
    rating: tmdbRating
  };
}

export default function PersonFilmographyExplorer({
  credits = [],
  activeDepartment = "all",
  onDepartmentChange,
  showSearch = false,
  watched = [],
  watchlist = [],
  onSelectMovie,
  onQuickRate,
  onAddToWatchlist
}) {
  const [vaultFilter, setVaultFilter] = useState("all");
  const [sortBy, setSortBy] = useState("popular");
  const [searchQuery, setSearchQuery] = useState("");
  const [localDept, setLocalDept] = useState(activeDepartment || "all");

  useEffect(() => {
    setLocalDept(activeDepartment || "all");
  }, [activeDepartment]);

  useEffect(() => {
    setVaultFilter("all");
    setSortBy("popular");
    setSearchQuery("");
  }, [credits]);

  const annotatedCredits = useMemo(
    () => annotateCreditsWithVaultState(credits, watched, watchlist),
    [credits, watched, watchlist]
  );

  const departmentTabs = useMemo(() => {
    const counts = { all: annotatedCredits.length, acting: 0, directing: 0, writing: 0, crew: 0 };
    for (const c of annotatedCredits) {
      for (const dept of c.departments || []) {
        if (counts[dept] !== undefined) counts[dept] += 1;
      }
    }
    return PERSON_DEPARTMENT_TABS
      .map((tab) => ({ ...tab, count: counts[tab.id] || 0 }))
      .filter((tab) => tab.id === "all" || tab.count > 0);
  }, [annotatedCredits]);

  const requestedDept = onDepartmentChange ? activeDepartment : localDept;
  const effectiveDepartment = useMemo(() => {
    if (!requestedDept || requestedDept === "all") return "all";
    const match = departmentTabs.find((t) => t.id === requestedDept);
    return match ? match.id : "all";
  }, [requestedDept, departmentTabs]);

  const scopedCredits = useMemo(
    () => filterAndSortPersonCredits(annotatedCredits, {
      department: effectiveDepartment,
      vaultFilter: "all",
      sortBy: "popular"
    }),
    [annotatedCredits, effectiveDepartment]
  );

  const vaultFilterPills = useMemo(() => {
    let watchedCnt = 0;
    let watchlistCnt = 0;
    let unwatchedCnt = 0;
    for (const c of scopedCredits) {
      if (c.vaultStatus === "watched") watchedCnt += 1;
      else {
        unwatchedCnt += 1;
        if (c.vaultStatus === "watchlist") watchlistCnt += 1;
      }
    }
    return [
      { id: "all", label: "All", count: scopedCredits.length },
      { id: "watched", label: "In Vault", count: watchedCnt },
      { id: "unwatched", label: "Unwatched", count: unwatchedCnt },
      { id: "watchlist", label: "Watchlist", count: watchlistCnt }
    ];
  }, [scopedCredits]);

  const visibleCredits = useMemo(
    () => filterAndSortPersonCredits(annotatedCredits, {
      department: effectiveDepartment,
      vaultFilter,
      sortBy,
      searchQuery
    }),
    [annotatedCredits, effectiveDepartment, vaultFilter, sortBy, searchQuery]
  );

  function handleTabChange(nextDept) {
    if (onDepartmentChange) {
      onDepartmentChange(nextDept);
    } else {
      setLocalDept(nextDept);
    }
  }

  function handleResetFilters() {
    setVaultFilter("all");
    setSearchQuery("");
    if (effectiveDepartment !== "all") {
      handleTabChange("all");
    }
  }

  if (annotatedCredits.length === 0) {
    return (
      <div className="person-state-box">
        <Film size={28} className="text-[var(--text-3)]" aria-hidden="true" />
        <p className="text-[1.45rem] font-semibold text-[var(--text-1)]">No filmography credits found</p>
        <p className="text-[1.3rem] text-[var(--text-3)]">TMDB does not list theatrical movie credits for this person yet.</p>
      </div>
    );
  }

  return (
    <div className="person-explorer">
      <div className="person-explorer-tabs-row">
        <Tabs
          tabs={departmentTabs}
          activeTab={effectiveDepartment}
          onChange={handleTabChange}
        />
      </div>

      <div className="person-explorer-toolbar">
        <div className="person-filter-pills" role="group" aria-label="Vault status filter">
          {vaultFilterPills.map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => setVaultFilter(pill.id)}
              className={`person-filter-pill ${vaultFilter === pill.id ? "is-active" : ""}`}
              aria-pressed={vaultFilter === pill.id}
            >
              <span>{pill.label}</span>
              <span className="tabular-num opacity-75">({pill.count})</span>
            </button>
          ))}
        </div>

        <div className="person-toolbar-right">
          {showSearch && (
            <div className="person-search-wrap">
              <Search size={14} className="person-search-icon" aria-hidden="true" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by title or role..."
                className="person-search-input"
                aria-label="Filter credits by title or role"
              />
            </div>
          )}

          <Select
            value={sortBy}
            onChange={(val) => setSortBy(val)}
            ariaLabel="Sort credits"
            align="right"
            size="sm"
            options={[
              { value: "popular", label: "Sort: Popular" },
              { value: "top_rated", label: "Sort: Top Rated" },
              { value: "newest", label: "Sort: Newest" }
            ]}
          />
        </div>
      </div>

      {visibleCredits.length === 0 ? (
        <div className="person-state-box">
          <p className="text-[1.45rem] font-semibold text-[var(--text-1)]">
            No matching credits for the active filters
          </p>
          <button
            type="button"
            onClick={handleResetFilters}
            className="person-btn-secondary"
          >
            Show all credits
          </button>
        </div>
      ) : (
        <div className="person-credits-grid">
          {visibleCredits.map((credit) => {
            const isWatched = credit.vaultStatus === "watched";
            const isWatchlist = credit.vaultStatus === "watchlist" || credit.inWatchlist;
            const hasUserScore = isWatched && Number(credit.userRating) > 0;
            const tmdbScore = Number(credit.voteAverage) > 0 ? credit.voteAverage.toFixed(1) : null;

            return (
              <article key={credit.tmdbId} className="person-credit-card">
                <button
                  type="button"
                  onClick={() => onSelectMovie?.(credit)}
                  className="person-credit-open"
                >
                  <div className="person-credit-poster-wrap">
                    <PosterImage
                      src={credit.poster}
                      alt={credit.title}
                      title={credit.title}
                      className="person-credit-poster-img"
                    />

                    {isWatched && (
                      <span className={`person-vault-pill ${hasUserScore ? "person-vault-pill--rated" : ""}`}>
                        {hasUserScore ? (
                          <>
                            <Star size={11} className="fill-current" aria-hidden="true" />
                            <span className="tabular-num">{credit.userRating}/10</span>
                          </>
                        ) : (
                          <>
                            <Check size={11} aria-hidden="true" />
                            <span>Watched</span>
                          </>
                        )}
                      </span>
                    )}

                    {!isWatched && isWatchlist && (
                      <span className="person-vault-pill person-vault-pill--watchlist">
                        <Bookmark size={11} className="fill-current" aria-hidden="true" />
                        <span>Watchlist</span>
                      </span>
                    )}

                    {tmdbScore && (
                      <span className="person-tmdb-badge tabular-num">TMDB {tmdbScore}</span>
                    )}
                  </div>

                  <div className="person-credit-meta">
                    <span className="person-credit-title">{credit.title}</span>
                    <span className="person-credit-sub tabular-num">
                      {credit.year !== "N/A" ? credit.year : "TBA"}
                    </span>
                    {credit.rolesLabel && (
                      <span className="person-credit-role" title={credit.rolesLabel}>
                        {credit.rolesLabel}
                      </span>
                    )}
                  </div>
                </button>

                <div className="person-credit-actions">
                  {onQuickRate && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickRate(toMovieActionCandidate(credit));
                      }}
                      className="person-card-btn person-card-btn--gold"
                      title={isWatched ? "Update Vault Rating" : "Quick Rate to Vault"}
                    >
                      <Star size={12} aria-hidden="true" />
                      <span>{isWatched ? "Re-rate" : "Rate"}</span>
                    </button>
                  )}

                  {onAddToWatchlist && !isWatched && (
                    <button
                      type="button"
                      disabled={isWatchlist}
                      onClick={(e) => {
                        e.stopPropagation();
                        const payload = prepareWatchlistPayload(toMovieActionCandidate(credit));
                        if (payload) onAddToWatchlist(payload);
                      }}
                      className="person-card-btn"
                    >
                      {isWatchlist ? (
                        <>
                          <Check size={12} aria-hidden="true" />
                          <span>Saved</span>
                        </>
                      ) : (
                        <>
                          <Bookmark size={12} aria-hidden="true" />
                          <span>Save</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
