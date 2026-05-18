import { useState } from "react";

export default function RandomPicker({ watchlist, onSelectMovie }) {
    const [pickedMovie, setPickedMovie] = useState(null);
    const [isSpinning, setIsSpinning] = useState(false);

    function handlePick() {
        if (watchlist.length === 0) return;

        setIsSpinning(true);
        setPickedMovie(null);

        // Simulate spinning animation
        let counter = 0;
        const interval = setInterval(() => {
            const randomIndex = Math.floor(Math.random() * watchlist.length);
            setPickedMovie(watchlist[randomIndex]);
            counter++;
            if (counter > 10) {
                clearInterval(interval);
                setIsSpinning(false);
            }
        }, 100);
    }

    if (watchlist.length === 0) {
        return null;
    }

    return (
        <div className="random-picker">
            <button
                className="btn-random"
                onClick={handlePick}
                disabled={isSpinning}
            >
                🎲 {isSpinning ? "Picking..." : "Pick Random Movie"}
            </button>

            {pickedMovie && !isSpinning && (
                <div
                    className="picked-movie"
                    onClick={() => onSelectMovie(pickedMovie.imdbID)}
                >
                    <img src={pickedMovie.poster} alt={pickedMovie.title} />
                    <div className="picked-info">
                        <p className="picked-title">{pickedMovie.title}</p>
                        <p className="picked-meta">Watch this tonight! 🍿</p>
                    </div>
                </div>
            )}
        </div>
    );
}
