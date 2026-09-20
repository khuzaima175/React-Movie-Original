import { useState } from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AppProvider } from "./context/AppContext";
import ErrorBoundary from "./components/ErrorBoundary";
import AnimatedBackground from "./components/AnimatedBackground";
import NavBar from "./components/NavBar";
import SearchModal from "./components/SearchModal";
import DashboardPage from "./pages/DashboardPage";
import MoviePage from "./pages/MoviePage";
import VaultPage from "./pages/VaultPage";
import AIPage from "./pages/AIPage";
import { reveal } from "./motion";
import { Film } from "lucide-react";

function AppContent() {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  function handleSelectMovie(id) {
    if (navigate) {
      navigate(`/movie/${id}`);
    } else {
      window.location.href = `/movie/${id}`;
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text-1 selection:bg-accent/20 selection:text-accent">
      <AnimatedBackground />
      <NavBar onOpenSearch={() => setIsSearchOpen(true)} />

      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectMovie={handleSelectMovie}
      />

      <main className="flex-1 w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            variants={reveal}
            initial="initial"
            animate="animate"
            exit="exit"
            className="w-full"
          >
            <Routes location={location}>
              <Route path="/" element={<DashboardPage onOpenSearch={() => setIsSearchOpen(true)} />} />
              <Route path="/movie/:id" element={<MoviePage />} />
              <Route path="/vault" element={<VaultPage />} />
              <Route path="/ai" element={<AIPage />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Slim Editorial Footer */}
      <footer className="w-full border-t border-hairline bg-surface-1/40 py-6 mt-16 backdrop-blur-sm">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 md:px-12 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-text-3">
          <div className="flex items-center gap-2">
            <Film size={14} className="text-accent" aria-hidden="true" />
            <span className="font-semibold text-text-2 tracking-wide">CINEMAVAULT</span>
            <span className="text-hairline-strong">•</span>
            <span>Personal Film Vault & Taste Intelligence</span>
          </div>

          <div className="flex items-center gap-4">
            <span>Data powered by <strong className="font-medium text-text-2">OMDb API</strong> & <strong className="font-medium text-text-2">Gemini AI</strong></span>
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