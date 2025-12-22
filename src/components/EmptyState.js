export default function EmptyState({ message, icon }) {
    return (
        <p className="empty-state">
            <span>{icon}</span>
            <span>{message}</span>
        </p>
    );
}
