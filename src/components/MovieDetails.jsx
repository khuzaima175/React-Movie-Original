import { useState, useEffect, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { MovieDetailsSkeleton } from "./Loader";
import ErrorMessage from "./ErrorMessage";
import PosterImage from "./PosterImage";
import { HeroParallaxController, StickyTitleBar } from "./MovieDetailEffects";
import PersonFilmographyModal from "./PersonFilmographyModal";
import CollectionTimeline from "./CollectionTimeline";
import SimilarFilmsStrip from "./SimilarFilmsStrip";
import ScrollRevealSection from "./ScrollRevealSection";
import StarRatingStage from "./StarRatingStage";
import { useApp } from "../context/AppContext";
import {
  TMDB_GENRE_MAP,
  findTmdbByImdbId,
  findTmdbByTitleAndYear,
  fetchTmdbMovieDetails,
  fetchCollectionTimeline,
  fetchTmdbMovieRecommendations,
  getFallbackPoster,
  isSeriesVaultItem
} from "../services/tmdbService";
import { fetchOmdbJson, getMovieDetailsBatch } from "../services/apiTransport";
import { toDashboardCardItem } from "../services/dashboardService";
import { loadDefaultEmbeddingIndex } from "../services/embeddingService";
import { buildExploreRoute } from "../services/exploreService";
import {
  normalizeCollectionTimeline,
  findEmbeddingNeighborsForMovie,
  buildHybridSimilarFilms,
  shouldLoadRabbitHoleForMovie
} from "../services/rabbitHoleService";
import { getRatingTier } from "../services/ratingTiers";
import { findMatchingMovie, isSameMovie } from "../services/movieIdentity";
import {
  extractMovieCreditPeople,
  buildPersonProfileRoute,
  shouldCloseMovieDetailOnEscape
} from "../services/personService";
import {
  QUICK_REVIEW_TAGS,
  getContextualQuickTags,
  hasQuickTagInNote,
  toggleQuickTagInNote
} from "../services/quickReviewTags";
import {
  CRAFT_ASPECTS,
  WATCH_FORMATS,
  computeVaultCalibration,
  computeCraftAverage,
  buildWatchedRatingPayload
} from "../services/ratingStudioService";
import {
  buildFilmChatRoute,
  saveFilmFocusCache
} from "../services/filmChatService";
import {
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Star,
  Bookmark,
  Plus,
  Check,
  Award,
  Gauge,
  Film,
  User,
  Clapperboard,
  Play,
  Tv,
  Sparkles,
  Globe,
  Calendar,
  Clock,
  ShieldAlert,
  Camera,
  Music,
  Tag,
  Edit3,
  ExternalLink,
  MessageSquare,
  CheckCircle2,
  GitCompareArrows
} from "lucide-react";

// Cache enriched detail objects for this session
const enrichedDetailsSessionCache = new Map();

export default function MovieDetails({
  selectedId,
  onCloseMovie,
  onAddWatched,
  onAddToWatchlist,
  onRemoveWatchlist,
  onQuickRate,
  onTitleResolved,
  watched = [],
  watchlist = []
}) {
  const navigate = useNavigate();
  const {
    userRegion,
    addToWatchlist: contextAddToWatchlist,
    deleteWatchlist: contextDeleteWatchlist,
    compareItems = [],
    toggleCompare
  } = useApp();
  const [movie, setMovie] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [userRating, setUserRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [userNote, setUserNote] = useState("");
  const [ratingBreakdown, setRatingBreakdown] = useState(null);
  const [watchMeta, setWatchMeta] = useState(null);
  const [dateWatchedInput, setDateWatchedInput] = useState("");
  const [isDateDirty, setIsDateDirty] = useState(false);
  const [showAllTags, setShowAllTags] = useState(false);
  const [openDrawer, setOpenDrawer] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [activePerson, setActivePerson] = useState(null);
  const [collectionRaw, setCollectionRaw] = useState(null);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [embeddingNeighbors, setEmbeddingNeighbors] = useState([]);
  const [hydratedEmbeddingCards, setHydratedEmbeddingCards] = useState([]);
  const [tmdbRecs, setTmdbRecs] = useState([]);
  const [similarLoading, setSimilarLoading] = useState(false);

  const creditPeople = useMemo(() => extractMovieCreditPeople(movie), [movie]);

  useEffect(() => {
    setActivePerson(null);
  }, [selectedId]);

  useEffect(() => {
    setCollectionRaw(null);
    setEmbeddingNeighbors([]);
    setHydratedEmbeddingCards([]);
    setTmdbRecs([]);

    if (!shouldLoadRabbitHoleForMovie(movie, selectedId)) {
      setCollectionLoading(false);
      setSimilarLoading(false);
      return undefined;
    }

    let isActive = true;
    const controller = new AbortController();

    if (Number(movie.collectionId) > 0) {
      setCollectionLoading(true);
      fetchCollectionTimeline(movie.collectionId, { signal: controller.signal })
        .then((colData) => {
          if (isActive && !controller.signal.aborted) {
            setCollectionRaw(colData);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (isActive && !controller.signal.aborted) {
            setCollectionLoading(false);
          }
        });
    } else {
      setCollectionLoading(false);
    }

    async function loadRabbitHoleSimilar() {
      setSimilarLoading(true);
      try {
        const [recs, index] = await Promise.all([
          fetchTmdbMovieRecommendations(movie.tmdbId, { signal: controller.signal }),
          loadDefaultEmbeddingIndex().catch(() => null)
        ]);
        if (!isActive || controller.signal.aborted) return;

        const safeRecs = Array.isArray(recs) ? recs : [];
        setTmdbRecs(safeRecs);

        const neighbors = index
          ? findEmbeddingNeighborsForMovie(movie.tmdbId, index, { limit: 16 })
          : [];
        setEmbeddingNeighbors(neighbors);

        const recIdSet = new Set(safeRecs.map((r) => Number(r.tmdbId || r.id)));
        const topNeighborIds = neighbors
          .filter((n) => !recIdSet.has(n.tmdbId))
          .slice(0, 10)
          .map((n) => n.tmdbId);

        if (topNeighborIds.length > 0) {
          const rawBatch = await getMovieDetailsBatch(topNeighborIds, { signal: controller.signal });
          if (!isActive || controller.signal.aborted) return;

          const cards = topNeighborIds
            .map((id) => rawBatch?.[id] || rawBatch?.[String(id)])
            .filter(Boolean)
            .map((raw) =>
              toDashboardCardItem({
                ...raw,
                imdbID: raw.external_ids?.imdb_id || `tmdb_${raw.id}`,
                genre_ids: Array.isArray(raw.genres) ? raw.genres.map((g) => g.id) : []
              })
            );
          setHydratedEmbeddingCards(cards);
        }
      } catch {
        // Degrade gracefully when similarity sources are unavailable
      } finally {
        if (isActive && !controller.signal.aborted) {
          setSimilarLoading(false);
        }
      }
    }

    loadRabbitHoleSimilar();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [selectedId, movie?.loadedForSelectedId, movie?.tmdbId, movie?.collectionId]);

  const collectionTimeline = useMemo(
    () => normalizeCollectionTimeline(collectionRaw, movie, watched, watchlist),
    [collectionRaw, movie, watched, watchlist]
  );

  const collectionPartIds = useMemo(
    () => new Set((collectionTimeline?.parts || []).map((p) => p.tmdbId)),
    [collectionTimeline]
  );

  const similarFilms = useMemo(
    () =>
      buildHybridSimilarFilms({
        currentMovie: movie,
        embeddingNeighbors,
        hydratedEmbeddingCards,
        tmdbRecommendations: tmdbRecs,
        collectionPartIds,
        watched,
        watchlist,
        limit: 14
      }),
    [movie, embeddingNeighbors, hydratedEmbeddingCards, tmdbRecs, collectionPartIds, watched, watchlist]
  );

  // Match across tmdb_<id>, numeric tmdbId, imdbID, and title+year variants
  const movieIdentity = useMemo(
    () => (!isLoading && movie ? { ...movie, selectedId } : { selectedId }),
    [isLoading, movie, selectedId]
  );

  const watchedItem = useMemo(
    () => findMatchingMovie(watched, movieIdentity),
    [watched, movieIdentity]
  );

  const watchlistItem = useMemo(
    () => findMatchingMovie(watchlist, movieIdentity),
    [watchlist, movieIdentity]
  );

  const isWatched = Boolean(watchedItem);
  const isWatchlist = Boolean(watchlistItem);

  function syncDraftFromWatchedItem(item) {
    if (item) {
      const existingRating = Number(item.userRating);
      setUserRating(Number.isFinite(existingRating) && existingRating > 0 ? existingRating : 0);
      setUserNote(item.userNote || "");
      setRatingBreakdown(item.ratingBreakdown || null);
      setWatchMeta(item.watchMeta || null);
      setDateWatchedInput(item.dateWatched ? String(item.dateWatched).slice(0, 10) : "");
      setIsDateDirty(false);
      setOpenDrawer(null);
      setShowAllTags(false);
    } else {
      setUserRating(0);
      setUserNote("");
      setRatingBreakdown(null);
      setWatchMeta(null);
      setDateWatchedInput("");
      setIsDateDirty(false);
      setOpenDrawer(null);
      setShowAllTags(false);
      setIsEditing(false);
    }
  }

  // Sync state when movie changes or watched item hydrates while not actively editing
  const lastSyncedSelectedIdRef = useRef(null);
  const isEditingRef = useRef(isEditing);
  isEditingRef.current = isEditing;

  useEffect(() => {
    const switchedMovie = lastSyncedSelectedIdRef.current !== selectedId;
    lastSyncedSelectedIdRef.current = selectedId;
    if (!switchedMovie && isEditingRef.current) return;
    syncDraftFromWatchedItem(watchedItem);
  }, [watchedItem, selectedId]);

  // Main Data Loading Pipeline: Concurrent TMDB + OMDb Hybrid Extraction
  useEffect(() => {
    if (!selectedId) return;

    if (enrichedDetailsSessionCache.has(selectedId)) {
      setMovie({
        ...enrichedDetailsSessionCache.get(selectedId),
        loadedForSelectedId: selectedId
      });
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    async function loadEnrichedMovieDetails() {
      try {
        setMovie(null);
        setIsLoading(true);
        setError("");

        let omdbData = null;
        let tmdbData = null;

        const isImdbId = String(selectedId).startsWith("tt");
        const cleanTmdbId = String(selectedId).replace(/^tmdb_/, "");

        // 1. If it's an IMDb ID, query OMDb & TMDB concurrently
        if (isImdbId) {
          const omdbPromise = fetchOmdbJson(
            { i: selectedId },
            { signal: controller.signal }
          ).catch(() => null);

          const tmdbPromise = findTmdbByImdbId(selectedId)
            .then((found) => (found?.tmdbId ? fetchTmdbMovieDetails(found.tmdbId, userRegion) : null))
            .catch(() => null);

          const [omdbRes, tmdbRes] = await Promise.all([omdbPromise, tmdbPromise]);
          omdbData = omdbRes && omdbRes.Response === "True" ? omdbRes : null;
          tmdbData = tmdbRes;

          if (!tmdbData && omdbData?.Title && !isSeriesVaultItem(omdbData) && !isSeriesVaultItem(watchedItem)) {
            try {
              const fallbackFound = await findTmdbByTitleAndYear(omdbData.Title, omdbData.Year, { strict: true });
              if (fallbackFound?.tmdbId) {
                tmdbData = await fetchTmdbMovieDetails(fallbackFound.tmdbId, userRegion);
              }
            } catch (_) {}
          }
        } else {
          // If it's a numeric or TMDB ID
          tmdbData = await fetchTmdbMovieDetails(cleanTmdbId, userRegion);
          if (tmdbData?.imdbID) {
            try {
              const json = await fetchOmdbJson(
                { i: tmdbData.imdbID },
                { signal: controller.signal }
              );
              if (json?.Response === "True") omdbData = json;
            } catch (_) {}
          }
        }

        if (!omdbData && !tmdbData) {
          throw new Error("Movie not found or failed to load cinema details.");
        }

        // Combine into unified high-res cinema model
        const title = tmdbData?.title || omdbData?.Title || "Untitled Film";
        const year = tmdbData?.year && tmdbData.year !== "N/A" ? tmdbData.year : (omdbData?.Year || "N/A");
        const poster = tmdbData?.poster || (omdbData?.Poster && omdbData.Poster !== "N/A" ? omdbData.Poster : getFallbackPoster(title));
        const backdrop = tmdbData?.backdrop || null;
        const runtime = tmdbData?.runtime && tmdbData.runtime !== "N/A" ? tmdbData.runtime : (omdbData?.Runtime || "N/A");
        const runtimeMinutes = tmdbData?.runtimeMinutes || (parseInt(runtime) || 120);
        const plot = tmdbData?.plot || omdbData?.Plot || "No synopsis available.";
        const tagline = tmdbData?.tagline || "";
        const director = tmdbData?.director && tmdbData.director !== "Unknown" ? tmdbData.director : (omdbData?.Director || "Unknown");
        const writers = tmdbData?.writers || omdbData?.Writer || null;
        const cinematographer = tmdbData?.cinematographer || null;
        const composer = tmdbData?.composer || null;
        const genres = tmdbData?.genre
          ? tmdbData.genre.split(",").map((g) => g.trim())
          : (omdbData?.Genre ? omdbData.Genre.split(",").map((g) => g.trim()) : []);

        const castDetails = tmdbData?.castDetails?.length > 0
          ? tmdbData.castDetails
          : (omdbData?.Actors ? omdbData.Actors.split(",").map((name) => ({ id: null, name: name.trim(), character: "Starring", profile: null })) : []);

        // Scores Matrix
        const imdbRating = omdbData?.imdbRating && omdbData.imdbRating !== "N/A"
          ? omdbData.imdbRating
          : (tmdbData?.vote_average ? String(tmdbData.vote_average) : null);
        const imdbVotes = omdbData?.imdbVotes && omdbData.imdbVotes !== "N/A" ? omdbData.imdbVotes : null;
        const tmdbRating = tmdbData?.vote_average || null;
        const tmdbVotes = tmdbData?.vote_count ? new Intl.NumberFormat().format(tmdbData.vote_count) : null;
        const metascore = omdbData?.Metascore && omdbData.Metascore !== "N/A" ? omdbData.Metascore : null;
        const rottenTomatoes = omdbData?.Ratings?.find((r) => r.Source === "Rotten Tomatoes")?.Value || null;

        const mpaaRating = tmdbData?.mpaaRating || (omdbData?.Rated && omdbData.Rated !== "N/A" ? omdbData.Rated : null);

        const resolvedType = omdbData?.Type || watchedItem?.Type || (tmdbData ? "movie" : undefined);

        const combinedData = {
          loadedForSelectedId: selectedId,
          imdbID: omdbData?.imdbID || tmdbData?.imdbID || selectedId,
          tmdbId: tmdbData?.tmdbId || null,
          ...(resolvedType ? { Type: resolvedType } : {}),
          title,
          year,
          released: omdbData?.Released || tmdbData?.release_date || year,
          runtime,
          runtimeMinutes,
          rated: mpaaRating,
          poster,
          backdrop,
          tagline,
          plot,
          director,
          writers,
          cinematographer,
          composer,
          directorDetails: tmdbData?.directorDetails || [],
          writerDetails: tmdbData?.writerDetails || [],
          cinematographerDetails: tmdbData?.cinematographerDetails || [],
          composerDetails: tmdbData?.composerDetails || [],
          genres,
          castDetails,
          actors: tmdbData?.cast || omdbData?.Actors || "",
          imdbRating,
          imdbVotes,
          tmdbRating,
          tmdbVotes,
          metascore,
          rottenTomatoes,
          trailerKey: tmdbData?.trailerKey || null,
          trailerUrl: tmdbData?.trailerUrl || null,
          streamProviders: tmdbData?.streamProviders || [],
          buyRentProviders: tmdbData?.buyRentProviders || [],
          freeProviders: tmdbData?.freeProviders || [],
          keywords: tmdbData?.keywordNames || [],
          keywordItems: tmdbData?.keywordItems || [],
          tmdbKeywords: tmdbData?.tmdbKeywords || [],
          tmdbGenreIds: tmdbData?.tmdbGenreIds || [],
          collectionId: tmdbData?.collectionId ?? null,
          collectionName: tmdbData?.collectionName ?? null,
          castIds: tmdbData?.castIds || [],
          crewPersonId: tmdbData?.crewPersonId || null,
          budget: tmdbData?.budget || null,
          revenue: tmdbData?.revenue || null,
          boxOffice: omdbData?.BoxOffice && omdbData.BoxOffice !== "N/A" ? omdbData.BoxOffice : tmdbData?.revenue || null,
          productionCompanies: tmdbData?.productionCompanies || (omdbData?.Production && omdbData.Production !== "N/A" ? omdbData.Production : null),
          originCountry: tmdbData?.originCountry || (omdbData?.Country && omdbData.Country !== "N/A" ? omdbData.Country : null),
          spokenLanguages: tmdbData?.spokenLanguages || (omdbData?.Language && omdbData.Language !== "N/A" ? omdbData.Language : null)
        };

        if (isMounted) {
          enrichedDetailsSessionCache.set(selectedId, combinedData);
          setMovie(combinedData);
          setIsLoading(false);
        }
      } catch (err) {
        if (isMounted && err.name !== "AbortError") {
          setError(err.message || "Failed to load movie details");
          setIsLoading(false);
        }
      }
    }

    loadEnrichedMovieDetails();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [selectedId, userRegion]);

  // Document title sync (delegates to MoviePage's useDocumentTitle when provided)
  useEffect(() => {
    if (!movie?.title) return undefined;
    if (typeof onTitleResolved === "function") {
      onTitleResolved(movie.title);
      return undefined;
    }
    document.title = `${movie.title} | CinemaVault`;
    return () => {
      document.title = "CinemaVault";
    };
  }, [movie?.title, onTitleResolved]);

  // ESC key listener to close
  useEffect(() => {
    function callback(e) {
      if (e.key !== "Escape" && e.code !== "Escape") return;
      const hasOpenDialog = Boolean(document.querySelector('[role="dialog"]'));
      if (shouldCloseMovieDetailOnEscape({ activePerson, hasOpenDialog })) {
        onCloseMovie();
      }
    }
    document.addEventListener("keydown", callback);
    return () => document.removeEventListener("keydown", callback);
  }, [onCloseMovie, activePerson]);

  const calibrationRating = hoverRating || userRating || Number(watchedItem?.userRating) || 0;

  const vaultCalibration = useMemo(
    () => computeVaultCalibration(watched, calibrationRating, movie || { imdbID: selectedId }),
    [watched, calibrationRating, movie, selectedId]
  );

  const craftAverage = useMemo(() => computeCraftAverage(ratingBreakdown), [ratingBreakdown]);
  const savedCraftAverage = useMemo(
    () => computeCraftAverage(watchedItem?.ratingBreakdown),
    [watchedItem]
  );

  const displayedQuickTags = useMemo(() => {
    if (showAllTags) return QUICK_REVIEW_TAGS;
    const contextual = getContextualQuickTags(calibrationRating);
    const activeExtras = QUICK_REVIEW_TAGS.filter(
      (tag) => hasQuickTagInNote(userNote, tag.id) && !contextual.some((c) => c.id === tag.id)
    );
    return [...contextual, ...activeExtras];
  }, [calibrationRating, showAllTags, userNote]);

  function handleCraftToggle(aspectId, pipValue) {
    setRatingBreakdown((prev) => {
      const next = { ...(prev || {}) };
      if (next[aspectId] === pipValue) {
        delete next[aspectId];
      } else {
        next[aspectId] = pipValue;
      }
      return Object.keys(next).length > 0 ? next : null;
    });
  }

  function handleWatchMetaPatch(patch) {
    setWatchMeta((prev) => ({ ...(prev || {}), ...patch }));
  }

  function handleDiscussFilm() {
    if (!movie) return;
    const castNames = Array.isArray(movie.cast)
      ? movie.cast
      : (movie.castDetails || []).map((c) => c?.name).filter(Boolean);
    const focusPayload = {
      ...movie,
      cast: castNames,
      imdbID: movie.imdbID || selectedId,
      isWatched,
      isWatchlist,
      userRating: watchedItem?.userRating ?? (Number(userRating) || null),
      userNote: watchedItem?.userNote ?? userNote.trim()
    };
    saveFilmFocusCache(focusPayload);
    navigate(buildFilmChatRoute(focusPayload));
  }

  // Save to Vault
  function handleSave() {
    const numericRating = Number(userRating);
    if (!movie || !Number.isFinite(numericRating) || numericRating < 1) return;

    let customDateWatched = null;
    if (isDateDirty && /^\d{4}-\d{2}-\d{2}$/.test(dateWatchedInput)) {
      const parsedMs = Date.parse(`${dateWatchedInput}T12:00:00.000Z`);
      if (Number.isFinite(parsedMs)) {
        customDateWatched = new Date(parsedMs).toISOString();
      }
    }

    const savedMovie = buildWatchedRatingPayload({
      movie: { ...movie, imdbID: movie.imdbID || selectedId },
      baseWatchedItem: watchedItem || null,
      userRating: numericRating,
      userNote,
      ratingBreakdown,
      watchMeta,
      customDateWatched,
      markCleared: true
    });

    if (!savedMovie) return;
    isEditingRef.current = false;
    setIsEditing(false);
    setOpenDrawer(null);
    setIsDateDirty(false);
    onAddWatched(savedMovie);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  }

  function handleAddToWatchlistClick() {
    if (!movie) return;
    const rawImdb = Number(movie.imdbRating) || Number(movie.tmdbRating);
    const newWatchlistMovie = {
      imdbID: movie.imdbID || selectedId,
      tmdbId: movie.tmdbId || null,
      ...(movie.Type ? { Type: movie.Type } : {}),
      title: movie.title,
      year: movie.year,
      poster: movie.poster,
      backdrop: movie.backdrop,
      imdbRating: Number.isFinite(rawImdb) && rawImdb > 0 ? rawImdb : null,
      runtime: Number(movie.runtimeMinutes) || (typeof movie.runtime === "string" ? parseInt(movie.runtime) : 120) || 120,
      genre: Array.isArray(movie.genres) ? movie.genres.join(", ") : "Cinema",
      tmdbGenreIds: movie.tmdbGenreIds || [],
      trailerKey: movie.trailerKey || null,
      streamProviders: movie.streamProviders || [],
      userRating: 0
    };
    const addFn = onAddToWatchlist || contextAddToWatchlist;
    if (addFn) {
      addFn(newWatchlistMovie);
    }
  }

  function handleRemoveWatchlistClick() {
    const targetId =
      watchlistItem?.imdbID ||
      watchlistItem?.id ||
      watchlistItem?.tmdbId ||
      movie?.imdbID ||
      movie?.tmdbId ||
      selectedId;
    if (onRemoveWatchlist) {
      onRemoveWatchlist(targetId);
    } else if (contextDeleteWatchlist) {
      contextDeleteWatchlist(targetId);
    }
  }

  function handleToggleTag(tag) {
    setUserNote((prev) => toggleQuickTagInNote(prev, tag));
  }

  const isInCompare = Boolean(movie && compareItems.some((item) => isSameMovie(item, movie)));

  return (
    <div className="netflix-detail-modal" aria-label={`Movie details for ${movie?.title || "Film"}`}>
      {isLoading ? (
        <MovieDetailsSkeleton onCloseMovie={onCloseMovie} />
      ) : error ? (
        <ErrorMessage message={error} />
      ) : movie ? (
        <div className="netflix-modal-card luxury-detail-card">
          <StickyTitleBar
            title={movie.title}
            poster={movie.poster}
            year={movie.year}
            onBack={onCloseMovie}
          />
          {/* Top Hero Cinematic Backdrop Banner */}
          <div className="movie-backdrop-hero">
            <HeroParallaxController />
            {movie.backdrop ? (
              <img
                src={movie.backdrop}
                alt={`${movie.title} cinematic backdrop`}
                className="movie-backdrop-img"
              />
            ) : (
              <div className="movie-backdrop-placeholder" />
            )}

            {/* Gradient Overlays */}
            <div className="movie-backdrop-gradient-top" />
            <div className="movie-backdrop-gradient-bottom" />

            {/* Floating Top Bar Nav */}
            <div className="movie-hero-nav-bar">
              <button className="btn-modal-back glassmorphic-btn" onClick={onCloseMovie} aria-label="Go back">
                <ArrowLeft size={18} aria-hidden="true" />
                <span>Back</span>
              </button>

              <div className="movie-hero-nav-actions">
                <button
                  type="button"
                  className={`btn-hero-compare glassmorphic-btn ${isInCompare ? "is-active" : ""}`}
                  onClick={() => toggleCompare(movie)}
                  aria-pressed={isInCompare}
                  aria-label={
                    isInCompare
                      ? `Remove ${movie.title} from Compare`
                      : `Add ${movie.title} to Compare`
                  }
                >
                  {isInCompare ? (
                    <Check size={15} aria-hidden="true" />
                  ) : (
                    <GitCompareArrows size={15} aria-hidden="true" />
                  )}
                  <span>{isInCompare ? `In Compare (${compareItems.length}/3)` : "+ Compare"}</span>
                </button>

                <button
                  type="button"
                  className="btn-hero-discuss glassmorphic-btn"
                  onClick={handleDiscussFilm}
                  aria-label={`Discuss ${movie.title} with AI Film Companion`}
                >
                  <MessageSquare size={15} aria-hidden="true" />
                  <span>Discuss This Film</span>
                </button>

                {(movie.trailerKey || movie.title) && (
                  <a
                    href={
                      movie.trailerKey
                        ? `https://www.youtube.com/watch?v=${movie.trailerKey}`
                        : `https://www.youtube.com/results?search_query=${encodeURIComponent(`${movie.title} ${movie.year || ""} official trailer`)}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-hero-trailer-play"
                    aria-label={`Watch official trailer for ${movie.title} on YouTube (opens in new tab)`}
                  >
                    <Play size={16} fill="currentColor" aria-hidden="true" />
                    <span>Watch Trailer</span>
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                )}
              </div>
            </div>

            {/* Hero Title & Tagline Overlay */}
            <div className="movie-hero-title-group">
              {movie.tagline && <p className="movie-hero-tagline">“{movie.tagline}”</p>}
              <h1 className="movie-hero-title display-title">{movie.title}</h1>
              <div className="movie-hero-chips">
                <span className="hero-chip"><Calendar size={13} aria-hidden="true" /> {movie.released || movie.year}</span>
                {movie.runtime && movie.runtime !== "N/A" && (
                  <span className="hero-chip"><Clock size={13} aria-hidden="true" /> {movie.runtime}</span>
                )}
                {movie.rated && (
                  <span className="hero-chip hero-chip-rated"><ShieldAlert size={13} aria-hidden="true" /> {movie.rated}</span>
                )}
                {movie.spokenLanguages && (
                  <span className="hero-chip"><Globe size={13} aria-hidden="true" /> {movie.spokenLanguages}</span>
                )}
              </div>
            </div>
          </div>

          {/* Main 2-Column Content Grid */}
          <div className="netflix-modal-body luxury-detail-body">
            {/* Left Column: Poster & Luxury Rating Deck */}
            <div className="netflix-modal-left">
              <motion.div
                key={`poster-${movie.imdbID || movie.tmdbId || selectedId}`}
                className="netflix-modal-poster-wrap elevated-poster-card"
                initial={{ opacity: 0, y: 14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
              >
                <PosterImage src={movie.poster} title={movie.title} alt={`${movie.title} poster`} />
              </motion.div>

              {/* 🌟 LUXURY RATING & VAULT DECK */}
              <div className="luxury-rating-deck">
                {isWatched && !isEditing ? (
                  <div className="vault-saved-status-card">
                    <div className="vault-saved-header">
                      <div className="vault-emblem-badge">
                        <Check size={18} className="text-[#10b981]" aria-hidden="true" />
                      </div>
                      <div>
                        <h4 className="vault-saved-title">In Your Cinema Vault</h4>
                        <span className="vault-saved-subtitle">Saved in your Vault</span>
                      </div>
                    </div>

                    <div className="vault-saved-score-row">
                      {(() => {
                        const savedRating = Number(watchedItem?.userRating) || 0;
                        const savedTier = getRatingTier(savedRating);
                        return savedRating > 0 ? (
                          <>
                            <div className="vault-score-display">
                              <span className="vault-score-num">★ {savedRating}</span>
                              <span className="vault-score-denom">/ 10</span>
                            </div>
                            <div className="vault-tier-pill" style={{ background: savedTier.bg, borderColor: savedTier.border, color: savedTier.color }}>
                              <Star size={13} fill="currentColor" aria-hidden="true" />
                              <span>{savedTier.shortLabel || savedTier.label.split("(")[0].trim()}</span>
                            </div>
                          </>
                        ) : (
                          <div className="vault-tier-pill" style={{ background: savedTier.bg, borderColor: savedTier.border, color: savedTier.color }}>
                            <span>Unrated — tap Edit below to score 1–10</span>
                          </div>
                        );
                      })()}
                    </div>

                    {(savedCraftAverage || watchedItem?.watchMeta || watchedItem?.dateWatched) && (
                      <div className="vault-saved-meta-pills">
                        {savedCraftAverage && (
                          <span className="vault-meta-chip">
                            Craft {savedCraftAverage}/5★
                          </span>
                        )}
                        {watchedItem?.watchMeta?.format && (
                          <span className="vault-meta-chip">
                            {WATCH_FORMATS.find((f) => f.id === watchedItem.watchMeta.format)?.label || watchedItem.watchMeta.format}
                          </span>
                        )}
                        {Number(watchedItem?.watchMeta?.rewatchCount) >= 2 && (
                          <span className="vault-meta-chip">
                            {watchedItem.watchMeta.rewatchCount}× Watches
                          </span>
                        )}
                        {watchedItem?.watchMeta?.containsSpoilers && (
                          <span className="vault-meta-chip is-warning">
                            Spoiler Note
                          </span>
                        )}
                        {watchedItem?.dateWatched && (
                          <span className="vault-meta-chip">
                            {String(watchedItem.dateWatched).slice(0, 10)}
                          </span>
                        )}
                      </div>
                    )}

                    {watchedItem?.userNote && (
                      <div className="vault-saved-notes-box">
                        <p className="vault-saved-notes-text">"{watchedItem.userNote}"</p>
                      </div>
                    )}

                    <div className="vault-saved-actions">
                      <button
                        type="button"
                        className="btn-edit-vault-rating"
                        onClick={() => setIsEditing(true)}
                        aria-label="Edit vault rating and personal notes"
                      >
                        <Edit3 size={15} aria-hidden="true" />
                        <span>Edit Rating / Review</span>
                      </button>

                      <button
                        type="button"
                        className="btn-discuss-film-deck"
                        onClick={handleDiscussFilm}
                        aria-label={`Discuss ${movie.title} with AI Film Companion`}
                      >
                        <MessageSquare size={15} aria-hidden="true" />
                        <span>Discuss This Film</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="interactive-rating-module rating-studio-card">
                    <StarRatingStage
                      value={userRating}
                      hoverValue={hoverRating}
                      onChange={(val) => {
                        setUserRating(val);
                        setHoverRating(0);
                      }}
                      onHoverChange={setHoverRating}
                      calibration={vaultCalibration}
                      onSelectAnchor={(anchor) =>
                        anchor?.imdbID && navigate(`/movie/${encodeURIComponent(anchor.imdbID)}`)
                      }
                      titleLabel={isWatched ? "Update Vault Entry" : "Rating Studio"}
                      ariaLabel="Rate this film from 1 to 10"
                    />

                    {/* Progressive Quick Review Tags */}
                    <div className="quick-tags-section">
                      <div className="quick-tags-header-row">
                        <span className="quick-tags-label"><Tag size={12} aria-hidden="true" /> Quick Review Tags</span>
                        <button
                          type="button"
                          className="quick-tags-expand-btn"
                          onClick={() => setShowAllTags((prev) => !prev)}
                        >
                          {showAllTags ? "Fewer tags" : `More tags (+${Math.max(0, QUICK_REVIEW_TAGS.length - displayedQuickTags.length)})`}
                        </button>
                      </div>
                      <div className="quick-tags-row">
                        {displayedQuickTags.map(({ id: tag }) => {
                          const isTagActive = hasQuickTagInNote(userNote, tag);
                          return (
                            <button
                              key={tag}
                              type="button"
                              className={`quick-tag-chip ${isTagActive ? "tag-active" : ""}`}
                              onClick={() => handleToggleTag(tag)}
                            >
                              #{tag}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Optional Collapsed Studio Drawers: Craft Breakdown & Watch Log */}
                    <div className="studio-drawers-wrap">
                      <div className="studio-drawers-tabs">
                        <button
                          type="button"
                          className={`studio-drawer-tab ${openDrawer === "craft" ? "is-open" : ""} ${craftAverage ? "has-data" : ""}`}
                          onClick={() => setOpenDrawer((prev) => (prev === "craft" ? null : "craft"))}
                          aria-expanded={openDrawer === "craft"}
                        >
                          <span>Craft Breakdown{craftAverage ? ` · ${craftAverage}★` : ""}</span>
                          {openDrawer === "craft" ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
                        </button>

                        <button
                          type="button"
                          className={`studio-drawer-tab ${openDrawer === "watchlog" ? "is-open" : ""} ${(watchMeta?.format || watchMeta?.containsSpoilers || Number(watchMeta?.rewatchCount) >= 1 || isDateDirty) ? "has-data" : ""}`}
                          onClick={() => setOpenDrawer((prev) => (prev === "watchlog" ? null : "watchlog"))}
                          aria-expanded={openDrawer === "watchlog"}
                        >
                          <span>Watch Log{watchMeta?.format ? ` · ${WATCH_FORMATS.find((f) => f.id === watchMeta.format)?.label}` : ""}</span>
                          {openDrawer === "watchlog" ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
                        </button>
                      </div>

                      {openDrawer === "craft" && (
                        <div className="studio-drawer-panel craft-drawer-panel">
                          <div className="craft-panel-header">
                            <span className="craft-panel-hint">Optional 1–5 aspect scores</span>
                            {ratingBreakdown && (
                              <button
                                type="button"
                                className="studio-drawer-clear-btn"
                                onClick={() => setRatingBreakdown(null)}
                              >
                                Clear craft
                              </button>
                            )}
                          </div>
                          <div className="craft-rows-list">
                            {CRAFT_ASPECTS.map((aspect) => {
                              const currentVal = Number(ratingBreakdown?.[aspect.id]) || 0;
                              return (
                                <div key={aspect.id} className="craft-aspect-row">
                                  <span className="craft-aspect-label">{aspect.label}</span>
                                  <div className="craft-pips-group" role="group" aria-label={`${aspect.label} score out of 5`}>
                                    {[1, 2, 3, 4, 5].map((pip) => {
                                      const lit = pip <= currentVal;
                                      return (
                                        <button
                                          key={pip}
                                          type="button"
                                          className={`craft-pip-btn ${lit ? "is-lit" : ""}`}
                                          onClick={() => handleCraftToggle(aspect.id, pip)}
                                          aria-pressed={currentVal === pip}
                                          aria-label={`${aspect.label} ${pip} out of 5`}
                                        >
                                          {pip}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {openDrawer === "watchlog" && (
                        <div className="studio-drawer-panel watchlog-drawer-panel">
                          <div className="watchlog-field-group">
                            <span className="watchlog-field-label">Format</span>
                            <div className="watchlog-formats-row">
                              {WATCH_FORMATS.map((fmt) => {
                                const isFmtActive = watchMeta?.format === fmt.id;
                                return (
                                  <button
                                    key={fmt.id}
                                    type="button"
                                    className={`watchlog-pill-btn ${isFmtActive ? "is-active" : ""}`}
                                    onClick={() => handleWatchMetaPatch({ format: isFmtActive ? undefined : fmt.id })}
                                  >
                                    {fmt.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="watchlog-inline-controls">
                            <label className="watchlog-field-group">
                              <span className="watchlog-field-label">Date Watched</span>
                              <input
                                type="date"
                                className="watchlog-date-input"
                                value={dateWatchedInput}
                                onChange={(e) => {
                                  setDateWatchedInput(e.target.value);
                                  setIsDateDirty(true);
                                }}
                              />
                            </label>

                            <label className="watchlog-field-group">
                              <span className="watchlog-field-label">Watch Count</span>
                              <input
                                type="number"
                                min="1"
                                max="999"
                                placeholder="1"
                                className="watchlog-rewatch-input"
                                value={watchMeta?.rewatchCount || ""}
                                onChange={(e) => {
                                  const parsed = parseInt(e.target.value, 10);
                                  handleWatchMetaPatch({ rewatchCount: Number.isFinite(parsed) && parsed >= 1 ? parsed : undefined });
                                }}
                              />
                            </label>
                          </div>

                          <button
                            type="button"
                            className={`watchlog-spoiler-toggle ${watchMeta?.containsSpoilers ? "is-active" : ""}`}
                            onClick={() => handleWatchMetaPatch({ containsSpoilers: !watchMeta?.containsSpoilers })}
                            aria-pressed={Boolean(watchMeta?.containsSpoilers)}
                          >
                            <ShieldAlert size={13} aria-hidden="true" />
                            <span>{watchMeta?.containsSpoilers ? "Marked: Contains spoilers" : "Flag review as containing spoilers"}</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Personal Notes Textarea */}
                    <textarea
                      className="user-note-input luxury-notes-area"
                      placeholder="1–2 lines on why you liked or disliked it (Gemini reads this to sharpen picks)..."
                      value={userNote}
                      onChange={(e) => setUserNote(e.target.value)}
                      aria-label="Personal notes on movie"
                      rows={3}
                    />

                    {/* Actions */}
                    <div className="rating-box-actions">
                      <button
                        className={`btn-vault-primary luxury-save-btn ${saveSuccess ? "is-saved" : ""}`}
                        onClick={handleSave}
                        disabled={!(Number(userRating) > 0)}
                        aria-label={isWatched ? "Update Vault Entry" : "Add to Watched Vault"}
                      >
                        {saveSuccess ? (
                          <>
                            <CheckCircle2 size={18} className="text-[#10b981]" aria-hidden="true" />
                            <span>Vault Synchronized!</span>
                          </>
                        ) : !(Number(userRating) > 0) ? (
                          <>
                            <Star size={18} aria-hidden="true" />
                            <span>Select Rating (1–10)</span>
                          </>
                        ) : isWatched ? (
                          <>
                            <Check size={18} aria-hidden="true" />
                            <span>Update Vault Entry</span>
                          </>
                        ) : (
                          <>
                            <Plus size={18} aria-hidden="true" />
                            <span>Save to Film Vault</span>
                          </>
                        )}
                      </button>

                      {isWatched && isEditing && (
                        <button
                          type="button"
                          className="btn-cancel-edit"
                          onClick={() => {
                            syncDraftFromWatchedItem(watchedItem);
                            setIsEditing(false);
                          }}
                        >
                          Cancel Editing
                        </button>
                      )}

                      {!isWatched && (
                        <>
                          {!isWatchlist ? (
                            <button
                              type="button"
                              className="btn-vault-secondary"
                              onClick={handleAddToWatchlistClick}
                              aria-label="Add to Watchlist"
                            >
                              <Bookmark size={16} aria-hidden="true" />
                              <span>Add to Watchlist</span>
                            </button>
                          ) : (
                            <div className="watchlist-active-bar">
                              <span className="watchlist-badge">
                                <Bookmark size={14} fill="currentColor" aria-hidden="true" />
                                <span>Queued in Watchlist</span>
                              </span>
                              <button
                                type="button"
                                className="btn-watchlist-remove"
                                onClick={handleRemoveWatchlistClick}
                                aria-label="Remove from Watchlist"
                                title="Remove from Watchlist"
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </>
                      )}

                      <button
                        type="button"
                        className="btn-discuss-film-deck"
                        onClick={handleDiscussFilm}
                        aria-label={`Discuss ${movie.title} with AI Film Companion`}
                      >
                        <MessageSquare size={15} aria-hidden="true" />
                        <span>Discuss This Film</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Rich TMDB Cinema Metadata & Cast */}
            <div className="netflix-modal-right">
              {/* Critical Scores Matrix (4 Multi-Source Cards) */}
              <div className="critical-scores-matrix">
                {/* IMDb Card */}
                {movie.imdbRating && (
                  <div className="score-matrix-card imdb-card">
                    <div className="score-card-header">
                      <Star size={16} className="text-[var(--text-3)]" fill="currentColor" aria-hidden="true" />
                      <span className="score-source-name">IMDb</span>
                    </div>
                    <div className="score-card-value">
                      <span className="score-main-num">{movie.imdbRating}</span>
                      <span className="score-sub-num">/10</span>
                    </div>
                    {movie.imdbVotes && <span className="score-meta-text">{movie.imdbVotes} votes</span>}
                  </div>
                )}

                {/* Rotten Tomatoes Card */}
                {movie.rottenTomatoes && (
                  <div className="score-matrix-card rt-card">
                    <div className="score-card-header">
                      <Gauge size={16} className="score-icon text-[var(--text-3)]" aria-hidden="true" />
                      <span className="score-source-name">Rotten Tomatoes</span>
                    </div>
                    <div className="score-card-value">
                      <span className="score-main-num">{movie.rottenTomatoes}</span>
                    </div>
                    <span className="score-meta-text">Tomatometer Critic Score</span>
                  </div>
                )}

                {/* Metacritic Card */}
                {movie.metascore && (
                  <div className="score-matrix-card meta-card">
                    <div className="score-card-header">
                      <Award size={16} className="text-[#10b981]" aria-hidden="true" />
                      <span className="score-source-name">Metacritic</span>
                    </div>
                    <div className="score-card-value">
                      <span className="score-main-num metascore-pill">{movie.metascore}</span>
                      <span className="score-sub-num">/100</span>
                    </div>
                    <span className="score-meta-text">Metascore Acclaim</span>
                  </div>
                )}

                {/* TMDB Community Score Card */}
                {movie.tmdbRating && (
                  <div className="score-matrix-card tmdb-card">
                    <div className="score-card-header">
                      <Sparkles size={16} className="text-[var(--text-3)]" aria-hidden="true" />
                      <span className="score-source-name">TMDB Community</span>
                    </div>
                    <div className="score-card-value">
                      <span className="score-main-num">{movie.tmdbRating}</span>
                      <span className="score-sub-num">★</span>
                    </div>
                    {movie.tmdbVotes && <span className="score-meta-text">{movie.tmdbVotes} cinephiles</span>}
                  </div>
                )}
              </div>

              {/* Genres Row */}
              {movie.genres?.length > 0 && (
                <div className="netflix-genres-row">
                  {movie.genres.map((g, idx) => {
                    const genreId =
                      TMDB_GENRE_MAP[String(g || "").trim().toLowerCase()] ??
                      (Array.isArray(movie.tmdbGenreIds) && movie.tmdbGenreIds.length === movie.genres.length
                        ? movie.tmdbGenreIds[idx]
                        : null);
                    if (Number.isSafeInteger(Number(genreId)) && Number(genreId) > 0) {
                      return (
                        <Link
                          key={g}
                          to={buildExploreRoute({ genres: [Number(genreId)] })}
                          className="netflix-genre-tag luxury-genre-tag clickable-research-chip"
                          title={`Explore ${g} films`}
                        >
                          {g}
                        </Link>
                      );
                    }
                    return (
                      <span key={g} className="netflix-genre-tag luxury-genre-tag">
                        {g}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Where to Stream / Watch Providers */}
              {(movie.streamProviders?.length > 0 || movie.buyRentProviders?.length > 0 || movie.freeProviders?.length > 0) && (
                <ScrollRevealSection as="div" delay={0.04} className="streaming-providers-card">
                  <div className="stream-header-row">
                    <div className="stream-header-title">
                      <Tv size={16} className="text-[var(--text-3)]" aria-hidden="true" />
                      <span>Where to Stream</span>
                    </div>
                    <span className="stream-region-tag">
                      Region: {!userRegion || userRegion === "GLOBAL" ? "US (Global Default)" : userRegion}
                    </span>
                  </div>

                  <div className="stream-sections-wrap">
                    {movie.streamProviders?.length > 0 && (
                      <div className="stream-group">
                        <span className="stream-group-label">Subscription Stream</span>
                        <div className="stream-logos-row">
                          {movie.streamProviders.map((p) => (
                            <div key={p.id} className="stream-provider-pill" title={p.name}>
                              {p.logo && <img src={p.logo} alt={p.name} className="stream-logo-img" />}
                              <span className="stream-provider-name">{p.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {movie.freeProviders?.length > 0 && (
                      <div className="stream-group">
                        <span className="stream-group-label">Free with Ads</span>
                        <div className="stream-logos-row">
                          {movie.freeProviders.map((p) => (
                            <div key={p.id} className="stream-provider-pill stream-free-pill" title={p.name}>
                              {p.logo && <img src={p.logo} alt={p.name} className="stream-logo-img" />}
                              <span className="stream-provider-name">{p.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {movie.buyRentProviders?.length > 0 && (
                      <div className="stream-group">
                        <span className="stream-group-label">Buy or Rent</span>
                        <div className="stream-logos-row">
                          {movie.buyRentProviders.slice(0, 5).map((p) => (
                            <div key={p.id} className="stream-provider-pill stream-rent-pill" title={p.name}>
                              {p.logo && <img src={p.logo} alt={p.name} className="stream-logo-img" />}
                              <span className="stream-provider-name">{p.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollRevealSection>
              )}

              {/* Synopsis */}
              <ScrollRevealSection as="div" delay={0.05} className="netflix-plot-block">
                <h3 className="section-subtitle">The Narrative</h3>
                <p className="netflix-plot-text luxury-plot-text">{movie.plot}</p>
              </ScrollRevealSection>

              {/* Cast & Characters Gallery with Headshots */}
              {creditPeople.cast.length > 0 && (
                <ScrollRevealSection as="div" delay={0.06} className="cast-gallery-section">
                  <h3 className="section-subtitle">Starring Cast & Characters</h3>
                  <div className="cast-gallery-grid">
                    {creditPeople.cast.slice(0, 8).map((actor) => (
                      <button
                        key={actor.id || actor.name}
                        type="button"
                        onClick={() => setActivePerson({
                          id: actor.id,
                          name: actor.name,
                          roleHint: actor.roleHint,
                          profile: actor.profile
                        })}
                        className="cast-actor-card cast-actor-card--interactive"
                        title={`View ${actor.name} filmography`}
                      >
                        <div className="cast-avatar-wrap">
                          {actor.profile ? (
                            <img
                              src={actor.profile}
                              alt={actor.name}
                              className="cast-avatar-img"
                              loading="lazy"
                            />
                          ) : (
                            <div className="cast-avatar-fallback">
                              <User size={18} className="text-[#8a8a86]" aria-hidden="true" />
                            </div>
                          )}
                        </div>
                        <div className="cast-info-wrap">
                          <span className="cast-actor-name">{actor.name}</span>
                          {actor.character && (
                            <span className="cast-character-name">{actor.character}</span>
                          )}
                        </div>
                        <ChevronRight size={14} className="cast-card-chevron" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </ScrollRevealSection>
              )}

              {/* Creative Credits Matrix */}
              <ScrollRevealSection as="div" delay={0.07} className="netflix-credits-grid luxury-credits-grid">
                {[
                  { key: "directors", label: "Director", Icon: Clapperboard, people: creditPeople.directors },
                  { key: "writers", label: "Screenplay & Writers", Icon: Film, people: creditPeople.writers },
                  { key: "cinematographers", label: "Cinematography (DoP)", Icon: Camera, people: creditPeople.cinematographers },
                  { key: "composers", label: "Original Score", Icon: Music, people: creditPeople.composers }
                ]
                  .filter((row) => row.people.length > 0)
                  .map(({ key, label, Icon, people }) => (
                    <div key={key} className="credit-item">
                      <span className="credit-label">
                        <Icon size={14} className="text-[var(--text-3)]" aria-hidden="true" /> {label}
                      </span>
                      <div className="credit-value credit-person-list">
                        {people.map((person, idx) => (
                          <span key={person.id || `${person.name}-${idx}`}>
                            <button
                              type="button"
                              onClick={() => setActivePerson({
                                id: person.id,
                                name: person.name,
                                roleHint: person.roleHint,
                                profile: null
                              })}
                              className="credit-person-btn"
                              title={`View ${person.name} filmography`}
                            >
                              {person.name}
                            </button>
                            {idx < people.length - 1 && (
                              <span className="credit-person-separator" aria-hidden="true">,</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
              </ScrollRevealSection>

              {/* Financial & Studio Production Intel */}
              {(movie.budget || movie.revenue || movie.boxOffice || movie.productionCompanies) && (
                <div className="production-intel-strip">
                  {(movie.revenue || movie.boxOffice) && (
                    <div className="intel-stat-item">
                      <span className="intel-stat-label">Worldwide Box Office</span>
                      <span className="intel-stat-value">{movie.revenue || movie.boxOffice}</span>
                    </div>
                  )}

                  {movie.budget && (
                    <div className="intel-stat-item">
                      <span className="intel-stat-label">Production Budget</span>
                      <span className="intel-stat-value">{movie.budget}</span>
                    </div>
                  )}

                  {movie.productionCompanies && (
                    <div className="intel-stat-item full-width">
                      <span className="intel-stat-label">Production Studios</span>
                      <span className="intel-stat-value studio-text">{movie.productionCompanies}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Thematic Keywords & Cinematic Tropes */}
              {(movie.keywordItems?.length > 0 || movie.keywords?.length > 0) && (
                <div className="thematic-keywords-section">
                  <span className="keywords-title"><Tag size={13} aria-hidden="true" /> Cinematic Motifs & Themes</span>
                  <div className="keywords-chip-cloud">
                    {(movie.keywordItems?.length > 0
                      ? movie.keywordItems
                      : (movie.keywords || []).map((name, idx) => ({
                          id:
                            Array.isArray(movie.tmdbKeywords) &&
                            movie.tmdbKeywords.length === movie.keywords.length
                              ? movie.tmdbKeywords[idx]
                              : null,
                          name
                        }))
                    ).map((kw) =>
                      Number.isSafeInteger(Number(kw.id)) && Number(kw.id) > 0 ? (
                        <Link
                          key={`${kw.id}-${kw.name}`}
                          to={buildExploreRoute({
                            keywords: [{ id: Number(kw.id), name: kw.name }],
                            minImdb: 0,
                            minVotes: 25
                          })}
                          className="theme-keyword-chip clickable-research-chip"
                          title={`Explore films with #${kw.name}`}
                        >
                          #{kw.name}
                        </Link>
                      ) : (
                        <span key={kw.name} className="theme-keyword-chip">
                          #{kw.name}
                        </span>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <CollectionTimeline timeline={collectionTimeline} loading={collectionLoading} />

          <SimilarFilmsStrip
            films={similarFilms}
            sourceTitle={movie.title}
            genreIds={movie.tmdbGenreIds || []}
            loading={similarLoading}
            onSelectMovie={(movieId) => navigate(`/movie/${encodeURIComponent(movieId)}`)}
            onQuickRate={onQuickRate}
          />
        </div>
      ) : null}

      <PersonFilmographyModal
        personTarget={activePerson}
        watched={watched}
        watchlist={watchlist}
        onClose={() => setActivePerson(null)}
        onSelectMovie={(credit) => {
          setActivePerson(null);
          navigate(`/movie/${credit.tmdbId}`);
        }}
        onQuickRate={onQuickRate}
        onAddToWatchlist={onAddToWatchlist || contextAddToWatchlist}
        onOpenFullProfile={(personId, dept) => {
          const route = buildPersonProfileRoute(personId, dept);
          setActivePerson(null);
          if (route) navigate(route);
        }}
      />
    </div>
  );
}
