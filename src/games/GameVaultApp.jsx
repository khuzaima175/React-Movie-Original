import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import RouteFallback from "../components/RouteFallback";
import { GameVaultProvider, useGameVault } from "./context/GameVaultContext";
import GameRateModal from "./components/GameRateModal";
import "./styles/games.css";

function GameVaultShell() {
  const { rateTarget, setRateTarget, playedById, savePlayedGame, removePlayedGame } = useGameVault();

  return (
    <>
      <Suspense fallback={<RouteFallback />}>
        <Outlet />
      </Suspense>

      {rateTarget && (
        <GameRateModal
          game={rateTarget}
          existing={playedById.get(rateTarget.igdbId) || null}
          onClose={() => setRateTarget(null)}
          onSave={savePlayedGame}
          onRemove={removePlayedGame}
        />
      )}
    </>
  );
}

export default function GameVaultApp() {
  return (
    <GameVaultProvider>
      <GameVaultShell />
    </GameVaultProvider>
  );
}
