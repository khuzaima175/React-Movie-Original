import { useEffect, useRef } from "react";

export default function Search({ query, setQuery, type, setType }) {
    const inputRef = useRef(null);

    useEffect(() => {
        function callback(e) {
            if (document.activeElement === inputRef.current) return;
            if (e.code === "Slash") {
                e.preventDefault();
                inputRef.current.focus();
                setQuery("");
            }
        }

        document.addEventListener("keydown", callback);
        return () => document.removeEventListener("keydown", callback);
    }, [setQuery]);

    return (
        <div className="search-container">
            <input
                className="search"
                type="text"
                placeholder="Search movies or series..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                ref={inputRef}
            />
            <select
                className="type-filter"
                value={type}
                onChange={(e) => setType(e.target.value)}
            >
                <option value="">All</option>
                <option value="movie">Movies</option>
                <option value="series">Series</option>
            </select>
        </div>
    );
}
