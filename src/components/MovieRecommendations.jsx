import { useState } from "react";
import { getMovieRecommendations, getFallbackPoster } from "../services/geminiService";

const getOmdbKey = () => {
    const key = import.meta.env.VITE_OMDB_KEY;
    if (!key || key === "undefined" || key === "null" || key.trim() === "") {
        return "b78bdecd";
    }
    return key.trim();
};
const KEY = getOmdbKey();

export default function MovieRecommendations({
    watched,
    onAddToWatchlist,
    watchlist,
    recommendations,
    setRecommendations,
    tasteProfile,
    setTasteProfile
}) {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [progress, setProgress] = useState("");

    // State for expanded explanation (just toggles visibility, no API call)
    const [expandedRec, setExpandedRec] = useState(null);
    const [isAddingMovie, setIsAddingMovie] = useState(null);

    const handleGetRecommendations = async () => {
        if (watched.length < 3) {
            setError("Rate at least 3 movies to get personalized recommendations!");
            return;
        }

        setIsLoading(true);
        setError("");
        setRecommendations(null);
        setExpandedRec(null);

        try {
            const result = await getMovieRecommendations(watched, watchlist, setProgress);
            setTasteProfile(result.tasteProfile);
            setRecommendations(result.recommendations);
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
            setProgress("");
        }
    };

    // Toggle explanation visibility instantly (no API call - uses pre-generated reason)
    const handleToggleExplanation = (rec) => {
        if (expandedRec === rec.title) {
            setExpandedRec(null);
        } else {
            setExpandedRec(rec.title);
        }
    };

    const isAlreadyInWatchlist = (movieTitle) => {
        return watchlist?.some(m => m.title.toLowerCase() === movieTitle.toLowerCase());
    };

    // Fetch real movie data from OMDB to get poster, then add to watchlist
    const handleAdd = async (rec) => {
        setIsAddingMovie(rec.title);

        try {
            // Search OMDB for the movie to get real poster and data
            let res = await fetch(
                `https://www.omdbapi.com/?apikey=${KEY}&t=${encodeURIComponent(rec.title)}&y=${rec.year}`
            );
            
            if (!res.ok || res.status === 401) {
                if (KEY !== "b78bdecd") {
                    console.log("⚠️ Configured OMDb key failed during watchlist add, retrying with default key...");
                    res = await fetch(
                        `https://www.omdbapi.com/?apikey=b78bdecd&t=${encodeURIComponent(rec.title)}&y=${rec.year}`
                    );
                }
            }
            
            let data = await res.json();

            if (data.Response === "False" && data.Error && (data.Error.includes("key") || data.Error.includes("credential")) && KEY !== "b78bdecd") {
                console.log("⚠️ Configured OMDb key rejected, retrying watchlist add with default key...");
                const fallbackRes = await fetch(
                    `https://www.omdbapi.com/?apikey=b78bdecd&t=${encodeURIComponent(rec.title)}&y=${rec.year}`
                );
                if (fallbackRes.ok) {
                    data = await fallbackRes.json();
                }
            }

            if (data.Response === "True") {
                const newMovie = {
                    imdbID: data.imdbID,
                    title: data.Title,
                    year: data.Year,
                    poster: data.Poster !== "N/A" ? data.Poster : getFallbackPoster(rec.title),
                    runtime: data.Runtime,
                    imdbRating: data.imdbRating,
                    userRating: 0
                };
                onAddToWatchlist(newMovie);
            } else {
                // Fallback if OMDB doesn't find it
                const newMovie = {
                    imdbID: Math.random().toString(36).substr(2, 9),
                    title: rec.title,
                    year: rec.year,
                    poster: getFallbackPoster(rec.title),
                    runtime: "N/A",
                    imdbRating: rec.imdbRating || "N/A",
                    userRating: 0
                };
                onAddToWatchlist(newMovie);
            }
        } catch (err) {
            console.error("Failed to fetch movie data:", err);
            // Add with placeholder on error
            const newMovie = {
                imdbID: Math.random().toString(36).substr(2, 9),
                title: rec.title,
                year: rec.year,
                poster: getFallbackPoster(rec.title),
                runtime: "N/A",
                imdbRating: rec.imdbRating || "N/A",
                userRating: 0
            };
            onAddToWatchlist(newMovie);
        } finally {
            setIsAddingMovie(null);
        }
    };

    if (watched.length === 0) {
        return (
            <div className="ai-empty-state">
                <span className="ai-icon">🤖</span>
                <h3>No Data Yet!</h3>
                <p>Start rating movies to unlock AI-powered recommendations tailored to your taste.</p>
            </div>
        );
    }

    return (
        <div className="ai-recommendations">
            {!recommendations && !isLoading && (
                <div className="ai-trigger-section">
                    <div className="ai-intro">
                        <span className="ai-sparkle">✨</span>
                        <h3>AI Movie Oracle</h3>
                        <p>Based on your <strong>{watched.length}</strong> rated movies, our AI will analyze your taste and find perfect matches.</p>
                    </div>

                    <button
                        className="btn-ai-generate"
                        onClick={handleGetRecommendations}
                        disabled={watched.length < 3}
                    >
                        <span className="btn-icon">🎬</span>
                        Get AI Recommendations
                    </button>

                    {watched.length < 3 && (
                        <p className="ai-hint">Rate at least 3 movies to unlock recommendations</p>
                    )}

                    {error && <p className="ai-error">{error}</p>}
                </div>
            )}

            {isLoading && (
                <div className="ai-loading">
                    <div className="ai-loading-spinner"></div>
                    <p className="ai-loading-text">{progress || "Consulting the AI oracle..."}</p>
                </div>
            )}

            {recommendations && (
                <div className="ai-results">
                    {tasteProfile && (
                        <div className="taste-profile">
                            <h4>🎯 Your Taste Profile</h4>
                            <div className="taste-tags">
                                {tasteProfile.favoriteGenres?.map((genre, i) => (
                                    <span key={i} className="taste-tag">{genre}</span>
                                ))}
                            </div>
                            <p className="taste-era">{tasteProfile.preferredEra}</p>
                        </div>
                    )}

                    <h4 className="recs-header">🍿 Perfect Picks For You <span className="recs-sorted">(sorted by IMDB rating)</span></h4>

                    <ul className="recommendation-list">
                        {recommendations.map((rec, index) => (
                            <li key={index} className="recommendation-card">
                                {rec.poster && (
                                    <div className="rec-poster-wrapper">
                                        <img
                                            src={rec.poster}
                                            alt={`${rec.title} Poster`}
                                            className="rec-poster-img"
                                            onError={(e) => {
                                                e.target.onerror = null; // prevent infinite loop
                                                e.target.src = getFallbackPoster(rec.title);
                                            }}
                                        />
                                    </div>
                                )}
                                <div className="rec-content">
                                    <div className="rec-header">
                                        <div className="rec-title-section">
                                            <h5>{rec.title}</h5>
                                            <span className="rec-meta">
                                                {rec.year} • {rec.type === "series" ? "📺" : "🎬"} {rec.genre}
                                            </span>
                                        </div>
                                        <div className="rec-ratings">
                                            <div className="imdb-rating">
                                                <span className="imdb-star">⭐</span>
                                                <span className="imdb-value">{(rec.imdbRating && rec.imdbRating > 0) ? rec.imdbRating.toFixed(1) : "N/A"}</span>
                                                <span className="imdb-label">IMDB</span>
                                            </div>
                                            <div className="match-score">
                                                <span className="score-value">{rec.matchScore}%</span>
                                                <span className="score-label">match</span>
                                            </div>
                                        </div>
                                    </div>
                                    <p className="rec-reason">{rec.reason}</p>

                                    <div className="rec-actions">
                                        <button
                                            className="btn-explain"
                                            onClick={() => handleToggleExplanation(rec)}
                                        >
                                            {expandedRec === rec.title ? "Hide Details" : "🧠 Why this match?"}
                                        </button>

                                        <button
                                            className="btn-add-watchlist"
                                            onClick={() => handleAdd(rec)}
                                            disabled={isAlreadyInWatchlist(rec.title) || isAddingMovie === rec.title}
                                        >
                                            {isAddingMovie === rec.title ? "Adding..." :
                                                isAlreadyInWatchlist(rec.title) ? "✓ Added" : "+ Plan to Watch"}
                                        </button>
                                    </div>

                                    {expandedRec === rec.title && (
                                        <div className="rec-explanation">
                                            <p><strong>Why we picked this:</strong> {rec.reason}</p>
                                            <p className="rec-detail-text">
                                                This matches your taste for {tasteProfile?.favoriteGenres?.[0] || "quality"} content
                                                from the {tasteProfile?.preferredEra || "modern era"}.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>

                    <button
                        className="btn-refresh-recs"
                        onClick={handleGetRecommendations}
                    >
                        🔄 Get Fresh Recommendations
                    </button>
                </div>
            )}
        </div>
    );
}
