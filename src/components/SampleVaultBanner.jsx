import { Sparkles, X } from "lucide-react";
import { useApp } from "../context/AppContext";
import { Button } from "./ui/Button";

/**
 * Quiet status bar shown whenever demo sample entries are loaded so visitors
 * know what they are exploring and can clear sample data in one click.
 */
export default function SampleVaultBanner() {
  const { hasSampleData, clearSampleVault } = useApp();
  if (!hasSampleData) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-lg)] border border-[var(--hairline-strong)] bg-[var(--surface-2)] px-4 py-3 text-[1.3rem] text-[var(--text-2)]"
    >
      <div className="flex items-center gap-2.5">
        <Sparkles size={15} className="shrink-0 text-[var(--text-1)]" aria-hidden="true" />
        <span>You are exploring a sample vault.</span>
      </div>

      <Button type="button" variant="secondary" size="sm" onClick={clearSampleVault}>
        <X size={13} aria-hidden="true" />
        <span>Clear sample data</span>
      </Button>
    </div>
  );
}
