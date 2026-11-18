import { useEffect } from "react";
import { formatDocumentTitle } from "../services/navHelpers";

/**
 * Sets document.title for a top-level route and restores the default app title on unmount.
 */
export function useDocumentTitle(section) {
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    document.title = formatDocumentTitle(section);
    return () => {
      document.title = "CinemaVault";
    };
  }, [section]);
}
