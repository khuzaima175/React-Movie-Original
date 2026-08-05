import { useState } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { AppProvider } from "./context/AppContext";
import ErrorBoundary from "./components/ErrorBoundary";
import AnimatedBackground from "./components/AnimatedBackground";
import NavBar from "./components/NavBar";
import SearchModal from "./components/SearchModal";
import DashboardPage from "./pages/DashboardPage";
import MoviePage from "./pages/MoviePage";
import VaultPage from "./pages/VaultPage";
import AIPage from "./pages/AIPage";

function AppContent() {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const navigate = useNavigate();

  function handleSelectMovie(id) {
    if (navigate) {
      navigate(`/movie/${id}`);
    } else {
      window.location.href = `/movie/${id}`;
    }
  }

  return (
    <>
      <AnimatedBackground />
      <NavBar onOpenSearch={() => setIsSearchOpen(true)} />
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectMovie={handleSelectMovie}
      />
      <Routes>
        <Route path="/" element={<DashboardPage onOpenSearch={() => setIsSearchOpen(true)} />} />
        <Route path="/movie/:id" element={<MoviePage />} />
        <Route path="/vault" element={<VaultPage />} />
        <Route path="/ai" element={<AIPage />} />
      </Routes>
    </>
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