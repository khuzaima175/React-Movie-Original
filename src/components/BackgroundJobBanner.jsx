import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, Loader2, X } from "lucide-react";
import { useApp } from "../context/AppContext";
import { getActiveBackgroundJobNotice } from "../services/backgroundJobService";

export default function BackgroundJobBanner() {
  const { backgroundJobs, dismissBackgroundJobNotice } = useApp();
  const location = useLocation();
  const navigate = useNavigate();

  const notice = getActiveBackgroundJobNotice(backgroundJobs, location.pathname);
  if (!notice) return null;

  const isDone = notice.status === "done";

  function handleView() {
    dismissBackgroundJobNotice?.(notice.jobKey);
    navigate(notice.targetRoute);
  }

  return (
    <div
      className="fixed left-[1.6rem] bottom-[8.4rem] min-[901px]:bottom-[2.2rem] z-[75] max-w-[min(42rem,calc(100vw-3.2rem))]"
      role="status"
      aria-live="polite"
    >
      <div
        className={`flex items-center gap-[1rem] px-[1.4rem] py-[1rem] rounded-[1rem] border shadow-[0_12px_32px_rgba(0,0,0,0.6)] backdrop-blur-md ${
          isDone
            ? "bg-[#141715]/95 border-[#46d369]/35 text-[#f4f4f2]"
            : "bg-[#141416]/95 border-white/15 text-[#e6e6e2]"
        }`}
      >
        {isDone ? (
          <CheckCircle2 size={16} className="text-[#46d369] shrink-0" aria-hidden="true" />
        ) : (
          <Loader2 size={16} className="text-[#e2b13c] spin-icon shrink-0" aria-hidden="true" />
        )}

        <span className="text-[1.28rem] font-medium leading-[1.35] truncate">
          {notice.message}
        </span>

        {isDone && (
          <button
            type="button"
            onClick={handleView}
            className="inline-flex items-center gap-[0.4rem] px-[1rem] py-[0.45rem] rounded-[0.6rem] bg-[#f5f5f1] text-[#0b0b0c] text-[1.2rem] font-semibold shrink-0 hover:bg-white transition-colors cursor-pointer border-0"
          >
            <span>View</span>
            <ArrowRight size={13} aria-hidden="true" />
          </button>
        )}

        <button
          type="button"
          onClick={() => dismissBackgroundJobNotice?.(notice.jobKey)}
          aria-label="Dismiss background status"
          className="inline-flex items-center justify-center p-[0.35rem] rounded-[0.5rem] bg-transparent border-0 text-[#8a8a86] hover:text-[#f4f4f2] cursor-pointer shrink-0"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
