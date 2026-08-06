import { useState, useRef, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { sendChatMessage } from "../services/geminiChatService";
import { getFallbackPoster } from "../services/geminiService";
import PosterImage from "./PosterImage";
import {
  Sparkles,
  Send,
  User,
  RotateCcw,
  Star,
  Plus,
  Check,
  AlertCircle
} from "lucide-react";

const SUGGESTED_PROMPTS = [
  "Something like Inception",
  "Which directors do I love?",
  "Best 90s thrillers?",
  "Surprise me with a hidden gem"
];

function InlineMovieCard({ title, year }) {
  const { watchlist, addToWatchlist } = useApp();
  const [movieData, setMovieData] = useState(null);
  const [isAdding, setIsAdding] = useState(false);

  const inWatchlist = watchlist?.some(
    (m) => m.title.toLowerCase() === title.toLowerCase()
  );

  useEffect(() => {
    let isMounted = true;
    async function fetchDetails() {
      try {
        const cleanTitle = title.replace(/^["']|["']$/g, "").trim();
        const res = await fetch(
          `https://www.omdbapi.com/?apikey=b78bdecd&t=${encodeURIComponent(cleanTitle)}${
            year ? `&y=${year}` : ""
          }`
        );
        const data = await res.json();
        if (isMounted && data.Response === "True") {
          setMovieData(data);
        }
      } catch (err) {
        console.warn("Inline movie fetch failed:", err);
      }
    }
    fetchDetails();
    return () => {
      isMounted = false;
    };
  }, [title, year]);

  const handleAdd = () => {
    setIsAdding(true);
    const movieObj = {
      imdbID: movieData?.imdbID || Math.random().toString(36).substr(2, 9),
      title: movieData?.Title || title,
      year: movieData?.Year || year || "N/A",
      poster:
        movieData?.Poster && movieData.Poster !== "N/A"
          ? movieData.Poster
          : getFallbackPoster(title),
      runtime: movieData?.Runtime || "N/A",
      imdbRating: movieData?.imdbRating || "N/A",
      userRating: 0
    };
    addToWatchlist(movieObj);
    setTimeout(() => setIsAdding(false), 400);
  };

  return (
    <div className="chat-inline-movie-card">
      <div className="inline-poster-wrapper">
        <PosterImage
          poster={movieData?.Poster}
          title={title}
          className="inline-poster-img"
        />
      </div>
      <div className="inline-info">
        <h5 className="inline-title">{movieData?.Title || title}</h5>
        <span className="inline-meta">
          {movieData?.Year || year || "N/A"}{" "}
          {movieData?.Genre ? `• ${movieData.Genre.split(",")[0]}` : ""}
        </span>
        {movieData?.imdbRating && movieData.imdbRating !== "N/A" && (
          <div className="inline-rating">
            <Star size={12} className="star-gold" />
            <span>{movieData.imdbRating}</span>
          </div>
        )}
      </div>
      <button
        className={`btn-inline-add ${inWatchlist ? "added" : ""}`}
        onClick={handleAdd}
        disabled={inWatchlist || isAdding}
      >
        {inWatchlist ? <Check size={14} /> : <Plus size={14} />}
        <span>{inWatchlist ? "Added" : "Watchlist"}</span>
      </button>
    </div>
  );
}

// Extract movie recommendations like **Movie Title** (Year) or "Movie Title" (Year)
function parseMovieCardsFromText(text) {
  if (!text) return [];
  const regex = /(?:\*\*([^*]+)\*\*|\"([^\"]+)\")\s*\(((?:19|20)\d\d)\)/g;
  const movies = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const title = match[1] || match[2];
    const year = match[3];
    if (title && !movies.some((m) => m.title.toLowerCase() === title.toLowerCase())) {
      movies.push({ title: title.trim(), year });
    }
  }
  return movies.slice(0, 3); // cap at 3 inline cards per bubble
}

export default function AIChat({ watched }) {
  const { watchlist, addToWatchlist } = useApp();

  const [messages, setMessages] = useState([
    {
      role: "model",
      text: "Hello! I've analyzed your viewing history. Ask me for personalized recommendations, director deep-dives, or hidden gems!",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const chatContainerRef = useRef(null);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSendMessage = async (textToSend) => {
    const query = textToSend || input.trim();
    if (!query || isLoading) return;

    if (!textToSend) setInput("");
    setError(false);

    const currentTime = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
    const newMessages = [
      ...messages,
      { role: "user", text: query, time: currentTime }
    ];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      const responseText = await sendChatMessage(
        query,
        newMessages.filter((m) => m !== newMessages[0]),
        watched
      );

      setMessages((prev) => [
        ...prev,
        {
          role: "model",
          text: responseText,
          time: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          })
        }
      ]);
    } catch (err) {
      setError(true);
      setMessages((prev) => [
        ...prev,
        {
          role: "model",
          text: "Connection issue. Unable to consult the Oracle right now.",
          isError: true,
          time: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          })
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    handleSendMessage();
  };

  return (
    <div className="ai-chat-wrapper">
      <div className="ai-chat-container">
        {/* Messages list */}
        <div className="chat-messages" ref={chatContainerRef} aria-live="polite">
          {messages.map((msg, index) => {
            const detectedMovies =
              msg.role === "model" ? parseMovieCardsFromText(msg.text) : [];

            return (
              <div key={index} className={`chat-bubble-wrapper ${msg.role}`}>
                {msg.role === "model" && (
                  <div className="chat-avatar bot-avatar">
                    <Sparkles size={16} />
                  </div>
                )}

                <div className={`chat-bubble ${msg.role} ${msg.isError ? "error" : ""}`}>
                  <p className="bubble-text">{msg.text}</p>

                  {/* Render inline movie cards if Oracle recommended movies */}
                  {detectedMovies.length > 0 && (
                    <div className="chat-inline-movies-grid">
                      {detectedMovies.map((m, i) => (
                        <InlineMovieCard key={i} title={m.title} year={m.year} />
                      ))}
                    </div>
                  )}

                  <span className="bubble-timestamp">{msg.time}</span>
                </div>

                {msg.role === "user" && (
                  <div className="chat-avatar user-avatar">
                    <User size={16} />
                  </div>
                )}
              </div>
            );
          })}

          {/* Typing Indicator */}
          {isLoading && (
            <div className="chat-bubble-wrapper model">
              <div className="chat-avatar bot-avatar">
                <Sparkles size={16} />
              </div>
              <div className="chat-bubble model typing">
                <div className="typing-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Suggested Prompt Chips */}
        {messages.length <= 2 && !isLoading && (
          <div className="chat-prompts-container">
            <span className="prompts-label">Suggested prompts:</span>
            <div className="prompts-chips">
              {SUGGESTED_PROMPTS.map((promptText, idx) => (
                <button
                  key={idx}
                  className="prompt-chip"
                  onClick={() => handleSendMessage(promptText)}
                >
                  <Sparkles size={13} />
                  <span>{promptText}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Docked Input Form */}
        <form className="chat-input-form" onSubmit={handleFormSubmit}>
          <div className="chat-input-wrapper">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Oracle for movie recommendations, director insights..."
              disabled={isLoading}
              className="chat-text-input"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="btn-chat-send"
              aria-label="Send message"
            >
              <Send size={16} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
