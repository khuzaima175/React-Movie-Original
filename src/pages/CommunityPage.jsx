import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Bookmark,
  Check,
  Eye,
  Heart,
  ListChecks,
  Loader2,
  Search,
  Sparkles,
  Star,
  UserPlus,
  Users
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import {
  computeProfileTasteVector,
  fetchCommunityDirectory,
  fetchFriendsActivityFeed,
  toggleFollowUser
} from "../services/communityService";
import { fetchPublicListsDirectory } from "../services/publicListsService";
import { loadDefaultEmbeddingIndex } from "../services/embeddingService";
import PosterImage from "../components/PosterImage";
import { Button, Tabs } from "../components/ui";
import "../styles/community.css";

function movieTargetPath(item) {
  if (item?.imdb_id && /^tt\d+$/i.test(item.imdb_id)) return `/movie/${item.imdb_id}`;
  if (item?.tmdb_id) return `/movie/tmdb_${item.tmdb_id}`;
  return null;
}

export default function CommunityPage() {
  useDocumentTitle("Community");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { cloudUser = null, watched = [], hasCloudConfig = false } = useApp();

  const initialTab = searchParams.get("tab");
  const hasExplicitTab = initialTab === "lists" || initialTab === "twins" || initialTab === "feed";
  const userPickedTabRef = useRef(hasExplicitTab);
  const [activeTab, setActiveTab] = useState(
    hasExplicitTab ? initialTab : cloudUser ? "feed" : "twins"
  );

  const [viewerVector, setViewerVector] = useState(null);
  const [feedState, setFeedState] = useState({ loading: false, items: [], status: "idle", error: "" });
  const [listsState, setListsState] = useState({ loading: false, lists: [], sort: "popular", error: "" });
  const [membersState, setMembersState] = useState({ loading: false, profiles: [], error: "" });
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [revealedSpoilers, setRevealedSpoilers] = useState(() => new Set());
  const [followingMap, setFollowingMap] = useState(() => ({}));

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!userPickedTabRef.current && cloudUser?.id && activeTab !== "feed") {
      setActiveTab("feed");
    }
  }, [cloudUser?.id, activeTab]);

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
    if (activeTab !== "feed") return undefined;
    if (!hasCloudConfig || !cloudUser?.id) {
      setFeedState({ loading: false, items: [], status: "signed_out", error: "" });
      return undefined;
    }
    let active = true;
    setFeedState((prev) => ({ ...prev, loading: true, error: "" }));
    fetchFriendsActivityFeed(cloudUser.id, { limit: 35 })
      .then((res) => {
        if (!active) return;
        const isErr = res?.status === "error";
        setFeedState({
          loading: false,
          items: res?.items || [],
          status: res?.status || "ok",
          error: isErr ? "Unable to load Following Feed right now. Please try again shortly." : ""
        });
        if (Array.isArray(res?.followingIds)) {
          const seeded = {};
          for (const id of res.followingIds) {
            seeded[id] = true;
          }
          setFollowingMap(seeded);
        }
      })
      .catch(() => {
        if (!active) return;
        setFeedState({ loading: false, items: [], status: "error", error: "Unable to load Following Feed right now." });
      });
    return () => {
      active = false;
    };
  }, [activeTab, hasCloudConfig, cloudUser?.id]);

  useEffect(() => {
    if (activeTab !== "lists") return undefined;
    if (!hasCloudConfig) {
      setListsState((prev) => ({ ...prev, loading: false, lists: [], error: "" }));
      return undefined;
    }
    let active = true;
    setListsState((prev) => ({ ...prev, loading: true, error: "" }));
    fetchPublicListsDirectory({ query: debouncedSearch, sort: listsState.sort, limit: 24 })
      .then((res) => {
        if (!active) return;
        const isErr = res?.status === "error";
        setListsState((prev) => ({
          ...prev,
          loading: false,
          lists: res?.lists || [],
          error: isErr ? "Unable to load public lists right now. Please try again shortly." : ""
        }));
      })
      .catch(() => {
        if (!active) return;
        setListsState((prev) => ({ ...prev, loading: false, lists: [], error: "Unable to load public lists right now." }));
      });
    return () => {
      active = false;
    };
  }, [activeTab, hasCloudConfig, debouncedSearch, listsState.sort]);

  useEffect(() => {
    if (activeTab !== "twins") return undefined;
    if (!hasCloudConfig) {
      setMembersState({ loading: false, profiles: [], error: "" });
      return undefined;
    }
    let active = true;
    setMembersState((prev) => ({ ...prev, loading: true, error: "" }));
    fetchCommunityDirectory({ query: debouncedSearch, viewerVector, limit: 24 })
      .then((res) => {
        if (!active) return;
        const isErr = res?.status === "error";
        setMembersState({
          loading: false,
          profiles: res?.profiles || [],
          error: isErr ? "Unable to load Taste Twins directory right now. Please try again shortly." : ""
        });
      })
      .catch(() => {
        if (!active) return;
        setMembersState({ loading: false, profiles: [], error: "Unable to load Taste Twins directory right now." });
      });
    return () => {
      active = false;
    };
  }, [activeTab, hasCloudConfig, debouncedSearch, viewerVector]);

  function handleTabChange(nextTab) {
    userPickedTabRef.current = true;
    setActiveTab(nextTab);
    setSearchParams({ tab: nextTab }, { replace: true });
  }

  async function handleFollowToggle(targetUserId) {
    if (!cloudUser?.id) {
      navigate("/auth", { state: { from: "/community" } });
      return;
    }
    const current = Boolean(followingMap[targetUserId]);
    const res = await toggleFollowUser({
      followerId: cloudUser.id,
      followingId: targetUserId,
      currentlyFollowing: current
    });
    if (res.ok) {
      setFollowingMap((prev) => ({ ...prev, [targetUserId]: res.isFollowing }));
    }
  }

  const visibleMembers = useMemo(
    () => membersState.profiles.filter((p) => !cloudUser?.id || p.user_id !== cloudUser.id),
    [membersState.profiles, cloudUser?.id]
  );

  return (
    <div className="public-profile-shell">
      <div className="page-rail">
        <header className="community-hub-header">
          <div>
            <span className="public-profile-kicker">
              <Users size={13} aria-hidden="true" />
              <span>CinemaVault Community</span>
            </span>
            <h1 className="public-profile-name mt-2">Friends, Lists &amp; Taste Twins</h1>
            <p className="public-profile-bio">
              Follow film lovers who share your 64-D taste wavelength, browse curated public lists, and see what friends watched tonight.
            </p>
          </div>
          {cloudUser && (
            <Button variant="secondary" onClick={() => navigate("/account")}>
              My Public Profile
            </Button>
          )}
        </header>

        <div className="community-hub-toolbar">
          <Tabs
            tabs={[
              { id: "feed", label: "Following Feed", icon: Users },
              { id: "lists", label: "Public Lists", icon: ListChecks },
              { id: "twins", label: "Taste Twins", icon: Sparkles }
            ]}
            activeTab={activeTab}
            onChange={handleTabChange}
          />

          {activeTab !== "feed" && (
            <div className="community-hub-search-row">
              <div className="spacious-search-box">
                <Search size={14} className="search-icon-muted" aria-hidden="true" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={activeTab === "lists" ? "Search public lists..." : "Search @handles..."}
                  className="spacious-search-input"
                  aria-label="Search community"
                />
              </div>
              {activeTab === "lists" && (
                <div className="together-role-toggle" role="group" aria-label="Sort lists">
                  <button
                    type="button"
                    className={listsState.sort === "popular" ? "is-active" : ""}
                    onClick={() => setListsState((p) => ({ ...p, sort: "popular" }))}
                  >
                    Popular
                  </button>
                  <button
                    type="button"
                    className={listsState.sort === "recent" ? "is-active" : ""}
                    onClick={() => setListsState((p) => ({ ...p, sort: "recent" }))}
                  >
                    Recent
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {!hasCloudConfig ? (
          <div className="together-empty-card">
            <Users size={26} aria-hidden="true" />
            <h3>Community requires cloud configuration</h3>
            <p>Configure Supabase environment keys to enable public profiles, shared lists, and activity feeds.</p>
          </div>
        ) : activeTab === "feed" ? (
          !cloudUser ? (
            <div className="together-empty-card">
              <Users size={26} aria-hidden="true" />
              <h3>Sign in to follow Taste Twins</h3>
              <p>Sign in to follow curators and see their latest ratings and spoiler-safe reviews here.</p>
              <div className="flex flex-wrap gap-3 justify-center mt-4">
                <Button variant="accent" onClick={() => navigate("/auth", { state: { from: "/community" } })}>
                  Sign In
                </Button>
                <Button variant="secondary" onClick={() => handleTabChange("twins")}>
                  Browse Taste Twins
                </Button>
              </div>
            </div>
          ) : feedState.loading ? (
            <div className="flex items-center justify-center gap-3 py-16 text-[1.4rem] text-[#9e9e99]">
              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
              <span>Loading your feed...</span>
            </div>
          ) : feedState.error ? (
            <div className="together-empty-card">
              <Users size={26} aria-hidden="true" />
              <h3>Could not load Following Feed</h3>
              <p>{feedState.error}</p>
            </div>
          ) : feedState.items.length === 0 ? (
            <div className="together-empty-card">
              <Sparkles size={26} aria-hidden="true" />
              <h3>Your Following Feed is quiet</h3>
              <p>Follow a few members from the Taste Twins directory to see their latest watches and reviews.</p>
              <Button variant="accent" className="mt-4" onClick={() => handleTabChange("twins")}>
                Discover Taste Twins
              </Button>
            </div>
          ) : (
            <div className="public-diary-list">
              {feedState.items.map((item) => {
                const path = movieTargetPath(item);
                const note = String(item.user_note || "").trim();
                const isSpoilerHidden = Boolean(item.contains_spoilers) && !revealedSpoilers.has(item.id);
                return (
                  <article key={item.id} className="community-review-card flex gap-4">
                    {path && (
                      <Link to={path} className="w-[6rem] shrink-0 rounded-[0.6rem] overflow-hidden block">
                        <PosterImage src={item.poster} title={item.title} />
                      </Link>
                    )}
                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                      <div className="community-review-head">
                        <div className="min-w-0">
                          <Link to={`/u/${item.username}`} className="text-[1.25rem] text-emerald-300 font-semibold no-underline hover:underline">
                            @{item.username}
                          </Link>
                          <div className="mt-0.5">
                            {path ? (
                              <Link to={path} className="community-review-author">
                                {item.title} {item.year ? `(${item.year})` : ""}
                              </Link>
                            ) : (
                              <span className="community-review-author">{item.title}</span>
                            )}
                          </div>
                        </div>
                        <span className="community-review-score tabular-num shrink-0">
                          <Star size={12} fill="currentColor" aria-hidden="true" />
                          {item.user_rating}/10
                        </span>
                      </div>

                      {note &&
                        (isSpoilerHidden ? (
                          <div className="community-spoiler-box">
                            <p className="community-review-note community-spoiler-blur" aria-hidden="true">{note}</p>
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
                        ))}

                      {Number(item.like_count) > 0 && (
                        <span className="inline-flex items-center gap-1.5 text-[1.15rem] text-[#9e9e99] tabular-num">
                          <Heart size={12} aria-hidden="true" />
                          {item.like_count}
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )
        ) : activeTab === "lists" ? (
          listsState.loading ? (
            <div className="flex items-center justify-center gap-3 py-16 text-[1.4rem] text-[#9e9e99]">
              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
              <span>Loading curated lists...</span>
            </div>
          ) : listsState.error ? (
            <div className="together-empty-card">
              <ListChecks size={26} aria-hidden="true" />
              <h3>Could not load public lists</h3>
              <p>{listsState.error}</p>
            </div>
          ) : listsState.lists.length === 0 ? (
            <div className="together-empty-card">
              <ListChecks size={26} aria-hidden="true" />
              <h3>No matching public lists yet</h3>
              <p>Publish any custom list from your Vault to share it with the community.</p>
            </div>
          ) : (
            <div className="community-directory-grid">
              {listsState.lists.map((list) => (
                <Link
                  key={list.id}
                  to={`/list/${list.slug}`}
                  className="community-review-card no-underline text-inherit hover:border-white/25 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-[1.55rem] text-[#f4f4f2]">{list.name}</strong>
                    <span className="inline-flex items-center gap-1 text-[1.2rem] text-[#b6b6b2] tabular-num">
                      <Bookmark size={12} aria-hidden="true" />
                      {list.bookmark_count || 0}
                    </span>
                  </div>
                  {list.description && (
                    <p className="m-0 text-[1.3rem] text-[#9e9e99] line-clamp-2">{list.description}</p>
                  )}
                  <div className="flex items-center justify-between text-[1.2rem] text-[#8a8a86] pt-1">
                    <span>{list.items?.length || 0} films</span>
                    {list.curatorUsername && <span className="text-emerald-300">@{list.curatorUsername}</span>}
                  </div>
                </Link>
              ))}
            </div>
          )
        ) : membersState.loading ? (
          <div className="flex items-center justify-center gap-3 py-16 text-[1.4rem] text-[#9e9e99]">
            <Loader2 size={18} className="animate-spin" aria-hidden="true" />
            <span>Finding Taste Twins...</span>
          </div>
        ) : membersState.error ? (
          <div className="together-empty-card">
            <Users size={26} aria-hidden="true" />
            <h3>Could not load Taste Twins</h3>
            <p>{membersState.error}</p>
          </div>
        ) : visibleMembers.length === 0 ? (
          <div className="together-empty-card">
            <Users size={26} aria-hidden="true" />
            <h3>No public profiles match</h3>
            <p>Enable Public Profile in Account settings to appear in the Taste Twins directory.</p>
          </div>
        ) : (
          <div className="community-directory-grid">
            {visibleMembers.map((member) => {
              const isFollowing = Boolean(followingMap[member.user_id]);
              return (
                <article key={member.user_id} className="community-review-card">
                  <div className="community-review-head">
                    <Link to={`/u/${member.username}`} className="community-review-author">
                      {member.display_name || `@${member.username}`}
                      <span className="block text-[1.2rem] font-normal text-[#8f8f8a]">
                        @{member.username} · {member.watched_count || 0} films
                      </span>
                    </Link>
                    {member.tasteTwin && (
                      <span className="taste-twin-badge tabular-num">
                        <Sparkles size={12} aria-hidden="true" />
                        {member.tasteTwin.matchPct}% Match
                      </span>
                    )}
                  </div>
                  {member.bio && (
                    <p className="m-0 text-[1.3rem] text-[#b6b6b2] line-clamp-2">{member.bio}</p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button
                      variant={isFollowing ? "secondary" : "accent"}
                      size="sm"
                      icon={isFollowing ? Check : UserPlus}
                      onClick={() => handleFollowToggle(member.user_id)}
                    >
                      {isFollowing ? "Following" : "Follow"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate(`/together?partner=${encodeURIComponent(member.username)}`)}
                    >
                      Watch Together
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
