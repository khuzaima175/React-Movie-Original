import { useState, useEffect } from "react";
import { Film } from "lucide-react";

export default function PosterImage({ src, alt, title = "Movie", className = "", style = {} }) {
  const isInvalidSrc = !src || src === "N/A" || src.includes("placeholder.com");
  const [hasError, setHasError] = useState(isInvalidSrc);
  const [isLoading, setIsLoading] = useState(!isInvalidSrc);

  useEffect(() => {
    const invalid = !src || src === "N/A" || src.includes("placeholder.com");
    setHasError(invalid);
    setIsLoading(!invalid);
  }, [src]);

  // Generate title initials for fallback tile
  const getInitials = (str) => {
    if (!str) return "FILM";
    const words = str.trim().split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].substring(0, 3).toUpperCase();
    return words
      .slice(0, 3)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  };

  if (hasError) {
    return (
      <div className={`poster-fallback-tile ${className}`} style={style} aria-label={`${title} poster unavailable`}>
        <Film className="poster-fallback-icon" size={28} aria-hidden="true" />
        <span className="poster-fallback-initials">{getInitials(title)}</span>
        <span className="poster-fallback-title">{title}</span>
      </div>
    );
  }

  return (
    <div className={`poster-img-container ${isLoading ? "is-loading" : ""} ${className}`} style={style}>
      {isLoading && <div className="poster-skeleton-shimmer" aria-hidden="true" />}
      <img
        src={src}
        alt={alt || `${title} poster`}
        referrerPolicy="no-referrer"
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setHasError(true);
          setIsLoading(false);
        }}
        className={`poster-img ${isLoading ? "hidden" : "visible"}`}
      />
    </div>
  );
}
