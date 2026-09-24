import { useState } from "react";
import { useApp } from "../context/AppContext";
import MovieRecommendations from "../components/MovieRecommendations";
import AIChat from "../components/AIChat";
import { Sparkles, MessageSquare } from "lucide-react";
import { motion } from "framer-motion";

export default function AIPage() {
  const {
    watched = [],
    watchlist = [],
    addToWatchlist,
    aiRecommendations,
    setAiRecommendations,
    aiTasteProfile,
    setAiTasteProfile,
  } = useApp();

  const [aiSection, setAiSection] = useState("recs"); // 'recs' | 'chat'

  return (
    <div className={`ai-page-wrapper ${aiSection === "chat" ? "chat-mode" : ""}`}>
      {/* Ambient cinematic glow */}
      <div className="ai-ambient-backdrop" aria-hidden="true">
        <div className="ai-aura-gold" />
        <div className="ai-aura-cyan" />
      </div>

      <div className="ai-page-container">
        {/* ── Sleek Cinema Studio Header ── */}
        <header className="ai-studio-header">
          <div className="ai-studio-brand">
            <div className="ai-brand-headline">
              <span className="live-ai-pulse" aria-hidden="true" />
              <h1 className="ai-studio-title">AI Oracle</h1>
              <span className="ai-sync-pill">
                <span className="status-dot" aria-hidden="true" />
                {watched.length > 0
                  ? `${watched.length} Films Synced`
                  : "Syncing Ready"}
              </span>
            </div>
            <p className="ai-studio-desc">
              Cinematic intelligence trained on your personal vault affinities and ratings.
            </p>
          </div>

          {/* Sub-Tabs: AI Recommendations vs Cinema Companion Chat */}
          <nav className="ai-tabs-cluster" role="tablist" aria-label="AI Oracle Modes">
            <button
              role="tab"
              aria-selected={aiSection === "recs"}
              className={`ai-spacious-tab-pill ${aiSection === "recs" ? "active" : ""}`}
              onClick={() => setAiSection("recs")}
            >
              {aiSection === "recs" && (
                <motion.div
                  layoutId="aiTabHighlight"
                  className="ai-tab-highlight"
                  transition={{ type: "spring", stiffness: 450, damping: 32 }}
                />
              )}
              <Sparkles size={14} className="tab-icon" aria-hidden="true" />
              <span>AI Picks</span>
            </button>

            <button
              role="tab"
              aria-selected={aiSection === "chat"}
              className={`ai-spacious-tab-pill ${aiSection === "chat" ? "active" : ""}`}
              onClick={() => setAiSection("chat")}
            >
              {aiSection === "chat" && (
                <motion.div
                  layoutId="aiTabHighlight"
                  className="ai-tab-highlight"
                  transition={{ type: "spring", stiffness: 450, damping: 32 }}
                />
              )}
              <MessageSquare size={14} className="tab-icon" aria-hidden="true" />
              <span>Film Companion</span>
            </button>
          </nav>
        </header>

        {/* ── Body (Recommendations or Chat) ── */}
        <main className="ai-page-body">
          {aiSection === "recs" && (
            <MovieRecommendations
              watched={watched}
              onAddToWatchlist={addToWatchlist}
              watchlist={watchlist}
              recommendations={aiRecommendations}
              setRecommendations={setAiRecommendations}
              tasteProfile={aiTasteProfile}
              setTasteProfile={setAiTasteProfile}
            />
          )}

          {aiSection === "chat" && <AIChat watched={watched} />}
        </main>
      </div>
    </div>
  );
}

