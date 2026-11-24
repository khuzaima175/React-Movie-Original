import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ListPlus, Plus } from "lucide-react";
import { useApp } from "../context/AppContext";
import { getListsContainingMovie } from "../services/listsService";
import "../styles/lists.css";

export default function AddToListPopover({ movie }) {
  const {
    customLists = [],
    createCustomListAction,
    toggleMovieInListAction
  } = useApp();

  const [isOpen, setIsOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const containerRef = useRef(null);

  const containingLists = useMemo(
    () => getListsContainingMovie(customLists, movie),
    [customLists, movie]
  );
  const containingIds = useMemo(
    () => new Set(containingLists.map((l) => l.id)),
    [containingLists]
  );

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const handleKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleKey, true);
    };
  }, [isOpen]);

  const handleCreateAndAdd = (e) => {
    e.preventDefault();
    const cleaned = newListName.trim();
    if (!cleaned || !createCustomListAction) return;
    createCustomListAction({
      name: cleaned,
      initialItems: movie ? [movie] : []
    });
    setNewListName("");
  };

  if (!movie) return null;

  return (
    <div ref={containerRef} className="add-to-list-anchor">
      <button
        type="button"
        className={`btn-vault-secondary add-to-list-trigger ${containingLists.length > 0 ? "has-lists" : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <ListPlus size={16} aria-hidden="true" />
        <span>
          {containingLists.length > 0
            ? `In ${containingLists.length} List${containingLists.length === 1 ? "" : "s"}`
            : "Save to List"}
        </span>
      </button>

      {isOpen && (
        <div className="add-to-list-popover" role="dialog" aria-label="Save film to custom lists">
          <div className="add-to-list-head">
            <span>Add to Custom List</span>
          </div>

          <div className="add-to-list-items">
            {customLists.length === 0 ? (
              <p className="add-to-list-empty">No lists yet. Create your first themed list below.</p>
            ) : (
              customLists.map((list) => {
                const checked = containingIds.has(list.id);
                return (
                  <button
                    key={list.id}
                    type="button"
                    className={`add-to-list-row ${checked ? "is-checked" : ""}`}
                    onClick={() => toggleMovieInListAction(list.id, movie)}
                  >
                    <span className="add-to-list-check" aria-hidden="true">
                      {checked && <Check size={12} />}
                    </span>
                    <span className="add-to-list-name">{list.name}</span>
                    <span className="add-to-list-count tabular-num">{list.items?.length || 0}</span>
                  </button>
                );
              })
            )}
          </div>

          <form className="add-to-list-create" onSubmit={handleCreateAndAdd}>
            <input
              type="text"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="+ Create list..."
              aria-label="New custom list name"
              maxLength={80}
            />
            <button type="submit" disabled={!newListName.trim()} aria-label="Create list and add film">
              <Plus size={14} aria-hidden="true" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
