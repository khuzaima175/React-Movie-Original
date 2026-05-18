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

export function MovieDetailsSkeleton() {
    return (
        <div className="details">
            <header style={{ position: 'relative' }}>
                <div className="skeleton" style={{ width: '33%', height: '400px' }}></div>
                <div className="details-overview">
                    <div className="skeleton skeleton-title" style={{ width: '80%' }}></div>
                    <div className="skeleton skeleton-text" style={{ width: '60%' }}></div>
                    <div className="skeleton skeleton-text" style={{ width: '40%' }}></div>
                    <div className="skeleton skeleton-text" style={{ width: '50%' }}></div>
                </div>
            </header>
            <section>
                <div className="rating">
                    <div className="skeleton skeleton-text" style={{ width: '200px', height: '40px' }}></div>
                </div>
                <div className="skeleton skeleton-text" style={{ width: '100%', height: '60px' }}></div>
                <div className="skeleton skeleton-text" style={{ width: '80%' }}></div>
                <div className="skeleton skeleton-text" style={{ width: '70%' }}></div>
            </section>
        </div>
    );
}
