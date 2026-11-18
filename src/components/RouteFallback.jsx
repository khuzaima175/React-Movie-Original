/**
 * Minimal shimmer route fallback shown while lazy-loaded page chunks stream in.
 */
export default function RouteFallback() {
  return (
    <div className="page-rail py-16 flex flex-col gap-5" aria-busy="true" aria-label="Loading view">
      <div className="cv-skel h-[2px] w-full max-w-[28rem] mx-auto rounded-full" />
      <div className="cv-skel h-[2.8rem] w-full max-w-[36rem] mx-auto rounded-[var(--r-sm)]" />
      <div className="cv-skel h-[16rem] w-full rounded-[var(--r-lg)] mt-2" />
    </div>
  );
}
