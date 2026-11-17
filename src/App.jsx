import { useState, useEffect, useRef } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { AppProvider, useApp } from "./context/AppContext";
import ErrorBoundary from "./components/ErrorBoundary";
import AnimatedBackground from "./components/AnimatedBackground";
import NavBar from "./components/NavBar";
import SearchModal from "./components/SearchModal";
import RandomPicker from "./components/RandomPicker";
import BackupManagerModal from "./components/BackupManagerModal";
import QuickRateModal from "./components/QuickRateModal";
import TasteDeckModal from "./components/TasteDeckModal";
import CloudSyncModal from "./components/CloudSyncModal";
import CompareDock from "./components/CompareDock";
import CompareModal from "./components/CompareModal";
import DashboardPage from "./pages/DashboardPage";
import ExplorePage from "./pages/ExplorePage";
import ComparePage from "./pages/ComparePage";
import MoviePage from "./pages/MoviePage";
import PersonPage from "./pages/PersonPage";
import VaultPage from "./pages/VaultPage";
import AIPage from "./pages/AIPage";
import NotFoundPage from "./pages/NotFoundPage";
import {
  shouldAutoShowTasteOnboarding,
  TASTE_ONBOARDING_DISMISSED_KEY
} from "./services/tasteDeckService";
import { motion, AnimatePresence, MotionConfig, useScroll, useSpring } from "framer-motion";
import { pageTransition } from "./motion";

/** Thin reading-progress line pinned above the navbar. */
function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 28, restDelta: 0.001 });
  return <motion.div className="scroll-progress" style={{ scaleX }} aria-hidden="true" />;
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
    cloudSyncStatus
  } = useApp();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isRandomPickerOpen, setIsRandomPickerOpen] = useState(false);
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [backupInitialTab, setBackupInitialTab] = useState("export");
  const [isTasteDeckOpen, setIsTasteDeckOpen] = useState(false);
  const [tasteDeckInitialMode, setTasteDeckInitialMode] = useState("flashcards");
  const [isCloudSyncOpen, setIsCloudSyncOpen] = useState(false);
  const [quickRateTarget, setQuickRateTarget] = useState(null);
  const didCheckOnboardingRef = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (didCheckOnboardingRef.current) return;
    didCheckOnboardingRef.current = true;
    try {
      const dismissedFlag = localStorage.getItem(TASTE_ONBOARDING_DISMISSED_KEY);
      if (shouldAutoShowTasteOnboarding({ watchedCount: watched.length, dismissedFlag })) {
        setTasteDeckInitialMode("grid");
        setIsTasteDeckOpen(true);
      }
    } catch {
      // ignore storage availability errors
    }
  }, [watched.length]);

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
        cloudUser={cloudUser}
        hasCloudConfig={hasCloudConfig}
        cloudSyncStatus={cloudSyncStatus}
      />

      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectMovie={handleSelectMovie}
        onQuickRate={(movie) => setQuickRateTarget(movie)}
      />

      <RandomPicker
        isOpen={isRandomPickerOpen}
        onClose={() => setIsRandomPickerOpen(false)}
        onSelectMovie={handleSelectMovie}
      />

      <BackupManagerModal
        isOpen={isBackupOpen}
        initialTab={backupInitialTab}
        onClose={() => setIsBackupOpen(false)}
      />

      <QuickRateModal
        movie={quickRateTarget}
        watched={watched}
        watchlist={watchlist}
        onClose={() => setQuickRateTarget(null)}
        onSaveWatched={addWatched}
        onAddToWatchlist={addToWatchlist}
      />

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

      <CloudSyncModal
        isOpen={isCloudSyncOpen}
        onClose={() => setIsCloudSyncOpen(false)}
      />

      <CompareDock />
      <CompareModal onQuickRate={(m) => setQuickRateTarget(m)} />

      <main className="flex-1 w-full">
        <AnimatePresence mode="wait" onExitComplete={scrollToTop}>
          <motion.div
            key={location.pathname}
            variants={pageTransition}
            initial="initial"
            animate="animate"
            exit="exit"
          >
        <Routes location={location}>
          <Route
            path="/"
            element={
              <DashboardPage
                onOpenSearch={() => setIsSearchOpen(true)}
                onOpenTasteDeck={() => handleOpenTasteDeck("flashcards")}
              />
            }
          />
          <Route path="/explore" element={<ExplorePage onQuickRate={(m) => setQuickRateTarget(m)} />} />
          <Route path="/compare" element={<ComparePage onQuickRate={(m) => setQuickRateTarget(m)} />} />
          <Route path="/movie/:id" element={<MoviePage onQuickRate={(m) => setQuickRateTarget(m)} />} />
          <Route path="/person/:id" element={<PersonPage onQuickRate={(m) => setQuickRateTarget(m)} />} />
          <Route
            path="/vault"
            element={
              <VaultPage
                onOpenBackup={() => handleOpenBackup("export")}
                onOpenCloudSync={() => setIsCloudSyncOpen(true)}
              />
            }
          />
          <Route path="/ai" element={<AIPage onOpenTasteDeck={() => handleOpenTasteDeck("flashcards")} />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Slim Editorial Footer */}
      <footer className="w-full border-t border-hairline bg-surface-1/30 pt-8 pb-28 md:pb-8 mt-16">
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
