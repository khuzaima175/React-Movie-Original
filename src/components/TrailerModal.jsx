import { ExternalLink } from "lucide-react";
import { Modal } from "./ui/Modal";
import { buildTrailerEmbedUrl } from "../services/navHelpers";

export default function TrailerModal({ isOpen, onClose, title = "Film", year = "", trailerKey = "" }) {
  const embedUrl = buildTrailerEmbedUrl(trailerKey);
  if (!isOpen || !embedUrl) return null;

  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(String(trailerKey).trim())}`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${title}${year ? ` (${year})` : ""} — Official Trailer`}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <div className="relative w-full aspect-video rounded-[1rem] overflow-hidden bg-black border border-white/10">
          <iframe
            src={embedUrl}
            title={`${title} Official Trailer`}
            className="w-full h-full border-0"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </div>
        <div className="flex justify-end">
          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[1.25rem] text-[#b6b6b2] hover:text-[#f4f4f2] no-underline"
          >
            <span>Open on YouTube</span>
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
      </div>
    </Modal>
  );
}
