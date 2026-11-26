import { Suspense, lazy, useState, useEffect } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { AppProvider, useApp } from "./context/AppContext";
import ErrorBoundary from "./components/ErrorBoundary";
import AnimatedBackground from "./components/AnimatedBackground";
import NavBar from "./components/NavBar";
import CompareDock from "./components/CompareDock";
import BackgroundJobBanner from "./components/BackgroundJobBanner";
import RouteFallback from "./components/RouteFallback";
import DashboardPage from "./pages/DashboardPage";
import NotFoundPage from "./pages/NotFoundPage";

const SearchModal = lazy(() => import("./components/SearchModal"));
const RandomPicker = lazy(() => import("./components/RandomPicker"));
const BackupManagerModal = lazy(() => import("./components/BackupManagerModal"));
const QuickRateModal = lazy(() => import("./components/QuickRateModal"));
const TasteDeckModal = lazy(() => import("./components/TasteDeckModal"));
const CloudSyncModal = lazy(() => import("./components/CloudSyncModal"));
const CompareModal = lazy(() => import("./components/CompareModal"));

const loadExplorePage = () => import("./pages/ExplorePage");
const loadComparePage = () => import("./pages/ComparePage");
const loadMoviePage = () => import("./pages/MoviePage");
const loadPersonPage = () => import("./pages/PersonPage");
const loadVaultPage = () => import("./pages/VaultPage");
const loadAIPage = () => import("./pages/AIPage");
const loadAuthPage = () => import("./pages/AuthPage");
const loadAccountPage = () => import("./pages/AccountPage");
const loadPublicProfilePage = () => import("./pages/PublicProfilePage");
const loadPublicListPage = () => import("./pages/PublicListPage");
const loadWatchTogetherPage = () => import("./pages/WatchTogetherPage");
const loadCommunityPage = () => import("./pages/CommunityPage");

const ExplorePage = lazy(loadExplorePage);
const ComparePage = lazy(loadComparePage);
const MoviePage = lazy(loadMoviePage);
const PersonPage = lazy(loadPersonPage);
const VaultPage = lazy(loadVaultPage);
const AIPage = lazy(loadAIPage);
const AuthPage = lazy(loadAuthPage);
const AccountPage = lazy(loadAccountPage);
const PublicProfilePage = lazy(loadPublicProfilePage);
const PublicListPage = lazy(loadPublicListPage);
const WatchTogetherPage = lazy(loadWatchTogetherPage);
const CommunityPage = lazy(loadCommunityPage);

const PREFETCH_BY_PATH = {
  "/explore": loadExplorePage,
  "/vault": loadVaultPage,
  "/ai": loadAIPage,
  "/compare": loadComparePage,
  "/together": loadWatchTogetherPage,
  "/community": loadCommunityPage
};

function prefetchRoute(path) {
  const cleanPath = String(path || "").split("?")[0];
  const loader = PREFETCH_BY_PATH[cleanPath];
  if (loader) {
    loader().catch(() => {});
  }
}

import {
  TASTE_ONBOARDING_DISMISSED_KEY
} from "./services/tasteDeckService";
import { buildExploreRoute } from "./services/exploreService";
import { syncDebugFlagFromSearch } from "./services/debugFlags";
import { motion, MotionConfig, useScroll, useSpring } from "framer-motion";

/** Thin reading-progress line pinned above the navbar (disabled on mobile/reduced motion). */
function ScrollProgressBar() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 28, restDelta: 0.001 });
  return <motion.div className="scroll-progress" style={{ scaleX }} aria-hidden="true" />;
}

function ScrollProgress() {
  const [disabled, setDisabled] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(max-width: 900px), (prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mql = window.matchMedia("(max-width: 900px), (prefers-reduced-motion: reduce)");
    const sync = () => setDisabled(mql.matches);
    sync();
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", sync);
      return () => mql.removeEventListener("change", sync);
    }
    mql.addListener?.(sync);
    return () => mql.removeListener?.(sync);
  }, []);

  return disabled ? null : <ScrollProgressBar />;
}

function scrollToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  if (typeof document !== "undefined") {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }
}

function AppContent() {
  const {
    watched = [],
    watchlist = [],
    addWatched,
    addToWatchlist,
    hasCloudConfig,
    cloudUser,
    cloudSyncStatus,
    isPasswordRecovery,
    isVaultHydrated = true,
    isCompareOpen = false
  } = useApp();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isRandomPickerOpen, setIsRandomPickerOpen] = useState(false);
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [backupInitialTab, setBackupInitialTab] = useState("export");
  const [isTasteDeckOpen, setIsTasteDeckOpen] = useState(false);
  const [tasteDeckInitialMode, setTasteDeckInitialMode] = useState("flashcards");
  const [isCloudSyncOpen, setIsCloudSyncOpen] = useState(false);
  const [quickRateTarget, setQuickRateTarget] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    scrollToTop();
  }, [location.pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const warmTabs = () => {
      loadExplorePage().catch(() => {});
      loadVaultPage().catch(() => {});
      loadAIPage().catch(() => {});
    };
    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(warmTabs, { timeout: 2000 });
      return () => window.cancelIdleCallback?.(idleId);
    }
    const timerId = window.setTimeout(warmTabs, 1200);
    return () => window.clearTimeout(timerId);
  }, []);

  useEffect(() => {
    syncDebugFlagFromSearch({ search: location.search });
  }, [location.search]);

  useEffect(() => {
    if (isPasswordRecovery && location.pathname !== "/auth") {
      navigate("/auth?mode=reset", { replace: true });
    }
  }, [isPasswordRecovery, location.pathname, navigate]);

  useEffect(() => {
    function handleGlobalKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
        return;
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = String(document.activeElement?.tagName || "").toLowerCase();
        const isEditable =
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          document.activeElement?.isContentEditable;
        if (!isEditable) {
          e.preventDefault();
          setIsSearchOpen(true);
        }
      }
    }
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, []);

  function handleSelectMovie(id) {
    if (navigate) {
      navigate(`/movie/${id}`);
    } else {
      window.location.href = `/movie/${id}`;
    }
  }

  function handleExploreQuery(rawQuery) {
    const clean = String(rawQuery || "").trim();
    if (!clean) return;
    navigate(buildExploreRoute({ mode: "catalog", query: clean }));
  }

  function handleOpenBackup(tab = "export") {
    setBackupInitialTab(tab);
    setIsBackupOpen(true);
  }

  function handleOpenTasteDeck(mode = "flashcards") {
    setTasteDeckInitialMode(mode);
    setIsTasteDeckOpen(true);
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text-1 selection:bg-accent/20 selection:text-accent">
      <AnimatedBackground />
      <ScrollProgress />
      <NavBar
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenRandomPicker={() => setIsRandomPickerOpen(true)}
        onOpenBackup={() => handleOpenBackup("export")}
        onOpenTasteDeck={() => handleOpenTasteDeck("flashcards")}
        onOpenCloudSync={() => setIsCloudSyncOpen(true)}
        onPrefetchRoute={prefetchRoute}
        cloudUser={cloudUser}
        hasCloudConfig={hasCloudConfig}
        cloudSyncStatus={cloudSyncStatus}
      />

      <Suspense fallback={null}>
        {isSearchOpen && (
          <SearchModal
            isOpen={isSearchOpen}
            onClose={() => setIsSearchOpen(false)}
            onSelectMovie={handleSelectMovie}
            onQuickRate={(movie) => setQuickRateTarget(movie)}
            onExploreQuery={handleExploreQuery}
          />
        )}

        {isRandomPickerOpen && (
          <RandomPicker
            isOpen={isRandomPickerOpen}
            onClose={() => setIsRandomPickerOpen(false)}
            onSelectMovie={handleSelectMovie}
          />
        )}

        {isBackupOpen && (
          <BackupManagerModal
            isOpen={isBackupOpen}
            initialTab={backupInitialTab}
            onClose={() => setIsBackupOpen(false)}
          />
        )}

        {quickRateTarget && (
          <QuickRateModal
            movie={quickRateTarget}
            watched={watched}
            watchlist={watchlist}
            onClose={() => setQuickRateTarget(null)}
            onSaveWatched={addWatched}
            onAddToWatchlist={addToWatchlist}
          />
        )}

        {isTasteDeckOpen && (
          <TasteDeckModal
            isOpen={isTasteDeckOpen}
            initialMode={tasteDeckInitialMode}
            onClose={() => setIsTasteDeckOpen(false)}
            onDismissForever={() => {
              try {
                localStorage.setItem(TASTE_ONBOARDING_DISMISSED_KEY, "true");
              } catch {
                // ignore storage errors
              }
            }}
            onOpenImport={() => handleOpenBackup("import")}
          />
        )}

        {isCloudSyncOpen && (
          <CloudSyncModal
            isOpen={isCloudSyncOpen}
            onClose={() => setIsCloudSyncOpen(false)}
          />
        )}

        {isCompareOpen && <CompareModal onQuickRate={(m) => setQuickRateTarget(m)} />}
      </Suspense>

      <CompareDock />
      <BackgroundJobBanner />

      <main className="flex-1 w-full">
        <div key={location.pathname} className="cv-route-stage">
          <Suspense fallback={<RouteFallback />}>
            <Routes location={location}>
          <Route
            path="/"
            element={
              <DashboardPage
                onOpenSearch={() => setIsSearchOpen(true)}
                onOpenTasteDeck={() => handleOpenTasteDeck("flashcards")}
                onOpenImport={() => handleOpenBackup("import")}
              />
            }
          />
          <Route
            path="/explore"
            element={
              <ExplorePage
                onQuickRate={(m) => setQuickRateTarget(m)}
                onOpenTasteDeck={() => handleOpenTasteDeck("flashcards")}
              />
            }
          />
          <Route path="/compare" element={<ComparePage onQuickRate={(m) => setQuickRateTarget(m)} />} />
          <Route path="/movie/:id" element={<MoviePage onQuickRate={(m) => setQuickRateTarget(m)} />} />
          <Route path="/person/:id" element={<PersonPage onQuickRate={(m) => setQuickRateTarget(m)} />} />
          <Route
            path="/vault"
            element={
              <VaultPage
                onOpenBackup={(tab = "export") => handleOpenBackup(typeof tab === "string" ? tab : "export")}
                onOpenCloudSync={() => setIsCloudSyncOpen(true)}
              />
            }
          />
          <Route
            path="/ai"
            element={
              <AIPage
                onOpenTasteDeck={() => handleOpenTasteDeck("flashcards")}
                onOpenImport={() => handleOpenBackup("import")}
              />
            }
          />
          <Route path="/auth" element={<AuthPage defaultMode="signin" />} />
          <Route path="/login" element={<AuthPage defaultMode="signin" />} />
          <Route path="/signup" element={<AuthPage defaultMode="signup" />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/u/:username" element={<PublicProfilePage />} />
          <Route path="/list/:slug" element={<PublicListPage />} />
          <Route path="/together" element={<WatchTogetherPage />} />
          <Route path="/together/:code" element={<WatchTogetherPage />} />
          <Route path="/community" element={<CommunityPage />} />
          <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </div>
      </main>

      {/* Slim Editorial Footer */}
      <footer className="w-full border-t border-hairline bg-surface-1/30 pt-8 pb-28 min-[901px]:pb-8 mt-16">
        <div className="page-rail flex flex-col sm:flex-row items-center justify-between gap-4 text-[1.25rem] text-text-3">
          <div className="flex items-center gap-2.5">
            <span className="font-semibold text-text-2 tracking-tight">CinemaVault</span>
            <span aria-hidden="true">·</span>
            <span>Personal Film Log &amp; Recommendations</span>
          </div>

          <div className="flex items-center gap-3">
            <span>Data from TMDB, OMDb &amp; Gemini</span>
            <span className="hidden sm:inline" aria-hidden="true">·</span>
            <span className="text-text-2 font-medium">Built by Khuzaima</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <AppProvider>
          <AppContent />
        </AppProvider>
      </MotionConfig>
    </ErrorBoundary>
  );
}
