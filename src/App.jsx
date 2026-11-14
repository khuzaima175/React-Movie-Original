import { useState, useEffect, useRef } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
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
import DashboardPage from "./pages/DashboardPage";
import MoviePage from "./pages/MoviePage";
import VaultPage from "./pages/VaultPage";
import AIPage from "./pages/AIPage";
import {
  shouldAutoShowTasteOnboarding,
  TASTE_ONBOARDING_DISMISSED_KEY
} from "./services/tasteDeckService";
import { Film } from "lucide-react";

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

      <main className="flex-1 w-full">
        <Routes>
          <Route
            path="/"
            element={
              <DashboardPage
                onOpenSearch={() => setIsSearchOpen(true)}
                onOpenTasteDeck={() => handleOpenTasteDeck("flashcards")}
              />
            }
          />
          <Route path="/movie/:id" element={<MoviePage />} />
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Slim Editorial Footer */}
      <footer className="w-full border-t border-hairline bg-surface-1/40 py-6 mt-16 backdrop-blur-sm">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 md:px-12 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-text-3">
          <div className="flex items-center gap-2">
            <Film size={14} className="text-accent" aria-hidden="true" />
            <span className="font-semibold text-text-2 tracking-wide">CINEMAVAULT</span>
            <span className="text-hairline-strong">•</span>
            <span>Personal Film Log &amp; Recommendations</span>
          </div>

          <div className="flex items-center gap-4">
            <span>Data powered by <strong className="font-medium text-text-2">TMDB, OMDb API</strong> &amp; <strong className="font-medium text-text-2">Gemini AI</strong></span>
            <span className="hidden sm:inline text-hairline-strong">•</span>
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
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ErrorBoundary>
  );
}
