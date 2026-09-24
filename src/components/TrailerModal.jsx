import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Play, Film } from "lucide-react";

export default function TrailerModal({ isOpen, onClose, trailerKey, title = "Trailer" }) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !trailerKey) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 10000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0, 0, 0, 0.88)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          padding: "2rem 1.6rem"
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        role="dialog"
        aria-modal="true"
        aria-label={`Official Trailer for ${title}`}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 14 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          style={{
            width: "100%",
            maxWidth: "960px",
            borderRadius: "1.8rem",
            background: "#141416",
            border: "1px solid rgba(255, 255, 255, 0.14)",
            boxShadow: "0 32px 80px -16px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.06)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column"
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "1.6rem 2.4rem",
              background: "#1c1d20",
              borderBottom: "1px solid rgba(255, 255, 255, 0.08)"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <div
                style={{
                  width: "3.2rem",
                  height: "3.2rem",
                  borderRadius: "0.8rem",
                  background: "rgba(226, 177, 60, 0.15)",
                  border: "1px solid rgba(226, 177, 60, 0.3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#e2b13c"
                }}
              >
                <Film size={16} />
              </div>
              <div>
                <h3
                  style={{
                    fontSize: "1.6rem",
                    fontWeight: 700,
                    color: "#f4f4f2",
                    letterSpacing: "-0.01em",
                    margin: 0
                  }}
                >
                  {title}
                </h3>
                <span style={{ fontSize: "1.2rem", color: "#8a8a86" }}>Official Cinema Trailer</span>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
              <a
                href={`https://www.youtube.com/watch?v=${trailerKey}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.6rem",
                  padding: "0.6rem 1.2rem",
                  borderRadius: "0.8rem",
                  background: "#e2b13c",
                  color: "#141416",
                  fontSize: "1.25rem",
                  fontWeight: 700,
                  textDecoration: "none",
                  transition: "all 0.2s ease"
                }}
                className="hover:brightness-110"
                aria-label="Open trailer directly on YouTube"
              >
                <Play size={14} fill="currentColor" />
                <span>Open on YouTube</span>
              </a>

              <button
                onClick={onClose}
                style={{
                  width: "3.6rem",
                  height: "3.6rem",
                  borderRadius: "0.8rem",
                  background: "#242528",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  color: "#8a8a86",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  transition: "all 0.2s ease"
                }}
                className="hover:text-[#f4f4f2] hover:border-[#e2b13c]/40 hover:bg-[#2c2d32]"
                aria-label="Close trailer modal"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* 16:9 Video Container */}
          <div
            style={{
              position: "relative",
              width: "100%",
              paddingTop: "56.25%", // 16:9 Aspect Ratio
              background: "#000"
            }}
          >
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${trailerKey}?autoplay=1&rel=0&modestbranding=1`}
              title={`${title} Trailer`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                border: "none"
              }}
            />
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
