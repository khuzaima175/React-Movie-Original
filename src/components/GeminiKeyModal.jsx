import { useEffect, useState } from "react";
import { Eye, EyeOff, ExternalLink, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { getUserGeminiKey, setUserGeminiKey } from "../services/apiTransport";
import { resetSessionWorkingModels } from "../services/geminiService";

/**
 * Optional browser-local Gemini API key modal for visitors who want personal quota
 * beyond the shared demo proxy limit. Never synced to Vercel or Supabase.
 */
export default function GeminiKeyModal({ isOpen, onClose, onChanged }) {
  const [value, setValue] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [hasSavedKey, setHasSavedKey] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const existing = getUserGeminiKey();
    setValue(existing);
    setHasSavedKey(Boolean(existing));
    setShowKey(false);
  }, [isOpen]);

  const handleSave = (e) => {
    e.preventDefault();
    const stored = setUserGeminiKey(value);
    resetSessionWorkingModels({ clearStorage: true });
    setHasSavedKey(Boolean(stored));
    onChanged?.(Boolean(stored));
    onClose?.();
  };

  const handleClear = () => {
    setUserGeminiKey("");
    resetSessionWorkingModels({ clearStorage: true });
    setValue("");
    setHasSavedKey(false);
    onChanged?.(false);
    onClose?.();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Personal AI Key (Optional)" size="sm">
      <form onSubmit={handleSave} className="flex flex-col gap-5 text-[1.35rem] text-[var(--text-2)]">
        <p className="m-0 leading-relaxed">
          CinemaVault runs on a shared daily Gemini quota. If the shared demo reaches capacity—or if
          you want higher limits—you can paste your own free Google AI Studio key here.
        </p>

        <div className="flex items-start gap-3 rounded-[var(--r-sm)] border border-[var(--hairline)] bg-[var(--surface-2)] p-4 text-[1.25rem]">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[var(--text-1)]" aria-hidden="true" />
          <span>
            Stored only in this browser&apos;s <code className="text-[var(--text-1)]">localStorage</code> and
            sent straight from your browser to Google AI—never uploaded to CinemaVault or Supabase.
          </span>
        </div>

        <label className="flex flex-col gap-2">
          <span className="font-semibold text-[var(--text-1)] flex items-center gap-2">
            <KeyRound size={14} aria-hidden="true" />
            <span>Gemini API Key</span>
          </span>
          <div className="flex items-center gap-2">
            <input
              type={showKey ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Paste Google AI Studio key (optional)"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 h-[4rem] px-4 rounded-[var(--r-sm)] border border-[var(--hairline)] bg-[var(--bg)] text-[var(--text-1)] font-mono text-[1.3rem] outline-none focus:border-[var(--hairline-strong)]"
            />
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setShowKey((prev) => !prev)}
              aria-label={showKey ? "Hide API key" : "Show API key"}
            >
              {showKey ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
            </Button>
          </div>
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[1.25rem] text-[var(--text-1)] underline underline-offset-4 hover:opacity-80"
          >
            <span>Get a free key at Google AI Studio</span>
            <ExternalLink size={12} aria-hidden="true" />
          </a>

          <div className="flex items-center gap-2 ml-auto">
            {hasSavedKey && (
              <Button type="button" variant="ghost" size="md" onClick={handleClear}>
                <Trash2 size={14} aria-hidden="true" />
                <span>Clear key</span>
              </Button>
            )}
            <Button type="button" variant="ghost" size="md" onClick={onClose}>
              <span>Cancel</span>
            </Button>
            <Button type="submit" variant="primary" size="md">
              <span>Save key</span>
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
