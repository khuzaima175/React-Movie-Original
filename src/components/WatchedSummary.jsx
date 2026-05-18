import { motion } from "framer-motion";

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

    // Find all movies with max user rating
    const maxRating = watched.length > 0
        ? Math.max(...watched.map(m => m.userRating || 0))
        : 0;
    const topRatedMovies = watched.filter(m => m.userRating === maxRating);

    const stats = [
        { icon: "🎬", value: watched.length, label: "movies" },
        { icon: "⭐", value: watched.length > 0 ? avgImdbRating : "0.0", label: "IMDb" },
        { icon: "🌟", value: watched.length > 0 ? avgUserRating : "0.0", label: "Your avg" },
        { icon: "⏱️", value: `${hours}h ${mins}m`, label: "watched" },
    ];

    return (
        <motion.div
            className="summary"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
        >
            <h2>Your Movie Stats</h2>
            <div className="stats-grid">
                {stats.map((stat, index) => (
                    <motion.div
                        key={index}
                        className="stat-card"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: index * 0.1 }}
                        whileHover={{ scale: 1.05, y: -2 }}
                    >
                        <span className="stat-icon">{stat.icon}</span>
                        <span className="stat-value">{stat.value}</span>
                        <span className="stat-label">{stat.label}</span>
                    </motion.div>
                ))}
            </div>
            {topRatedMovies.length > 0 && maxRating > 0 && (
                <motion.div
                    className="top-rated"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                >
                    <span className="trophy">🏆</span>
                    <span className="top-label">Top Rated:</span>
                    <div className="top-movies">
                        {topRatedMovies.slice(0, 3).map((movie, i) => (
                            <span key={movie.imdbID} className="top-movie-name">
                                {movie.title}
                                {i < topRatedMovies.slice(0, 3).length - 1 && ", "}
                            </span>
                        ))}
                        {topRatedMovies.length > 3 && (
                            <span className="more-movies">+{topRatedMovies.length - 3} more</span>
                        )}
                    </div>
                    <span className="top-rating">{maxRating}⭐</span>
                </motion.div>
            )}
        </motion.div>
    );
}
