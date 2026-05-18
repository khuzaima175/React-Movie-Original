import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppProvider } from "./context/AppContext";
import AnimatedBackground from "./components/AnimatedBackground";
import NavBar from "./components/NavBar";
import DashboardPage from "./pages/DashboardPage";
import MoviePage from "./pages/MoviePage";
import VaultPage from "./pages/VaultPage";
import AIPage from "./pages/AIPage";

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <AnimatedBackground />
        <NavBar />
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/movie/:id" element={<MoviePage />} />
          <Route path="/vault" element={<VaultPage />} />
          <Route path="/ai" element={<AIPage />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}