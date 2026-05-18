import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const movieFacts = [
    "The first movie ever made was in 1888 and lasted just 2.11 seconds! 📽️",
    "Avatar (2009) held the highest-grossing film record for 10 years! 💰",
    "The Wilhelm Scream has been used in over 400 films and shows! 😱",
    "The Lion King was originally called 'King of the Jungle' 🦁",
    "Titanic was the first film to cost $200 million to make! 🚢",
    "Mad Max: Fury Road had over 480 hours of footage to edit! 🎬",
    "The Sound of Music is Austria's most successful tourism ad! 🎵",
    "Pixar's Up took 4 years to develop the first 10 minutes! 🎈",
];

const suggestedSearches = [
    "Inception", "The Dark Knight", "Interstellar",
    "Pulp Fiction", "The Godfather", "Fight Club"
];

export default function EmptyState({ message, icon, onSearch }) {
    const [currentFact, setCurrentFact] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentFact((prev) => (prev + 1) % movieFacts.length);
        }, 5000);
        return () => clearInterval(interval);
    }, []);

    return (
        <motion.div
            className="empty-state-enhanced"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
        >
            <motion.div
                className="empty-icon"
                animate={{
                    scale: [1, 1.1, 1],
                    rotate: [0, 5, -5, 0]
                }}
                transition={{
                    duration: 3,
                    repeat: Infinity,
                    repeatType: "reverse"
                }}
            >
                {icon}
            </motion.div>

            <p className="empty-message">{message}</p>

            <div className="movie-fact-container">
                <span className="fact-label">💡 Did you know?</span>
                <AnimatePresence mode="wait">
                    <motion.p
                        key={currentFact}
                        className="movie-fact"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.3 }}
                    >
                        {movieFacts[currentFact]}
                    </motion.p>
                </AnimatePresence>
            </div>

            <div className="suggested-searches">
                <span className="suggest-label">Try searching:</span>
                <div className="search-chips">
                    {suggestedSearches.map((term, index) => (
                        <motion.button
                            key={term}
                            className="search-chip"
                            whileHover={{ scale: 1.05, y: -2 }}
                            whileTap={{ scale: 0.95 }}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.1 }}
                            onClick={() => onSearch?.(term)}
                        >
                            {term}
                        </motion.button>
                    ))}
                </div>
            </div>
        </motion.div>
    );
}
