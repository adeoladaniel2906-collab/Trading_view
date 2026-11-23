import { useEffect, useState } from "react";
import type { LiveMarketName } from "@market/contracts";
import type { NamedWatchlistCollection } from "./named-watchlists";

interface NamedWatchlistManagerProps {
  readonly market: LiveMarketName;
  readonly activeSymbol: string;
  readonly collection: NamedWatchlistCollection;
  readonly storageStatus: "saved" | "unavailable";
  readonly actionStatus: string | null;
  readonly onSelectSymbol: (symbol: string) => void;
  readonly onCreateList: (name: string) => boolean;
  readonly onSelectList: (listId: string | null) => void;
  readonly onRenameList: (listId: string, name: string) => boolean;
  readonly onDeleteList: (listId: string) => void;
  readonly onAddSymbol: (listId: string, symbol: string) => boolean;
  readonly onRemoveSymbol: (listId: string, symbol: string) => void;
  readonly onMoveSymbol: (listId: string, symbol: string, direction: "up" | "down") => void;
  readonly onUpdateNote: (listId: string, symbol: string, note: string) => void;
}

export function NamedWatchlistManager({
  market,
  activeSymbol,
  collection,
  storageStatus,
  actionStatus,
  onSelectSymbol,
  onCreateList,
  onSelectList,
  onRenameList,
  onDeleteList,
  onAddSymbol,
  onRemoveSymbol,
  onMoveSymbol,
  onUpdateNote,
}: NamedWatchlistManagerProps) {
  const [newName, setNewName] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const marketLists = collection.lists.filter((list) => list.market === market);
  const selectedId = collection.activeListIds[market];
  const selectedList = marketLists.find((list) => list.id === selectedId) ?? null;

  useEffect(() => {
    setRenameDraft(selectedList?.name ?? "");
  }, [selectedList?.name]);

  return (
    <section className="named-watchlist-manager" aria-label={`${market} named watchlists`}>
      <div className="named-watchlist-heading">
        <div>
          <strong>Named watchlists</strong>
          <span>{market.toUpperCase()} · {marketLists.length} lists ({collection.lists.length}/20 total)</span>
        </div>
        <label>
          <span>Active list</span>
          <select value={selectedId ?? ""} onChange={(event) =>
            onSelectList(event.currentTarget.value || null)}>
            <option value="">Choose a watchlist</option>
            {marketLists.map((list) => (
              <option key={list.id} value={list.id}>{list.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="named-watchlist-create">
        <label>
          <span>New list name</span>
          <input
            type="text"
            value={newName}
            maxLength={40}
            placeholder="e.g. Breakout candidates"
            onChange={(event) => setNewName(event.currentTarget.value)}
          />
        </label>
        <button type="button" disabled={!newName.trim()} onClick={() => {
          if (onCreateList(newName)) setNewName("");
        }}>Create list</button>
      </div>

      {selectedList ? (
        <>
          <div className="named-watchlist-actions">
            <label>
              <span>Rename list</span>
              <input
                type="text"
                value={renameDraft}
                maxLength={40}
                onChange={(event) => setRenameDraft(event.currentTarget.value)}
              />
            </label>
            <button type="button" disabled={!renameDraft.trim() || renameDraft.trim() === selectedList.name}
              onClick={() => onRenameList(selectedList.id, renameDraft)}>Save name</button>
            <button type="button" onClick={() => onDeleteList(selectedList.id)}>Delete list</button>
            <button type="button" disabled={selectedList.items.some((item) => item.symbol === activeSymbol)}
              onClick={() => onAddSymbol(selectedList.id, activeSymbol)}>
              Add {activeSymbol}
            </button>
          </div>
          {selectedList.items.length === 0 ? (
            <p className="named-watchlist-empty">This list is empty. Add the active chart symbol to begin.</p>
          ) : (
            <ol className="named-watchlist-items">
              {selectedList.items.map((item, index) => (
                <li key={`${selectedList.id}:${item.symbol}`}>
                  <button type="button" className="named-watchlist-symbol"
                    onClick={() => onSelectSymbol(item.symbol)}>{item.symbol}</button>
                  <label>
                    <span>Note</span>
                    <input
                      type="text"
                      defaultValue={item.note}
                      maxLength={160}
                      placeholder="Optional note"
                      onBlur={(event) => {
                        if (event.currentTarget.value !== item.note) {
                          onUpdateNote(selectedList.id, item.symbol, event.currentTarget.value);
                        }
                      }}
                    />
                  </label>
                  <div className="named-watchlist-item-actions">
                    <button type="button" aria-label={`Move ${item.symbol} up`} disabled={index === 0}
                      onClick={() => onMoveSymbol(selectedList.id, item.symbol, "up")}>↑</button>
                    <button type="button" aria-label={`Move ${item.symbol} down`}
                      disabled={index === selectedList.items.length - 1}
                      onClick={() => onMoveSymbol(selectedList.id, item.symbol, "down")}>↓</button>
                    <button type="button" aria-label={`Remove ${item.symbol}`}
                      onClick={() => onRemoveSymbol(selectedList.id, item.symbol)}>Remove</button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : (
        <p className="named-watchlist-empty">Create a list or choose an existing list for this market.</p>
      )}

      <p className="named-watchlist-storage" role="status">
        {storageStatus === "saved"
          ? "Named lists, order and notes are saved in this browser."
          : "Watchlist storage is unavailable or unsupported; existing data was preserved."}
      </p>
      {actionStatus ? <p className="named-watchlist-action-status" aria-live="polite">{actionStatus}</p> : null}
    </section>
  );
}
