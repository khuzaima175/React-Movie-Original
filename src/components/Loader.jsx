import { ArrowLeft } from "lucide-react";

export function Loader() {
    return <p className="loader">Loading...</p>;
}

export function MovieListSkeleton() {
    return (
        <ul className="list list-movies">
            {[1, 2, 3, 4, 5].map((i) => (
                <li key={i} style={{ cursor: 'default' }}>
                    <div className="skeleton skeleton-poster"></div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', width: '100%' }}>
                        <div className="skeleton skeleton-title"></div>
                        <div className="skeleton skeleton-year"></div>
                    </div>
                </li>
            ))}
        </ul>
    );
}

export function MovieDetailsSkeleton({ onCloseMovie } = {}) {
    return (
        <div
            className="netflix-modal-card luxury-detail-card movie-details-skeleton"
            aria-busy="true"
            aria-label="Loading movie details"
        >
            {/* Matching hero backdrop header */}
            <div className="movie-backdrop-hero">
                <div className="movie-backdrop-placeholder skeleton-shimmer" />
                <div className="movie-backdrop-gradient-top" />
                <div className="movie-backdrop-gradient-bottom" />

                <div className="movie-hero-nav-bar">
                    {onCloseMovie ? (
                        <button
                            type="button"
                            className="btn-modal-back glassmorphic-btn"
                            onClick={onCloseMovie}
                            aria-label="Go back"
                        >
                            <ArrowLeft size={18} aria-hidden="true" />
                            <span>Back</span>
                        </button>
                    ) : (
                        <div className="skeleton-pill" style={{ width: '8.6rem', height: '3.6rem' }} />
                    )}
                    <div className="skeleton-pill" style={{ width: '12.6rem', height: '3.6rem' }} />
                </div>

                <div className="movie-hero-title-group">
                    <div className="skeleton-line skeleton-hero-tagline" />
                    <div className="skeleton-line skeleton-hero-heading" />
                    <div className="movie-hero-chips">
                        <div className="skeleton-pill" style={{ width: '8.4rem' }} />
                        <div className="skeleton-pill" style={{ width: '7.2rem' }} />
                        <div className="skeleton-pill" style={{ width: '6.4rem' }} />
                    </div>
                </div>
            </div>

            {/* Matching 2-column body grid */}
            <div className="netflix-modal-body luxury-detail-body">
                <div className="netflix-modal-left">
                    <div className="netflix-modal-poster-wrap elevated-poster-card">
                        <div className="skeleton-poster" />
                    </div>

                    <div className="luxury-rating-deck movie-skeleton-deck">
                        <div className="skeleton-line" style={{ width: '54%', height: '1.3rem' }} />
                        <div className="skeleton-line" style={{ width: '100%', height: '4.2rem', borderRadius: '0.8rem' }} />
                        <div className="skeleton-line" style={{ width: '100%', height: '3.8rem', borderRadius: '0.8rem' }} />
                        <div className="skeleton-line" style={{ width: '100%', height: '4.4rem', borderRadius: '0.8rem' }} />
                    </div>
                </div>

                <div className="netflix-modal-right">
                    <div className="critical-scores-matrix">
                        {[1, 2, 3, 4].map((card) => (
                            <div key={card} className="score-matrix-card movie-skeleton-score-card">
                                <div className="skeleton-line" style={{ width: '52%', height: '1.1rem' }} />
                                <div className="skeleton-line" style={{ width: '38%', height: '2.2rem' }} />
                                <div className="skeleton-line" style={{ width: '68%', height: '1rem' }} />
                            </div>
                        ))}
                    </div>

                    <div className="movie-skeleton-block">
                        <div className="skeleton-line" style={{ width: '24%', height: '1.2rem', marginBottom: '0.6rem' }} />
                        <div className="skeleton-line" style={{ width: '96%', height: '1.35rem' }} />
                        <div className="skeleton-line" style={{ width: '91%', height: '1.35rem' }} />
                        <div className="skeleton-line" style={{ width: '68%', height: '1.35rem' }} />
                    </div>

                    <div className="movie-skeleton-block">
                        <div className="skeleton-line" style={{ width: '30%', height: '1.2rem', marginBottom: '0.6rem' }} />
                        <div className="movie-skeleton-cast-row">
                            {[1, 2, 3, 4].map((castItem) => (
                                <div key={castItem} className="skeleton-line movie-skeleton-cast-tile" />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
