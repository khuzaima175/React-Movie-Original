import { useState, useEffect, useRef } from "react";
import { Film } from "lucide-react";

// In-memory cache of successfully loaded poster URLs in this session
const loadedImagesCache = new Set();

export default function PosterImage({ src, alt, title = "Movie", className = "", style = {} }) {
  const isInvalidSrc = !src || src === "N/A" || src.includes("placeholder.com");
  const isAlreadyLoaded = Boolean(src && loadedImagesCache.has(src));

  const [hasError, setHasError] = useState(isInvalidSrc);
  const [isLoading, setIsLoading] = useState(!isInvalidSrc && !isAlreadyLoaded);
  const [retryCount, setRetryCount] = useState(0);
  const timerRef = useRef(null);
  const imgRef = useRef(null);

  useEffect(() => {
    const invalid = !src || src === "N/A" || src.includes("placeholder.com");
    const alreadyLoaded = Boolean(src && loadedImagesCache.has(src));
    setHasError(invalid);
    setIsLoading(!invalid && !alreadyLoaded);
    setRetryCount(0);

    // Cancel any retry timer that was still pending for the previous src / on unmount
    return () => clearTimeout(timerRef.current);
  }, [src]);

  function handleSuccess() {
    if (src) loadedImagesCache.add(src);
    setIsLoading(false);
  }

  function handleError() {
    if (retryCount < 2) {
      timerRef.current = setTimeout(() => {
        setRetryCount((c) => c + 1);
      }, 400 * (retryCount + 1));
    } else {
      setHasError(true);
      setIsLoading(false);
    }
  }

  // Check if cached image completed immediately
  useEffect(() => {
    if (imgRef.current && imgRef.current.complete) {
      if (imgRef.current.naturalWidth > 0) {
        handleSuccess();
      }
    }
  }, [src, retryCount]);

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

  const finalSrc = retryCount > 0
    ? `${src}${src.includes("?") ? "&" : "?"}_r=${retryCount}`
    : src;

  return (
    <div className={`poster-img-container ${isLoading ? "is-loading" : ""} ${className}`} style={style}>
      {isLoading && <div className="poster-skeleton-shimmer" aria-hidden="true" />}
      <img
        ref={(node) => {
          imgRef.current = node;
          if (node && node.complete && node.naturalWidth > 0) {
            handleSuccess();
          }
        }}
        key={retryCount}
        src={finalSrc}
        alt={alt || `${title} poster`}
        referrerPolicy="no-referrer"
        onLoad={handleSuccess}
        onError={handleError}
        className={`poster-img ${isLoading ? "hidden" : "visible"}`}
      />
    </div>
  );
}
