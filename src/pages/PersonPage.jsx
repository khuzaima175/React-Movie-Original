import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  RotateCcw,
  Star,
  User
} from "lucide-react";
import { useApp } from "../context/AppContext";
import PersonFilmographyExplorer from "../components/PersonFilmographyExplorer";
import {
  annotateCreditsWithVaultState,
  computePersonVaultStats,
  fetchPersonProfileAndCredits,
  resolvePersonDefaultDepartment
} from "../services/personService";

const BIO_COLLAPSE_THRESHOLD = 320;

function formatAgeAndDate(birthday, deathday) {
  if (!birthday) return null;
  const birthYear = Number(String(birthday).slice(0, 4));
  if (!Number.isFinite(birthYear) || birthYear <= 0) return birthday;
  const endDate = deathday ? new Date(deathday) : new Date();
  const birthDate = new Date(birthday);
  if (Number.isNaN(birthDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return birthday;
  }
  let age = endDate.getFullYear() - birthDate.getFullYear();
  const m = endDate.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && endDate.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  if (deathday) {
    return `${birthday} – ${deathday} (aged ${age})`;
  }
  return `Born ${birthday} (age ${age})`;
}

export default function PersonPage({ onQuickRate }) {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { watched, watchlist, addToWatchlist } = useApp();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const numericId = useMemo(() => {
    const n = Number(id);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }, [id]);

  const rawDeptParam = searchParams.get("dept") || "all";

  useEffect(() => {
    window.scrollTo(0, 0);
    setBioExpanded(false);
  }, [id]);

  useEffect(() => {
    if (!numericId) {
      setData(null);
      setLoading(false);
      setError("Invalid person identifier in route.");
      return undefined;
    }

    const controller = new AbortController();
    let httpStatus = null;
    setLoading(true);
    setError(null);

    fetchPersonProfileAndCredits(
      { id: numericId, roleHint: rawDeptParam },
      {
        signal: controller.signal,
        forceRefresh: retryNonce > 0,
        onHttpError: (status) => {
          httpStatus = status;
        }
      }
    )
      .then((res) => {
        if (controller.signal.aborted) return;
        if (!res) {
          setData(null);
          setError(
            httpStatus === 429
              ? "TMDB rate limit reached. Please wait a moment and try again."
              : "Could not find this person's profile on TMDB."
          );
          setLoading(false);
          return;
        }
        setData(res);
        setLoading(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setData(null);
        setError("Network error while loading profile. Please retry.");
        setLoading(false);
      });

    return () => controller.abort();
  }, [numericId, retryNonce]);

  const person = data?.person || null;
  const credits = data?.credits || [];

  useEffect(() => {
    if (person?.name) {
      document.title = `${person.name} | CinemaVault`;
    }
    return () => {
      document.title = "CinemaVault";
    };
  }, [person?.name]);

  const activeDepartment = useMemo(
    () => resolvePersonDefaultDepartment(rawDeptParam, credits),
    [rawDeptParam, credits]
  );

  const stats = useMemo(() => {
    const annotated = annotateCreditsWithVaultState(credits, watched, watchlist);
    return computePersonVaultStats(annotated);
  }, [credits, watched, watchlist]);

  function handleDepartmentChange(nextDept) {
    const next = new URLSearchParams(searchParams);
    if (!nextDept || nextDept === "all") {
      next.delete("dept");
    } else {
      next.set("dept", nextDept);
    }
    setSearchParams(next, { replace: true });
  }

  function handleGoBack() {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  }

  const bioText = String(person?.biography || "").trim();
  const isLongBio = bioText.length > BIO_COLLAPSE_THRESHOLD;
  const displayedBio = isLongBio && !bioExpanded
    ? `${bioText.slice(0, BIO_COLLAPSE_THRESHOLD).trimEnd()}…`
    : bioText;

  const birthMeta = formatAgeAndDate(person?.birthday, person?.deathday);

  return (
    <main className="person-page">
      <div className="page-rail person-page-rail">
        <div className="person-page-topbar">
          <button
            type="button"
            onClick={handleGoBack}
            className="person-btn-secondary"
          >
            <ArrowLeft size={15} aria-hidden="true" />
            <span>Back</span>
          </button>

          {person?.imdbUrl && (
            <a
              href={person.imdbUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="person-btn-secondary"
            >
              <span>IMDb Profile</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          )}
        </div>

        {loading ? (
          <div className="space-y-6">
            <div className="person-hero animate-pulse">
              <div className="person-hero-portrait" />
              <div className="flex flex-col gap-4 justify-center">
                <div className="h-8 w-64 rounded bg-[var(--surface-2)]" />
                <div className="h-4 w-96 max-w-full rounded bg-[var(--surface-2)]" />
                <div className="h-24 w-full rounded bg-[var(--surface-2)]" />
              </div>
            </div>
            <div className="person-skeleton-grid" aria-label="Loading filmography">
              {Array.from({ length: 10 }).map((_, idx) => (
                <div key={idx} className="person-skeleton-card" />
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="person-state-box">
            <AlertCircle size={32} className="text-[var(--text-3)]" aria-hidden="true" />
            <p className="text-[1.6rem] font-semibold text-[var(--text-1)]">{error}</p>
            <div className="flex items-center gap-3">
              {numericId && (
                <button
                  type="button"
                  onClick={() => setRetryNonce((n) => n + 1)}
                  className="person-btn-secondary"
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  <span>Retry</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleGoBack}
                className="person-btn-secondary"
              >
                <span>Go Back</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <section className="person-hero" aria-label={`${person.name} profile`}>
              <div className="person-hero-portrait">
                {person.heroProfileUrl || person.profileUrl ? (
                  <img
                    src={person.heroProfileUrl || person.profileUrl}
                    alt={person.name}
                  />
                ) : (
                  <User size={56} aria-hidden="true" />
                )}
              </div>

              <div className="person-hero-info">
                <div className="person-hero-header">
                  <div>
                    <h1 className="person-hero-title">{person.name}</h1>
                    <div className="cv-meta-line mt-2">
                      {person.knownForDepartment && <span>{person.knownForDepartment}</span>}
                      {birthMeta && (
                        <>
                          <span className="cv-meta-dot" aria-hidden="true">•</span>
                          <span>{birthMeta}</span>
                        </>
                      )}
                      {person.placeOfBirth && (
                        <>
                          <span className="cv-meta-dot" aria-hidden="true">•</span>
                          <span>{person.placeOfBirth}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {bioText ? (
                  <div className="person-bio-block">
                    <p className="person-bio-text">{displayedBio}</p>
                    {isLongBio && (
                      <button
                        type="button"
                        onClick={() => setBioExpanded((prev) => !prev)}
                        className="person-bio-toggle"
                        aria-expanded={bioExpanded}
                      >
                        {bioExpanded ? "Show less" : "Read more"}
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-[1.35rem] text-[var(--text-3)]">
                    No biography listed on TMDB for this contributor.
                  </p>
                )}

                <div className="person-stats-strip">
                  <div className="cv-stat-item">
                    <span className="cv-stat-value tabular-num">{stats.totalCredits}</span>
                    <span className="cv-stat-label">Film Credits</span>
                  </div>

                  <div className="cv-stat-item">
                    <span className="cv-stat-value tabular-num">{stats.watchedCount}</span>
                    <span className="cv-stat-label">Watched in Vault</span>
                  </div>

                  <div className="cv-stat-item">
                    <span className="cv-stat-value tabular-num inline-flex items-center gap-1.5">
                      {stats.averageVaultRating !== null ? (
                        <>
                          <Star size={17} className="cv-rating-star fill-current" aria-hidden="true" />
                          <span>{stats.averageVaultRating}</span>
                          <span className="text-[1.4rem] font-normal text-[var(--text-3)]">/ 10</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </span>
                    <span className="cv-stat-label">Your Avg Rating</span>
                  </div>

                  <div className="cv-stat-item">
                    <span className="cv-stat-value tabular-num">{stats.watchlistCount}</span>
                    <span className="cv-stat-label">Watchlist</span>
                  </div>

                  {stats.highestRatedFilm && (
                    <button
                      type="button"
                      onClick={() => navigate(`/movie/${stats.highestRatedFilm.tmdbId}`)}
                      className="person-highest-chip"
                      title={`Open ${stats.highestRatedFilm.title}`}
                    >
                      <Star size={13} className="cv-rating-star fill-current" aria-hidden="true" />
                      <span>
                        Top Vault Pick: {stats.highestRatedFilm.title} ({stats.highestRatedFilm.userRating}/10)
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </section>

            <section aria-label="Filmography">
              <PersonFilmographyExplorer
                credits={credits}
                activeDepartment={activeDepartment}
                onDepartmentChange={handleDepartmentChange}
                showSearch={true}
                watched={watched}
                watchlist={watchlist}
                onSelectMovie={(credit) => navigate(`/movie/${credit.tmdbId}`)}
                onQuickRate={onQuickRate}
                onAddToWatchlist={addToWatchlist}
              />
            </section>
          </>
        )}
      </div>
    </main>
  );
}
