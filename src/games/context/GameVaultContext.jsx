import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../../context/AppContext";
import { getSupabaseClientAsync, hasSupabaseConfig } from "../../services/supabaseClient";
import {
  GAME_BACKLOG_STORAGE_KEY,
  GAME_PLAYED_STORAGE_KEY,
  buildGameExportPayload,
  compactGameRecord,
  loadGameVault,
  parseGameImport,
  saveGameVaultSlice
} from "../services/gameVaultStorage";
import { loadGameModelBundle, loadSteamCrosswalk } from "../services/gameModelService";
import { fetchGamesBatch } from "../services/igdbService";
import { deleteCloudGame, pullAndSyncGameVault, upsertCloudGame } from "../services/gameSyncService";

const GameVaultContext = createContext(null);

export function GameVaultProvider({ children }) {
  const { cloudUser = null } = useApp();
  const [played, setPlayed] = useState([]);
  const [backlog, setBacklog] = useState([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [models, setModels] = useState({
    easeIndex: null,
    collabIndex: null,
    contentIndex: null,
    tunerAxes: null,
    weights: null
  });
  const [modelsLoading, setModelsLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState("idle");
  const [rateTarget, setRateTarget] = useState(null);
  const syncedUserRef = useRef(null);

  // 1. Hydrate local IndexedDB game vault + lazily load /models/games/* binaries once
  useEffect(() => {
    let active = true;
    loadGameVault().then(({ played: p, backlog: b }) => {
      if (!active) return;
      setPlayed(p);
      setBacklog(b);
      setIsHydrated(true);
    });
    loadGameModelBundle()
      .then((bundle) => {
        if (!active) return;
        setModels(bundle);
      })
      .finally(() => {
        if (active) setModelsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // 2. Optional Supabase `public.user_games` cloud sync for signed-in users
  useEffect(() => {
    if (!isHydrated || !cloudUser?.id || !hasSupabaseConfig()) return;
    if (syncedUserRef.current === cloudUser.id) return;
    syncedUserRef.current = cloudUser.id;
    let active = true;
    setSyncStatus("syncing");
    getSupabaseClientAsync()
      .then((supabase) => pullAndSyncGameVault(supabase, cloudUser.id, { played, backlog }))
      .then(async (res) => {
        if (!active) return;
        if (res.status === "synced") {
          setPlayed(res.played);
          setBacklog(res.backlog);
          await Promise.all([
            saveGameVaultSlice(GAME_PLAYED_STORAGE_KEY, res.played),
            saveGameVaultSlice(GAME_BACKLOG_STORAGE_KEY, res.backlog)
          ]);
          setSyncStatus("synced");
        } else {
          setSyncStatus("idle");
        }
      })
      .catch(() => {
        if (active) setSyncStatus("error");
      });
    return () => {
      active = false;
    };
  }, [isHydrated, cloudUser?.id, played, backlog]);

  const savePlayedGame = useCallback(
    async (game, overrides = {}) => {
      const merged = compactGameRecord({
        ...game,
        ...overrides,
        updatedAt: new Date().toISOString()
      });
      if (!merged) return null;

      setPlayed((prev) => {
        const next = [merged, ...prev.filter((x) => x.igdbId !== merged.igdbId)];
        saveGameVaultSlice(GAME_PLAYED_STORAGE_KEY, next).catch(() => {});
        return next;
      });
      setBacklog((prev) => {
        if (!prev.some((x) => x.igdbId === merged.igdbId)) return prev;
        const next = prev.filter((x) => x.igdbId !== merged.igdbId);
        saveGameVaultSlice(GAME_BACKLOG_STORAGE_KEY, next).catch(() => {});
        return next;
      });

      if (cloudUser?.id && hasSupabaseConfig()) {
        getSupabaseClientAsync().then((sb) => upsertCloudGame(sb, cloudUser.id, merged, "played")).catch(() => {});
      }
      return merged;
    },
    [cloudUser?.id]
  );

  const removePlayedGame = useCallback(
    async (igdbId) => {
      const id = Number(igdbId);
      setPlayed((prev) => {
        const next = prev.filter((x) => x.igdbId !== id);
        saveGameVaultSlice(GAME_PLAYED_STORAGE_KEY, next).catch(() => {});
        return next;
      });
      if (cloudUser?.id && hasSupabaseConfig()) {
        getSupabaseClientAsync().then((sb) => deleteCloudGame(sb, cloudUser.id, id)).catch(() => {});
      }
    },
    [cloudUser?.id]
  );

  const toggleBacklogGame = useCallback(
    async (game) => {
      const clean = compactGameRecord({ ...game, status: "backlog", updatedAt: new Date().toISOString() });
      if (!clean) return;
      let added = false;
      setBacklog((prev) => {
        const exists = prev.some((x) => x.igdbId === clean.igdbId);
        added = !exists;
        const next = exists ? prev.filter((x) => x.igdbId !== clean.igdbId) : [clean, ...prev];
        saveGameVaultSlice(GAME_BACKLOG_STORAGE_KEY, next).catch(() => {});
        return next;
      });
      if (cloudUser?.id && hasSupabaseConfig()) {
        getSupabaseClientAsync()
          .then((sb) => (added ? upsertCloudGame(sb, cloudUser.id, clean, "backlog") : deleteCloudGame(sb, cloudUser.id, clean.igdbId)))
          .catch(() => {});
      }
    },
    [cloudUser?.id]
  );

  const importGamesFromText = useCallback(
    async (rawText) => {
      const steamMap = await loadSteamCrosswalk();
      const parsed = parseGameImport(rawText, { steamMap });
      let hydratedFromIds = [];
      if (parsed.resolvedIgdbIds.length > 0) {
        const fetched = await fetchGamesBatch(parsed.resolvedIgdbIds.slice(0, 120));
        hydratedFromIds = fetched.map((g) => compactGameRecord({ ...g, status: "played", userRating: 8 })).filter(Boolean);
      }
      const incomingPlayed = [...parsed.played, ...hydratedFromIds];
      const incomingBacklog = parsed.backlog;

      if (incomingPlayed.length > 0) {
        setPlayed((prev) => {
          const map = new Map(prev.map((x) => [x.igdbId, x]));
          for (const item of incomingPlayed) map.set(item.igdbId, { ...map.get(item.igdbId), ...item });
          const next = [...map.values()];
          saveGameVaultSlice(GAME_PLAYED_STORAGE_KEY, next).catch(() => {});
          return next;
        });
      }
      if (incomingBacklog.length > 0) {
        setBacklog((prev) => {
          const map = new Map(prev.map((x) => [x.igdbId, x]));
          for (const item of incomingBacklog) map.set(item.igdbId, { ...map.get(item.igdbId), ...item });
          const next = [...map.values()];
          saveGameVaultSlice(GAME_BACKLOG_STORAGE_KEY, next).catch(() => {});
          return next;
        });
      }
      return {
        addedPlayed: incomingPlayed.length,
        addedBacklog: incomingBacklog.length,
        unresolvedSteamCount: parsed.unresolvedSteamIds.length
      };
    },
    []
  );

  const exportVaultJson = useCallback(() => {
    const payload = buildGameExportPayload({ played, backlog });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gamevault-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [played, backlog]);

  const playedById = useMemo(() => new Map(played.map((g) => [g.igdbId, g])), [played]);
  const backlogIds = useMemo(() => new Set(backlog.map((g) => g.igdbId)), [backlog]);

  const value = useMemo(
    () => ({
      played,
      backlog,
      playedById,
      backlogIds,
      isHydrated,
      models,
      modelsLoading,
      syncStatus,
      rateTarget,
      setRateTarget,
      savePlayedGame,
      removePlayedGame,
      toggleBacklogGame,
      importGamesFromText,
      exportVaultJson
    }),
    [
      played,
      backlog,
      playedById,
      backlogIds,
      isHydrated,
      models,
      modelsLoading,
      syncStatus,
      rateTarget,
      savePlayedGame,
      removePlayedGame,
      toggleBacklogGame,
      importGamesFromText,
      exportVaultJson
    ]
  );

  return <GameVaultContext.Provider value={value}>{children}</GameVaultContext.Provider>;
}

export function useGameVault() {
  const ctx = useContext(GameVaultContext);
  if (!ctx) {
    throw new Error("useGameVault must be used inside GameVaultProvider");
  }
  return ctx;
}
