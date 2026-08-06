import { useState } from "react";
import { useApp } from "../context/AppContext";
import MovieRecommendations from "../components/MovieRecommendations";
import AIChat from "../components/AIChat";
import { Sparkles, MessageSquare } from "lucide-react";

export default function AIPage() {
  const {
    watched,
    watchlist,
    addToWatchlist,
    aiRecommendations,
    setAiRecommendations,
    aiTasteProfile,
    setAiTasteProfile,
  } = useApp();

  const [aiSection, setAiSection] = useState("recs"); // 'recs' | 'chat'

  return (
    <div className={`ai-page-wrapper ${aiSection === "chat" ? "chat-mode" : ""}`}>
      {/* Ambient background glows */}
      <div className="ai-ambient-backdrop">
        <div className="ai-aura-cyan"></div>
        <div className="ai-aura-violet"></div>
      </div>

      <div className="ai-page-container">
        {/* ── Unified AI Hero Header Card (Matching Vault Architecture) ── */}
        <div className="ai-hero-card">
          <div className="ai-hero-top">
            <div className="oracle-orb-wrapper">
              <div className="oracle-orb-pulse"></div>
              <div className="oracle-orb">
                <Sparkles className="oracle-icon" size={24} />
              </div>
            </div>
            <div className="ai-hero-info">
              <div className="ai-hero-title-row">
                <h1 className="ai-page-title">AI Oracle</h1>
                <span className="ai-status-chip">
                  <span className="status-dot"></span>
                  {watched.length > 0
                    ? `Synced · ${watched.length} films analysed`
                    : "Ready to analyse"}
                </span>
              </div>
              <p className="ai-subtitle-text">
                {watched.length > 0
                  ? "Personalized cinematic intelligence powered by your rating history."
                  : "Rate movies to unlock recommendations tailored to your taste."}
              </p>
            </div>
          </div>

          {/* ── Segmented Control Sub-Tabs embedded in Hero Card ── */}
          <div className="ai-hero-bottom">
            <div className="ai-segmented-control">
              <button
                className={`ai-tab-pill ${aiSection === "recs" ? "active" : ""}`}
                onClick={() => setAiSection("recs")}
              >
                <Sparkles size={16} />
                <span>AI Picks</span>
              </button>
              <button
                className={`ai-tab-pill ${aiSection === "chat" ? "active" : ""}`}
                onClick={() => setAiSection("chat")}
              >
                <MessageSquare size={16} />
                <span>Chat with Oracle</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── Body ── */}
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
