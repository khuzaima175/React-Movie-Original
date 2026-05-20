import { useState } from "react";
import { useApp } from "../context/AppContext";
import MovieRecommendations from "../components/MovieRecommendations";
import AIChat from "../components/AIChat";

export default function AIPage() {
  const {
    watched, watchlist, addToWatchlist,
    aiRecommendations, setAiRecommendations,
    aiTasteProfile, setAiTasteProfile,
  } = useApp();

  const [aiSection, setAiSection] = useState("recs"); // 'recs' | 'chat'

  return (
    <div className={`ai-page ${aiSection === "chat" ? "chat-mode" : ""}`}>
      {/* ── Header ── */}
      <div className="ai-page-header">
        <h1 className="ai-page-title">🤖 AI Oracle</h1>
        <p className="ai-page-subtitle">
          Powered by your taste. {watched.length > 0
            ? `Analysing ${watched.length} rated films.`
            : "Rate some movies first to unlock recommendations."}
        </p>
      </div>

      {/* ── Tab row ── */}
      <div className="ai-tabs-row">
        <button
          className={`ai-tab ${aiSection === "recs" ? "active" : ""}`}
          onClick={() => setAiSection("recs")}
        >
          ✨ AI Picks
        </button>
        <button
          className={`ai-tab ${aiSection === "chat" ? "active" : ""}`}
          onClick={() => setAiSection("chat")}
        >
          💬 Chat with Oracle
        </button>
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

        {aiSection === "chat" && (
          <AIChat watched={watched} />
        )}
      </div>
    </div>
  );
}
