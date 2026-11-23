import assert from "node:assert/strict";
import test from "node:test";
import {
  NAMED_WATCHLIST_STORAGE_KEY,
  MAX_NAMED_WATCHLISTS,
  addWatchlistSymbol,
  createEmptyNamedWatchlistCollection,
  createNamedWatchlist,
  deleteNamedWatchlist,
  moveWatchlistSymbol,
  parseNamedWatchlistCollection,
  readNamedWatchlistCollection,
  removeWatchlistSymbol,
  renameNamedWatchlist,
  selectNamedWatchlist,
  updateWatchlistItemNote,
  writeNamedWatchlistCollection,
} from "../src/features/workspace/named-watchlists.js";
import type { KeyValueStorage } from "../src/features/workspace/workspace-storage.js";

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function createList(name = "Favorites", id = "list-1", market: "crypto" | "forex" = "crypto") {
  return createNamedWatchlist(createEmptyNamedWatchlistCollection(), market, name, id, 100);
}

test("creates named lists and selects them independently by market", () => {
  let collection = createList();
  collection = createNamedWatchlist(collection, "forex", "Favorites", "forex-list", 101);
  assert.equal(collection.activeListIds.crypto, "list-1");
  assert.equal(collection.activeListIds.forex, "forex-list");
  assert.equal(collection.lists.length, 2);
  assert.throws(() => createNamedWatchlist(collection, "crypto", "favorites", "duplicate", 102), /already exists/);
  assert.throws(() => createNamedWatchlist(collection, "crypto", "Other", "list-1", 102), /ID already exists/);
  collection = selectNamedWatchlist(collection, "crypto", null);
  assert.equal(collection.activeListIds.crypto, null);
  assert.throws(() => selectNamedWatchlist(collection, "crypto", "forex-list"), /does not belong/);
});

test("adds, reorders, annotates and removes supported symbols deterministically", () => {
  let collection = createList();
  collection = addWatchlistSymbol(collection, "list-1", "BTCUSDT", 101);
  collection = addWatchlistSymbol(collection, "list-1", "ETHUSDT", 102);
  assert.deepEqual(collection.lists[0]?.items.map((item) => item.symbol), ["BTCUSDT", "ETHUSDT"]);
  collection = moveWatchlistSymbol(collection, "list-1", "ETHUSDT", "up", 103);
  assert.deepEqual(collection.lists[0]?.items.map((item) => item.symbol), ["ETHUSDT", "BTCUSDT"]);
  collection = updateWatchlistItemNote(collection, "list-1", "ETHUSDT", "Wait for a clean retest.", 104);
  assert.equal(collection.lists[0]?.items[0]?.note, "Wait for a clean retest.");
  collection = removeWatchlistSymbol(collection, "list-1", "BTCUSDT", 105);
  assert.deepEqual(collection.lists[0]?.items.map((item) => item.symbol), ["ETHUSDT"]);
  assert.throws(() => addWatchlistSymbol(collection, "list-1", "UNKNOWN", 106), /not supported/);
  assert.throws(() => updateWatchlistItemNote(collection, "list-1", "ETHUSDT", "x".repeat(161), 106), /too long/);
});

test("renames and deletes lists without leaving invalid active IDs", () => {
  let collection = createList();
  collection = createNamedWatchlist(collection, "crypto", "Breakouts", "list-2", 101);
  collection = renameNamedWatchlist(collection, "list-1", "Long-term", 102);
  assert.equal(collection.lists.find((list) => list.id === "list-1")?.name, "Long-term");
  collection = deleteNamedWatchlist(collection, "list-2");
  assert.equal(collection.activeListIds.crypto, "list-1");
  collection = deleteNamedWatchlist(collection, "list-1");
  assert.equal(collection.activeListIds.crypto, null);
  assert.equal(collection.lists.length, 0);
});

test("watchlist order operations are safe at boundaries and timestamps cannot move backward", () => {
  const collection = addWatchlistSymbol(createList(), "list-1", "BTCUSDT", 101);
  const unchanged = moveWatchlistSymbol(collection, "list-1", "BTCUSDT", "up", 102);
  assert.equal(unchanged, collection);
  assert.throws(() => renameNamedWatchlist(collection, "list-1", "Renamed", 99), /timestamp/);
  assert.throws(() => addWatchlistSymbol(collection, "list-1", "ETHUSDT", 100), /timestamp/);
});

test("named watchlist storage round-trips and preserves unknown future data", () => {
  const storage = new MemoryStorage();
  const collection = addWatchlistSymbol(createList(), "list-1", "BTCUSDT", 101);
  assert.equal(writeNamedWatchlistCollection(storage, collection), true);
  assert.deepEqual(readNamedWatchlistCollection(storage), collection);
  assert.equal(parseNamedWatchlistCollection("{"), null);
  const original = JSON.stringify({ schemaVersion: 99, collection: {} });
  storage.setItem(NAMED_WATCHLIST_STORAGE_KEY, original);
  assert.equal(writeNamedWatchlistCollection(storage, collection), false);
  assert.equal(storage.getItem(NAMED_WATCHLIST_STORAGE_KEY), original);
});

test("watchlist collection rejects invalid active IDs and duplicate symbols", () => {
  const collection = addWatchlistSymbol(createList(), "list-1", "BTCUSDT", 101);
  const invalidActive = {
    schemaVersion: 1,
    collection: {
      ...collection,
      activeListIds: { ...collection.activeListIds, crypto: "missing" },
    },
  };
  assert.equal(parseNamedWatchlistCollection(JSON.stringify(invalidActive)), null);
  const firstItem = collection.lists[0]?.items[0];
  assert.ok(firstItem);
  const duplicateSymbols = {
    schemaVersion: 1,
    collection: {
      ...collection,
      lists: collection.lists.map((list) => ({
        ...list,
        items: [...list.items, { ...firstItem, addedAt: 102 }],
      })),
    },
  };
  assert.equal(parseNamedWatchlistCollection(JSON.stringify(duplicateSymbols)), null);
});

test("named watchlist count is bounded", () => {
  let collection = createEmptyNamedWatchlistCollection();
  for (let index = 0; index < MAX_NAMED_WATCHLISTS; index += 1) {
    collection = createNamedWatchlist(collection, "crypto", `List ${index}`, `list-${index}`, 100 + index);
  }
  assert.throws(() => createNamedWatchlist(collection, "forex", "Overflow", "overflow", 200), /limit reached/);
});
