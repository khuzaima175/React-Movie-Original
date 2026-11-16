export default function RowSkeleton({ cards = 6 }) {
  return (
    <section className="carousel-section row-skeleton" aria-hidden="true">
      <div className="carousel-header page-rail">
        <div className="cv-skel row-skel-title" />
      </div>
      <div className="page-rail">
        <div className="carousel-track">
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="cv-skel row-skel-poster" />
          ))}
        </div>
      </div>
    </section>
  );
}
