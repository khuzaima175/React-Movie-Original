import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

const NUMBER_RE = /(\d+(?:\.\d+)?)/g;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Counts every number inside `value` up from 0 when it first scrolls into view,
 * preserving surrounding text and each number's decimal places
 * ("142h 20m" -> "0h 0m" ... "142h 20m", "7.8" -> "0.0" ... "7.8").
 * Falls back to the final text under reduced motion or without IntersectionObserver.
 */
export default function AnimatedNumber({ value, duration = 1100, className = "" }) {
  const finalText = String(value ?? "");
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const [progress, setProgress] = useState(1);
  const hasPlayedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    const hasNumbers = /\d/.test(finalText);
    if (!el || reduced || !hasNumbers || hasPlayedRef.current) {
      setProgress(1);
      return undefined;
    }
    if (typeof IntersectionObserver === "undefined") {
      setProgress(1);
      return undefined;
    }

    let raf = 0;
    setProgress(0);
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        hasPlayedRef.current = true;
        const start = performance.now();
        const tick = (now) => {
          const t = Math.min(1, (now - start) / duration);
          setProgress(easeOutCubic(t));
          if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 }
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [finalText, duration, reduced]);

  const text =
    progress >= 1
      ? finalText
      : finalText.replace(NUMBER_RE, (match) => {
          const decimals = match.includes(".") ? match.split(".")[1].length : 0;
          return (Number(match) * progress).toFixed(decimals);
        });

  return (
    <span ref={ref} className={className} aria-label={finalText}>
      <span aria-hidden="true">{text}</span>
    </span>
  );
}
