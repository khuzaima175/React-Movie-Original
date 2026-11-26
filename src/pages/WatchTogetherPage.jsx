import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Check,
  Copy,
  Film,
  HeartHandshake,
  Link2,
  Loader2,
  Sparkles,
  Users
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { fetchTmdbJson, getMovieDetailsBatch, hasTmdbBackend } from "../services/apiTransport";
import { toDashboardCardItem } from "../services/dashboardService";
import {
  computeProfileTasteVector,
  fetchPublicProfileByUsername
} from "../services/communityService";
import {
  buildCollabSimMapFromIndex,
  loadDefaultEmbeddingIndex
} from "../services/embeddingService";
import {
  blendEaseAndCollabSimMaps,
  buildEaseSimMapFromIndex,
  loadDefaultEaseIndex
} from "../services/easeService";
import { computeZScoredWeights } from "../services/scoringUtils";
import { CORE_TASTE_DECK } from "../services/tasteDeckService";
import {
  buildJointCandidateIdPool,
  buildPartnerScoreMapFromVector,
  rankWatchTogetherCandidates
} from "../services/watchTogetherService";
import {
  createWatchSession,
  fetchWatchSession,
  joinWatchSession,
  normalizeRoomCode,
  submitWatchVote
} from "../services/watchSessionClient";
import PosterImage from "../components/PosterImage";
import WatchTogetherSwipeDeck from "../components/WatchTogetherSwipeDeck";
import { Button } from "../components/ui/Button";
import "../styles/together.css";

async function loadSharedCandidatePool(region = "US") {
  if (!hasTmdbBackend()) {
    return CORE_TASTE_DECK.map((m) => ({
      tmdbId: m.tmdbId,
      imdbID: m.imdbID,
      title: m.title,
      year: m.year,
      genre: m.genre,
      poster: m.poster,
      overview: m.plot,
      vote_average: Number(m.imdbRating) || 7.5
    }));
  }

  const pages = [1, 2, 3];
  const responses = await Promise.all(
    pages.map((page) =>
      fetchTmdbJson("/3/discover/movie", {
        sort_by: "vote_count.desc",
        "vote_average.gte": 6.6,
        "vote_count.gte": 350,
        include_adult: "false",
        language: "en-US",
        region: region && region !== "GLOBAL" ? region : "US",
        page
      }).catch(() => null)
    )
  );

  const byId = new Map();
  for (const res of responses) {
    for (const raw of res?.results || []) {
      const id = Number(raw?.id);
      if (!id || byId.has(id)) continue;
      byId.set(id, {
        tmdbId: id,
        id: `tmdb_${id}`,
        title: raw.title || raw.original_title || "Untitled",
        year: raw.release_date ? raw.release_date.slice(0, 4) : "",
        release_date: raw.release_date || "",
        poster: raw.poster_path ? `https://image.tmdb.org/t/p/w500${raw.poster_path}` : null,
        overview: raw.overview || "",
        tmdbGenreIds: Array.isArray(raw.genre_ids) ? raw.genre_ids : [],
        vote_average: Number(raw.vote_average) || 0,
        vote_count: Number(raw.vote_count) || 0
      });
    }
  }
  return [...byId.values()];
}

function hydrateTogetherCandidateFromRaw(raw, region = "US") {
  if (!raw || !Number(raw.id)) return null;
  const rCode = region && region !== "GLOBAL" ? region : "US";
  const regionProviders = raw["watch/providers"]?.results?.[rCode] || raw["watch/providers"]?.results?.US || null;
  const flatrate = Array.isArray(regionProviders?.flatrate) ? regionProviders.flatrate : [];
  const free = Array.isArray(regionProviders?.free) ? regionProviders.free : [];
  const card = toDashboardCardItem({
    ...raw,
    imdbID: raw.external_ids?.imdb_id || `tmdb_${raw.id}`,
    genre_ids: Array.isArray(raw.genres) ? raw.genres.map((g) => g.id) : []
  });
  return {
    ...card,
    tmdbId: Number(raw.id),
    id: `tmdb_${raw.id}`,
    imdbID: raw.external_ids?.imdb_id || card.imdbID || `tmdb_${raw.id}`,
    genre: Array.isArray(raw.genres) ? raw.genres.map((g) => g.name).join(", ") : (card.genre || ""),
    tmdbGenreIds: Array.isArray(raw.genres) ? raw.genres.map((g) => g.id) : (card.tmdbGenreIds || []),
    overview: raw.overview || card.overview || "",
    vote_average: Number(raw.vote_average) || 0,
    vote_count: Number(raw.vote_count) || 0,
    streamProviders: flatrate.map((p) => ({ id: p.provider_id, name: p.provider_name })),
    freeProviders: free.map((p) => ({ id: p.provider_id, name: p.provider_name })),
    watchProviderLink: typeof regionProviders?.link === "string" ? regionProviders.link : null,
    providersHydrated: Boolean(raw["watch/providers"])
  };
}

async function buildPersonalizedTogetherPool({
  scoresA,
  scoresB,
  watchedA,
  watchedB,
  region = "US"
}) {
  const fallbackPool = await loadSharedCandidatePool(region);
  const fallbackById = new Map(fallbackPool.map((c) => [Number(c.tmdbId), c]));
  const fallbackIds = fallbackPool.map((c) => Number(c.tmdbId)).filter(Boolean);

  const targetIds = buildJointCandidateIdPool({
    scoresA,
    scoresB,
    fallbackIds,
    watchedA,
    watchedB,
    limit: 80
  });

  if (!hasTmdbBackend() || targetIds.length === 0) {
    return fallbackPool;
  }

  const rawBatch = await getMovieDetailsBatch(targetIds).catch(() => ({}));
  const hydrated = [];
  for (const id of targetIds) {
    const raw = rawBatch?.[id] || rawBatch?.[String(id)];
    const mapped = hydrateTogetherCandidateFromRaw(raw, region) || fallbackById.get(id);
    if (mapped) hydrated.push(mapped);
  }
  return hydrated.length > 0 ? hydrated : fallbackPool;
}

export default function WatchTogetherPage() {
  const { code: routeCode } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const {
    watched = [],
    tasteRules = [],
    userRegion = "US",
    userWatchProviders = [],
    cloudUser = null,
    cloudProfile = null
  } = useApp();

  const initialPartner = searchParams.get("partner") || "";
  const activeCode = normalizeRoomCode(routeCode || "");

  useDocumentTitle(activeCode ? `Watch Together (${activeCode})` : "Watch Together");

  const [partnerInput, setPartnerInput] = useState(initialPartner);
  const [partnerState, setPartnerState] = useState({
    loading: false,
    error: "",
    profile: null,
    ratings: []
  });
  const [mergedPicks, setMergedPicks] = useState([]);
  const [isComputing, setIsComputing] = useState(false);
  const [viewMode, setViewMode] = useState("grid"); // "grid" | "swipe"
  const [localVotesA, setLocalVotesA] = useState({});
  const [localVotesB, setLocalVotesB] = useState({});
  const [onlyMyProviders, setOnlyMyProviders] = useState(false);

  // Shareable Room State (/together/:code)
  const [roomState, setRoomState] = useState({
    loading: Boolean(activeCode),
    status: activeCode ? "loading" : "idle",
    session: null,
    error: ""
  });
  const [guestName, setGuestName] = useState("Partner");
  const [guestQuickPickIds, setGuestQuickPickIds] = useState(() => new Set());
  const [roomBusy, setRoomBusy] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [localRoomRole, setLocalRoomRole] = useState(() => (activeCode ? "guest" : "host"));

  const computeHostScoreMap = useCallback(async (candidates, hostWatchedList) => {
    const [embIdx, easeIdx] = await Promise.all([
      loadDefaultEmbeddingIndex().catch(() => null),
      loadDefaultEaseIndex().catch(() => null)
    ]);
    const realWatched = (hostWatchedList || []).filter((m) => !m.isSample && Number(m.userRating) > 0);
    if (!embIdx || realWatched.length === 0) {
      return { embIdx, hostVec64: null, scoreMap: new Map() };
    }
    const weighted = computeZScoredWeights(realWatched);
    const svdMap = buildCollabSimMapFromIndex(weighted, embIdx);
    const easeMap = easeIdx ? buildEaseSimMapFromIndex(weighted, easeIdx) : null;
    const blended = blendEaseAndCollabSimMaps(easeMap, svdMap, easeIdx);
    const hostVec64 = computeProfileTasteVector(realWatched, embIdx);
    return { embIdx, hostVec64, scoreMap: blended };
  }, []);

  const runDirectPartnerMerge = useCallback(
    async (rawHandle) => {
      const cleaned = String(rawHandle || "").trim().replace(/^@+/, "");
      if (!cleaned) return;
      setPartnerState({ loading: true, error: "", profile: null, ratings: [] });
      setIsComputing(true);
      try {
        const res = await fetchPublicProfileByUsername(cleaned, cloudUser?.id || null);
        if (res.status !== "ok" || !res.profile) {
          setPartnerState({
            loading: false,
            error:
              res.status === "unconfigured"
                ? "Public profile matching requires cloud sync configuration."
                : `No public CinemaVault profile found for @${cleaned}.`,
            profile: null,
            ratings: []
          });
          setMergedPicks([]);
          return;
        }
        setPartnerState({
          loading: false,
          error: "",
          profile: res.profile,
          ratings: res.ratings || []
        });

        const hostRes = await computeHostScoreMap(null, watched);
        const partnerWatched = (res.ratings || []).map((r) => ({
          tmdbId: r.tmdb_id,
          imdbID: r.imdb_id,
          title: r.title,
          year: r.year
        }));

        const allVectorScoresB = buildPartnerScoreMapFromVector(
          res.profile.taste_vector,
          hostRes.embIdx,
          []
        );
        const candidates = await buildPersonalizedTogetherPool({
          scoresA: hostRes.scoreMap,
          scoresB: allVectorScoresB,
          watchedA: watched,
          watchedB: partnerWatched,
          region: userRegion
        });

        const candIds = candidates.map((c) => c.tmdbId).filter(Boolean);
        const scoresB = buildPartnerScoreMapFromVector(
          res.profile.taste_vector,
          hostRes.embIdx,
          candIds
        );

        const ranked = rankWatchTogetherCandidates({
          candidates,
          scoresA: hostRes.scoreMap,
          scoresB,
          watchedA: watched,
          watchedB: partnerWatched,
          tasteRulesA: tasteRules,
          userProviders: userWatchProviders,
          requireSelectedProviders: onlyMyProviders,
          limit: 20
        });
        setMergedPicks(ranked);
        setLocalVotesA({});
        setLocalVotesB({});
      } finally {
        setIsComputing(false);
      }
    },
    [cloudUser?.id, computeHostScoreMap, onlyMyProviders, tasteRules, userRegion, userWatchProviders, watched]
  );

  useEffect(() => {
    if (initialPartner && !activeCode) {
      runDirectPartnerMerge(initialPartner);
    }
  }, [initialPartner, activeCode, runDirectPartnerMerge]);

  // Load and poll active room when visiting /together/:code
  useEffect(() => {
    if (!activeCode) return undefined;
    let active = true;

    const loadRoom = async (initial = false) => {
      if (initial) setRoomState((prev) => ({ ...prev, loading: true, error: "" }));
      const res = await fetchWatchSession(activeCode);
      if (!active) return;
      setRoomState({
        loading: false,
        status: res.status,
        session: res.session || null,
        error: res.error || ""
      });
      if (res.session?.host_user_id && cloudUser?.id && res.session.host_user_id === cloudUser.id) {
        setLocalRoomRole("host");
      }
    };

    loadRoom(true);
    const interval = setInterval(() => loadRoom(false), 3500);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [activeCode, cloudUser?.id]);

  const handleCreateRoom = async () => {
    setRoomBusy(true);
    try {
      const hostRes = await computeHostScoreMap(null, watched);
      const candidates = await buildPersonalizedTogetherPool({
        scoresA: hostRes.scoreMap,
        scoresB: hostRes.scoreMap,
        watchedA: watched,
        watchedB: [],
        region: userRegion
      });
      const initialDeck = rankWatchTogetherCandidates({
        candidates,
        scoresA: hostRes.scoreMap,
        scoresB: hostRes.scoreMap,
        watchedA: watched,
        tasteRulesA: tasteRules,
        userProviders: userWatchProviders,
        requireSelectedProviders: onlyMyProviders,
        limit: 15
      });

      const hostWatchedIds = watched
        .map((m) => Number(m?.tmdbId ?? m?.id))
        .filter((n) => Number.isSafeInteger(n) && n > 0)
        .slice(0, 1500);

      const avoidRules = (tasteRules || []).filter((r) => r?.active !== false && r?.polarity === "avoid");
      const hostLabel = cloudProfile?.displayName || cloudUser?.email?.split("@")[0] || "Host";

      const res = await createWatchSession({
        hostName: hostLabel,
        hostVector: hostRes.hostVec64,
        hostWatchedIds,
        hostAvoidRules: avoidRules,
        deckItems: initialDeck,
        region: userRegion === "GLOBAL" ? "US" : userRegion,
        providerIds: userWatchProviders
      });

      if (!res.ok || !res.session?.room_code) {
        setRoomState({
          loading: false,
          status: res.status || "error",
          session: null,
          error: res.error || "Could not create Movie Night room."
        });
        return;
      }

      setLocalRoomRole("host");
      setRoomState({ loading: false, status: "ok", session: res.session, error: "" });
      navigate(`/together/${res.session.room_code}`);
    } finally {
      setRoomBusy(false);
    }
  };

  const handleJoinRoom = async ({ useLocalVault = false } = {}) => {
    if (!roomState.session) return;
    setRoomBusy(true);
    try {
      const embIdx = await loadDefaultEmbeddingIndex().catch(() => null);
      const guestWatched = useLocalVault
        ? watched
        : CORE_TASTE_DECK.filter((m) => guestQuickPickIds.has(m.tmdbId)).map((m) => ({
            ...m,
            userRating: 9
          }));

      const guestVector = embIdx ? computeProfileTasteVector(guestWatched, embIdx) : null;
      const roomRegion = roomState.session.region || "US";
      const allScoresA = buildPartnerScoreMapFromVector(roomState.session.host_vector, embIdx, []);
      const allScoresB = buildPartnerScoreMapFromVector(guestVector, embIdx, []);
      const candidates = await buildPersonalizedTogetherPool({
        scoresA: allScoresA,
        scoresB: allScoresB,
        watchedA: roomState.session.host_watched_ids || [],
        watchedB: guestWatched,
        region: roomRegion
      });
      const candIds = candidates.map((c) => c.tmdbId).filter(Boolean);

      const scoresA = buildPartnerScoreMapFromVector(roomState.session.host_vector, embIdx, candIds);
      const scoresB = buildPartnerScoreMapFromVector(guestVector, embIdx, candIds);

      const mergedDeck = rankWatchTogetherCandidates({
        candidates,
        scoresA,
        scoresB,
        watchedA: roomState.session.host_watched_ids || [],
        watchedB: guestWatched,
        tasteRulesA: roomState.session.host_avoid_rules || [],
        tasteRulesB: useLocalVault ? tasteRules : [],
        userProviders: roomState.session.provider_ids || [],
        limit: 15
      });

      const guestWatchedIds = guestWatched
        .map((m) => Number(m?.tmdbId ?? m?.id))
        .filter((n) => Number.isSafeInteger(n) && n > 0)
        .slice(0, 1500);

      const res = await joinWatchSession({
        roomCode: roomState.session.room_code,
        guestName: guestName.trim() || "Partner",
        guestVector,
        guestWatchedIds,
        guestAvoidRules: useLocalVault ? (tasteRules || []).filter((r) => r?.polarity === "avoid") : [],
        deckItems: mergedDeck.length > 0 ? mergedDeck : roomState.session.deck_items
      });

      if (res.ok && res.session) {
        setLocalRoomRole("guest");
        setRoomState({ loading: false, status: "ok", session: res.session, error: "" });
      }
    } finally {
      setRoomBusy(false);
    }
  };

  const handleRoomVote = async (tmdbId, vote) => {
    if (!roomState.session?.room_code) return;
    setRoomBusy(true);
    try {
      const res = await submitWatchVote({
        roomCode: roomState.session.room_code,
        role: localRoomRole,
        tmdbId,
        vote
      });
      if (res.ok && res.session) {
        setRoomState((prev) => ({ ...prev, session: res.session }));
      }
    } finally {
      setRoomBusy(false);
    }
  };

  const copyShareUrl = () => {
    if (!roomState.session?.room_code || typeof window === "undefined") return;
    const url = `${window.location.origin}/together/${roomState.session.room_code}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2200);
  };

  const toggleQuickPick = (tmdbId) => {
    setGuestQuickPickIds((prev) => {
      const next = new Set(prev);
      if (next.has(tmdbId)) next.delete(tmdbId);
      else next.add(tmdbId);
      return next;
    });
  };

  const partnerJoined = Boolean(roomState.session?.guest_name);

  return (
    <div className="together-page">
      <div className="page-rail">
        <header className="together-hero">
          <div className="together-hero-copy">
            <span className="together-kicker">
              <HeartHandshake size={14} aria-hidden="true" />
              <span>Two-Player Taste Merge</span>
            </span>
            <h1 className="together-title">Watch Together</h1>
            <p className="together-sub">
              Blend two taste profiles into a single Nash-balanced shortlist—hiding anything either of
              you has seen or wants to avoid.
            </p>
          </div>

          {!activeCode && (
            <div className="together-hero-actions">
              <Button
                variant="accent"
                icon={Link2}
                disabled={roomBusy}
                onClick={handleCreateRoom}
              >
                {roomBusy ? "Creating Room..." : "Create Movie Night Link"}
              </Button>
            </div>
          )}
        </header>

        {activeCode ? (
          <section className="together-room-shell">
            {roomState.loading ? (
              <div className="together-empty-card">
                <Loader2 size={24} className="spin-icon" aria-hidden="true" />
                <h3>Loading Movie Night room {activeCode}...</h3>
              </div>
            ) : roomState.status === "expired" || roomState.status === "not_found" ? (
              <div className="together-empty-card">
                <Sparkles size={26} aria-hidden="true" />
                <h3>
                  {roomState.status === "expired"
                    ? "This Movie Night room has expired"
                    : "Room not found"}
                </h3>
                <p>Rooms stay active for 48 hours. Spin up a fresh room in one click.</p>
                <div className="mt-[1.4rem] flex gap-[1rem] justify-center">
                  <Button variant="accent" onClick={handleCreateRoom} disabled={roomBusy}>
                    Create a New Movie Night Room
                  </Button>
                  <Button variant="secondary" onClick={() => navigate("/together")}>
                    Back to Watch Together
                  </Button>
                </div>
              </div>
            ) : roomState.status === "unconfigured" || !roomState.session ? (
              <div className="together-empty-card">
                <h3>Cloud Rooms Unavailable</h3>
                <p>{roomState.error || "Supabase configuration is required for shareable rooms."}</p>
                <Button variant="secondary" onClick={() => navigate("/together")}>
                  Back to Watch Together
                </Button>
              </div>
            ) : (
              <>
                <div className="together-room-banner">
                  <div>
                    <span className="together-room-code tabular-num">Room {roomState.session.room_code}</span>
                    <p className="together-sub m-0">
                      Host: <strong>{roomState.session.host_name}</strong> · Partner:{" "}
                      <strong>{roomState.session.guest_name || "Waiting to join..."}</strong>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-[0.8rem] items-center">
                    <Button variant="secondary" size="sm" icon={copiedLink ? Check : Copy} onClick={copyShareUrl}>
                      {copiedLink ? "Link Copied" : "Copy Invite Link"}
                    </Button>
                    <div className="together-role-toggle" role="group" aria-label="Active player view">
                      <button
                        type="button"
                        className={localRoomRole === "host" ? "is-active" : ""}
                        onClick={() => setLocalRoomRole("host")}
                      >
                        Host ({roomState.session.host_name})
                      </button>
                      <button
                        type="button"
                        className={localRoomRole === "guest" ? "is-active" : ""}
                        onClick={() => setLocalRoomRole("guest")}
                      >
                        Partner
                      </button>
                    </div>
                  </div>
                </div>

                {!partnerJoined && localRoomRole === "guest" ? (
                  <div className="together-join-panel">
                    <h2>Join {roomState.session.host_name}&apos;s Movie Night</h2>
                    <p className="together-sub">
                      Tap at least 5 films you love (or connect your local CinemaVault library) to blend your taste into the deck.
                    </p>

                    <div className="together-join-form">
                      <input
                        type="text"
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                        placeholder="Your name"
                        aria-label="Partner name"
                        className="together-input"
                      />
                      {watched.length >= 3 && (
                        <Button
                          variant="secondary"
                          disabled={roomBusy}
                          onClick={() => handleJoinRoom({ useLocalVault: true })}
                        >
                          Use My CinemaVault ({watched.length} films)
                        </Button>
                      )}
                      <Button
                        variant="accent"
                        disabled={roomBusy || guestQuickPickIds.size < 5}
                        onClick={() => handleJoinRoom({ useLocalVault: false })}
                      >
                        Join &amp; Blend ({guestQuickPickIds.size}/5+)
                      </Button>
                    </div>

                    <div className="together-quickpick-grid">
                      {CORE_TASTE_DECK.slice(0, 18).map((film) => {
                        const selected = guestQuickPickIds.has(film.tmdbId);
                        return (
                          <button
                            key={film.tmdbId}
                            type="button"
                            className={`together-quickpick-tile ${selected ? "is-selected" : ""}`}
                            onClick={() => toggleQuickPick(film.tmdbId)}
                            aria-pressed={selected}
                          >
                            <div className="together-quickpick-poster">
                              <PosterImage src={film.poster} title={film.title} />
                              {selected && (
                                <span className="together-quickpick-check">
                                  <Check size={14} aria-hidden="true" />
                                </span>
                              )}
                            </div>
                            <span>{film.title}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <WatchTogetherSwipeDeck
                    deck={roomState.session.deck_items || []}
                    role={localRoomRole}
                    hostName={roomState.session.host_name || "Host"}
                    guestName={roomState.session.guest_name || "Partner"}
                    hostVotes={roomState.session.host_votes || {}}
                    guestVotes={roomState.session.guest_votes || {}}
                    onVote={handleRoomVote}
                    busy={roomBusy}
                  />
                )}
              </>
            )}
          </section>
        ) : (
          <>
            <form
              className="together-pair-form"
              onSubmit={(e) => {
                e.preventDefault();
                runDirectPartnerMerge(partnerInput);
              }}
            >
              <div className="together-pair-input-wrap">
                <Users size={16} aria-hidden="true" />
                <input
                  type="text"
                  value={partnerInput}
                  onChange={(e) => setPartnerInput(e.target.value)}
                  placeholder="Enter a friend's @username (e.g. cinephile)"
                  aria-label="Partner CinemaVault username"
                  className="together-input"
                />
              </div>
              <Button type="submit" variant="primary" disabled={partnerState.loading || !partnerInput.trim()}>
                {partnerState.loading || isComputing ? "Blending..." : "Blend Tastes"}
              </Button>
            </form>

            {userWatchProviders.length > 0 && (
              <label className="inline-flex items-center gap-2 text-[1.3rem] text-[#b6b6b2] mb-5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={onlyMyProviders}
                  onChange={(e) => setOnlyMyProviders(e.target.checked)}
                  className="w-[1.5rem] h-[1.5rem] accent-amber-400 cursor-pointer"
                />
                <span>Only on my selected streaming services ({userWatchProviders.length})</span>
              </label>
            )}

            {partnerState.error && (
              <div className="together-error-banner" role="alert">
                {partnerState.error}
              </div>
            )}

            {mergedPicks.length > 0 && partnerState.profile && (
              <section className="together-results-section">
                <div className="together-results-bar">
                  <div>
                    <h2>
                      Sweet Spot for You &amp; @{partnerState.profile.username}
                    </h2>
                    <p className="together-sub m-0">
                      Top {mergedPicks.length} unseen films ranked by joint compatibility
                    </p>
                  </div>

                  <div className="together-role-toggle" role="tablist" aria-label="Display mode">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={viewMode === "grid"}
                      className={viewMode === "grid" ? "is-active" : ""}
                      onClick={() => setViewMode("grid")}
                    >
                      Ranked Grid
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={viewMode === "swipe"}
                      className={viewMode === "swipe" ? "is-active" : ""}
                      onClick={() => setViewMode("swipe")}
                    >
                      Swipe Mode
                    </button>
                  </div>
                </div>

                {viewMode === "swipe" ? (
                  <WatchTogetherSwipeDeck
                    deck={mergedPicks.slice(0, 15)}
                    role="host"
                    hostName="You"
                    guestName={`@${partnerState.profile.username}`}
                    hostVotes={localVotesA}
                    guestVotes={localVotesB}
                    onVote={(id, vote) => {
                      setLocalVotesA((prev) => ({ ...prev, [id]: vote }));
                      setLocalVotesB((prev) => ({ ...prev, [id]: vote === "yes" ? "yes" : "no" }));
                    }}
                    onRestart={() => {
                      setLocalVotesA({});
                      setLocalVotesB({});
                    }}
                  />
                ) : (
                  <div className="together-picks-grid">
                    {mergedPicks.map((item) => (
                      <Link
                        key={item.tmdbId || item.title}
                        to={item.imdbID ? `/movie/${item.imdbID}` : `/movie/tmdb_${item.tmdbId}`}
                        className="together-pick-card"
                      >
                        <div className="together-pick-poster">
                          <PosterImage src={item.poster} title={item.title} />
                          <span className="together-pick-joint tabular-num">
                            {item.jointMatchPct}% Together
                          </span>
                        </div>
                        <div className="together-pick-info">
                          <strong>{item.title}</strong>
                          <span className="together-pick-meta">
                            {item.year || ""}
                            {item.balanceLabel ? ` · ${item.balanceLabel}` : ""}
                          </span>
                          <span className="together-pick-split tabular-num">
                            You {item.matchPctA}% · @{partnerState.profile.username} {item.matchPctB}%
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            )}

            {!partnerState.profile && !partnerState.loading && (
              <div className="together-empty-card">
                <Film size={28} aria-hidden="true" />
                <h3>Pick a @username or share a Movie Night link</h3>
                <p>
                  No account? Click <strong>Create Movie Night Link</strong> above and send the URL
                  to anyone on the couch.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
