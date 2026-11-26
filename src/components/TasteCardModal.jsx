import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Share2 } from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { buildTasteCardData, renderTasteCardToCanvas } from "../services/tasteCardCanvas";

export default function TasteCardModal({
  isOpen,
  onClose,
  watched = [],
  profile = null
}) {
  const canvasRef = useRef(null);
  const [aspect, setAspect] = useState("story");
  const [scopeYear, setScopeYear] = useState("all");
  const currentYear = new Date().getFullYear();

  const cardData = useMemo(
    () =>
      buildTasteCardData({
        watched,
        profile,
        year: scopeYear === "year" ? currentYear : null
      }),
    [watched, profile, scopeYear, currentYear]
  );

  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    renderTasteCardToCanvas(canvasRef.current, cardData, { aspect }).catch(() => {});
  }, [isOpen, cardData, aspect]);

  function handleDownload() {
    if (!canvasRef.current) return;
    const url = canvasRef.current.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = url;
    link.download = `cinemavault-passport-${aspect}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async function handleShare() {
    if (!canvasRef.current || typeof navigator === "undefined" || !navigator.share) {
      handleDownload();
      return;
    }
    canvasRef.current.toBlob(async (blob) => {
      if (!blob) {
        handleDownload();
        return;
      }
      try {
        const file = new File([blob], `cinemavault-passport-${aspect}.png`, { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ title: cardData.title, files: [file] });
          return;
        }
      } catch {
        // user cancelled or unsupported
      }
      handleDownload();
    }, "image/png");
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Share Taste Passport" size="lg">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="together-role-toggle" role="group" aria-label="Card aspect ratio">
            <button
              type="button"
              className={aspect === "story" ? "is-active" : ""}
              onClick={() => setAspect("story")}
            >
              Story (9:16)
            </button>
            <button
              type="button"
              className={aspect === "wide" ? "is-active" : ""}
              onClick={() => setAspect("wide")}
            >
              Wide (16:9)
            </button>
          </div>

          <div className="together-role-toggle" role="group" aria-label="Time range">
            <button
              type="button"
              className={scopeYear === "all" ? "is-active" : ""}
              onClick={() => setScopeYear("all")}
            >
              All Time
            </button>
            <button
              type="button"
              className={scopeYear === "year" ? "is-active" : ""}
              onClick={() => setScopeYear("year")}
            >
              {currentYear} Wrapped
            </button>
          </div>
        </div>

        <div className="flex justify-center rounded-[1rem] bg-black/40 border border-white/10 p-4 max-h-[56vh] overflow-auto">
          <canvas
            ref={canvasRef}
            className="max-w-full max-h-[48vh] w-auto h-auto rounded-[0.8rem] shadow-2xl"
          />
        </div>

        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" icon={Download} onClick={handleDownload}>
            Download PNG
          </Button>
          <Button type="button" variant="accent" icon={Share2} onClick={handleShare}>
            Share Card
          </Button>
        </div>
      </div>
    </Modal>
  );
}
