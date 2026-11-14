import { useState } from "react";
import { useApp } from "../context/AppContext";
import MovieRecommendations from "../components/MovieRecommendations";
import AIChat from "../components/AIChat";
import { Button, Tabs } from "../components/ui";
import { SlidersHorizontal } from "lucide-react";

export default function AIPage({ onOpenTasteDeck }) {
  const {
    watched = [],
    watchlist = [],
    addToWatchlist,
    aiRecommendations,
    setAiRecommendations,
    aiTasteProfile,
    setAiTasteProfile
  } = useApp();

  const [aiSection, setAiSection] = useState("recs"); // "recs" | "chat"

  return (
    <div className={`ai-page-wrapper ${aiSection === "chat" ? "chat-mode" : ""}`}>
      <div className="ai-page-container page-rail">
        <header className="ai-studio-header">
          <div className="ai-studio-brand">
            <h1 className="ai-studio-title display-title">Film Oracle</h1>
            <p className="ai-studio-desc">
              Personalized picks tuned to your rated films.
            </p>
          </div>

          <div className="ai-header-actions">
            {onOpenTasteDeck && (
              <Button variant="ghost" size="sm" onClick={onOpenTasteDeck}>
                <SlidersHorizontal size={14} aria-hidden="true" />
                <span>Taste Calibration</span>
              </Button>
            )}

            <Tabs
              tabs={[
                { id: "recs", label: "Picks" },
                { id: "chat", label: "Film Companion" }
              ]}
              activeTab={aiSection}
              onChange={setAiSection}
            />
          </div>
        </header>

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
              onOpenTasteDeck={onOpenTasteDeck}
            />
          )}

          {aiSection === "chat" && <AIChat watched={watched} />}
        </main>
      </div>
    </div>
  );
}
