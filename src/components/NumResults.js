export default function NumResults({ movies }) {
    return (
        <p className="num-results">
            Found&nbsp;<strong>{movies.length}</strong>&nbsp;results
        </p>
    );
}
