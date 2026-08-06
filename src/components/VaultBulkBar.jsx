import { Trash2, CheckCircle2, X, MoveRight, BookmarkCheck } from "lucide-react";

export default function VaultBulkBar({
  selectedCount = 0,
  totalItemsCount = 0,
  activeTab = "watched",
  onSelectAll,
  onDeselectAll,
  onBulkDelete,
  onBulkMove,
  onCancel,
}) {
  if (selectedCount === 0 && totalItemsCount === 0) return null;

  const isAllSelected = selectedCount > 0 && selectedCount === totalItemsCount;

  return (
    <div className="vault-bulk-floating-bar" role="toolbar" aria-label="Bulk Selection Actions">
      <div className="bulk-bar-info">
        <span className="bulk-selected-badge">{selectedCount}</span>
        <span className="bulk-selected-text">
          {selectedCount === 1 ? "item selected" : "items selected"}
        </span>
      </div>

      <div className="bulk-bar-actions">
        <button
          className="btn-bulk-text"
          onClick={isAllSelected ? onDeselectAll : onSelectAll}
        >
          <CheckCircle2 size={15} aria-hidden="true" />
          {isAllSelected ? "Deselect All" : "Select All"}
        </button>

        {activeTab === "watched" ? (
          <button
            className="btn-bulk-action secondary"
            disabled={selectedCount === 0}
            onClick={onBulkMove}
            title="Move selected items to Plan to Watch"
          >
            <BookmarkCheck size={15} aria-hidden="true" />
            Move to Watchlist
          </button>
        ) : (
          <button
            className="btn-bulk-action secondary"
            disabled={selectedCount === 0}
            onClick={onBulkMove}
            title="Mark selected items as Watched"
          >
            <MoveRight size={15} aria-hidden="true" />
            Mark as Watched
          </button>
        )}

        <button
          className="btn-bulk-action danger"
          disabled={selectedCount === 0}
          onClick={onBulkDelete}
          title="Remove selected items from vault"
        >
          <Trash2 size={15} aria-hidden="true" />
          Remove ({selectedCount})
        </button>

        <div className="bulk-divider" />

        <button className="btn-bulk-cancel" onClick={onCancel} title="Exit selection mode">
          <X size={16} aria-hidden="true" /> Cancel
        </button>
      </div>
    </div>
  );
}
