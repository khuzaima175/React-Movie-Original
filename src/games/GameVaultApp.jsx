import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import RouteFallback from "../components/RouteFallback";
import { GameVaultProvider, useGameVault } from "./context/GameVaultContext";
import GameRateModal from "./components/GameRateModal";
import GameRouletteModal from "./components/GameRouletteModal";
import GameOnboardingModal from "./components/GameOnboardingModal";
import "./styles/games.css";

function GameVaultShell() {
  const {
    played,
    backlog,
    models,
    rateTarget,
    setRateTarget,
    playedById,
    savePlayedGame,
    removePlayedGame,
    rouletteState,
    closeRoulette,
    rigProfile,
    updateRigProfile,
    onboardingOpen,
    setOnboardingOpen
  } = useGameVault();

  return (
    <>
      <Suspense fallback={<RouteFallback />}>
        <Outlet />
      </Suspense>

      <GameRateModal
        game={rateTarget}
        existing={rateTarget ? playedById.get(rateTarget.igdbId) || null : null}
        played={played}
        onClose={() => setRateTarget(null)}
        onSave={savePlayedGame}
        onRemove={removePlayedGame}
      />

      <GameRouletteModal
        isOpen={rouletteState.open}
        onClose={closeRoulette}
        played={played}
        backlog={backlog}
        models={models}
        extraCandidates={rouletteState.extraCandidates}
      />

      <GameOnboardingModal
        isOpen={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        rigProfile={rigProfile}
        onSaveRig={updateRigProfile}
        playedById={playedById}
        onRateStarter={savePlayedGame}
      />
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
