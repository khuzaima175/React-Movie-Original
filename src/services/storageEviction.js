import { compactVaultListForStorage } from "./vaultSyncService.js";

const VAULT_STORAGE_KEYS = new Set(["watchedMovies", "watchlist"]);

export const STORAGE_PURGE_ORDER = [
  "cinemavault_smart_cache_v4",
  "cinemavault_smart_cache_v3",
  "cinemavault_home_feeds_v2",
  "cinemavault_working_model_curation_v1",
  "cinemavault_working_model_fast_v1",
  "cinemavault_explanations_v1",
  "cinemavault_recs_model_v1",
  "cinemavault_recs_v1",
  "cinemavault_recs_hash_v1",
  "cinemavault_feedback_v1"
];

function removeMatchingStorageKeys(storage, baseKey, protectedKey) {
  if (!storage || typeof storage.removeItem !== "function") return;
  if (baseKey !== protectedKey) {
    storage.removeItem(baseKey);
  }
  // Sweep prefixed derivative cache keys such as cinemavault_home_feeds_v2::<day>::<sig>
  if (typeof storage.length === "number" && typeof storage.key === "function") {
    const prefix = `${baseKey}::`;
    const toRemove = [];
    for (let i = 0; i < storage.length; i += 1) {
      const candidate = storage.key(i);
      if (candidate && candidate !== protectedKey && candidate.startsWith(prefix)) {
        toRemove.push(candidate);
      }
    }
    for (const k of toRemove) {
      storage.removeItem(k);
    }
  }
}

/**
 * Safe LocalStorage setter with tiered LRU eviction policy & 2-stage vault compaction.
 */
export function safeSetStorageItem(key, value, options = {}) {
  const storage =
    options.storage || (typeof localStorage !== "undefined" ? localStorage : null);
  const logger = options.logger || console;
  if (!storage) return false;

  const payload =
    VAULT_STORAGE_KEYS.has(key) && Array.isArray(value)
      ? compactVaultListForStorage(value, { aggressive: false })
      : value;
  const serialized = JSON.stringify(payload);

  try {
    storage.setItem(key, serialized);
    return true;
  } catch (e) {
    if (e?.name === "QuotaExceededError" || e?.code === 22 || e?.code === 1014) {
      logger.warn?.("LocalStorage quota exceeded. Purging derivative caches to protect user vault...");

      for (const purgeKey of STORAGE_PURGE_ORDER) {
        if (purgeKey !== key) {
          removeMatchingStorageKeys(storage, purgeKey, key);
          try {
            storage.setItem(key, serialized);
            logger.log?.(`Recovered storage by purging ${purgeKey}`);
            return true;
          } catch (_) {
            // Continue to next eviction candidate
          }
        }
      }

      // Stage 2 recovery: aggressively compact existing vault lists in localStorage
      try {
        for (const vKey of VAULT_STORAGE_KEYS) {
          if (vKey === key) continue;
          const rawExisting = storage.getItem(vKey);
          if (rawExisting && rawExisting !== "undefined") {
            const parsedExisting = JSON.parse(rawExisting);
            if (Array.isArray(parsedExisting)) {
              storage.setItem(
                vKey,
                JSON.stringify(compactVaultListForStorage(parsedExisting, { aggressive: true }))
              );
            }
          }
        }
        const retryPayload =
          VAULT_STORAGE_KEYS.has(key) && Array.isArray(value)
            ? JSON.stringify(compactVaultListForStorage(value, { aggressive: true }))
            : serialized;
        storage.setItem(key, retryPayload);
        logger.log?.(`Recovered storage via Stage-2 aggressive vault compaction for ${key}`);
        return true;
      } catch (_) {
        // Proceed to critical error dispatch
      }

      logger.error?.("Critical: Storage completely full even after derivative cache eviction.");
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("storage-critical-error", {
            detail: "Your browser storage is nearly full. Please export a JSON backup from My Vault > Portability."
          })
        );
      }
      return false;
    }

    logger.error?.(`Error saving ${key} to localStorage:`, e);
    return false;
  }
}
