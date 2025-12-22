const average = (arr) =>
    arr.length === 0 ? 0 : arr.reduce((acc, cur, i, arr) => acc + cur / arr.length, 0);

export default function WatchedSummary({ watched }) {
    const avgImdbRating = average(
        watched.map((movie) => movie.imdbRating)
    ).toFixed(1);
    const avgUserRating = average(
        watched.map((movie) => movie.userRating)
    ).toFixed(1);
    const totalRuntime = watched.reduce((acc, movie) => acc + (movie.runtime || 0), 0);
    const hours = Math.floor(totalRuntime / 60);
    const mins = totalRuntime % 60;

    // Find the top rated movie by user
    const topRatedMovie = watched.length > 0
        ? watched.reduce((prev, current) => (prev.userRating > current.userRating) ? prev : current)
        : null;

    return (
        <div className="summary">
            <h2>Your Movie Stats</h2>
            <div>
                <p>
                    <span>🎬</span>
                    <span>{watched.length} movies</span>
                </p>
                <p>
                    <span>⭐️</span>
                    <span>{watched.length > 0 ? avgImdbRating : '0.0'}</span>
                </p>
                <p>
                    <span>🌟</span>
                    <span>{watched.length > 0 ? avgUserRating : '0.0'}</span>
                </p>
                <p>
                    <span>⏱️</span>
                    <span>{hours}h {mins}m total</span>
                </p>
            </div>
            {topRatedMovie && (
                <div className="top-rated">
                    <p>🏆 Top Rated: <strong>{topRatedMovie.title}</strong> ({topRatedMovie.userRating}⭐)</p>
                </div>
            )}
        </div>
    );
}
