export default function NumResults({ movies }) {
  return (
    <p className="num-results">
      {movies.length > 0
        ? <>Found <strong>{movies.length}</strong> results</>
        : "Search to discover films"}
    </p>
  );
}
