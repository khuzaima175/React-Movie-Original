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
      {/* Ambient cinema glow */}
      <div className="ai-ambient-backdrop" aria-hidden="true">
        <div className="ai-aura-gold" />
        <div className="ai-aura-cyan" />
      </div>

      <div className="ai-page-container">
        {/* ── Tier 1: Open Spacious Hero Tier ── */}
        <div className="ai-studio-hero-tier">
          <div className="ai-hero-left">
            <div className="ai-title-row">
              <span className="live-ai-pulse" aria-hidden="true" />
              <h1 className="ai-spacious-title">AI Oracle</h1>
              <span className="ai-sync-pill">
                <span className="status-dot" aria-hidden="true" />
                {watched.length > 0
                  ? `Synced · ${watched.length} films analyzed`
                  : "Ready to analyze"}
              </span>
            </div>
            <p className="ai-spacious-meta">
              {watched.length > 0
                ? "Autonomous cinematic intelligence synthesized from your viewing history, director affinities, and ratings."
                : "Rate movies in your vault to unlock high-precision recommendations tailored to your taste."}
            </p>
          </div>

          {/* Sub-Tabs: AI Recommendations vs Cinema Companion Chat */}
          <div className="ai-tabs-cluster" role="tablist">
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
              <Sparkles size={15} className="tab-icon" aria-hidden="true" />
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
              <MessageSquare size={15} className="tab-icon" aria-hidden="true" />
              <span>Film Companion</span>
            </button>
          </div>
        </div>

        {/* ── Tier 2: Body (Recommendations or Chat) ── */}
        <div className="ai-page-body">
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
        </div>
      </div>
    </div>
  );
}
