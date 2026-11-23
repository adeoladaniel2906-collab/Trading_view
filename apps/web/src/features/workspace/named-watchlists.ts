import type { LiveMarketName } from "@market/contracts";
import { SUPPORTED_SYMBOLS } from "./workspace-model";
import type { KeyValueStorage } from "./workspace-storage";

export const NAMED_WATCHLIST_STORAGE_KEY = "market-workspace.named-watchlists.v1";
export const NAMED_WATCHLIST_SCHEMA_VERSION = 1 as const;
export const MAX_NAMED_WATCHLISTS = 20;
export const MAX_WATCHLIST_ITEMS = 100;
export const MAX_WATCHLIST_NAME_LENGTH = 40;
export const MAX_WATCHLIST_NOTE_LENGTH = 160;
export const MAX_NAMED_WATCHLIST_STORAGE_CHARS = 500_000;

export interface NamedWatchlistItem {
  readonly symbol: string;
  readonly note: string;
  readonly addedAt: number;
}

export interface NamedWatchlist {
  readonly id: string;
  readonly name: string;
  readonly market: LiveMarketName;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly items: readonly NamedWatchlistItem[];
}

export interface NamedWatchlistCollection {
  readonly activeListIds: Readonly<Record<LiveMarketName, string | null>>;
  readonly lists: readonly NamedWatchlist[];
}

export function createEmptyNamedWatchlistCollection(): NamedWatchlistCollection {
  return { activeListIds: { crypto: null, forex: null }, lists: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isMarket(value: unknown): value is LiveMarketName {
  return value === "crypto" || value === "forex";
}

function isUniqueItems(items: readonly NamedWatchlistItem[]): boolean {
  return new Set(items.map((item) => item.symbol)).size === items.length;
}

export function isValidNamedWatchlist(value: unknown): value is NamedWatchlist {
  if (!isRecord(value)) return false;

  const id = value.id;
  const name = value.name;
  const market = value.market;
  const createdAt = value.createdAt;
  const updatedAt = value.updatedAt;
  const items = value.items;

  if (typeof id !== "string" || id.length < 1 || id.length > 128 ||
    typeof name !== "string" || name.length < 1 ||
    name.length > MAX_WATCHLIST_NAME_LENGTH || name !== name.trim() ||
    !isMarket(market) ||
    !isFiniteTimestamp(createdAt) || !isFiniteTimestamp(updatedAt) ||
    updatedAt < createdAt ||
    !Array.isArray(items) || items.length > MAX_WATCHLIST_ITEMS) return false;

  const supportedSymbols = SUPPORTED_SYMBOLS[market] as readonly string[];
  if (!items.every((item) => isRecord(item) &&
    typeof item.symbol === "string" &&
    supportedSymbols.includes(item.symbol) &&
    typeof item.note === "string" && item.note.length <= MAX_WATCHLIST_NOTE_LENGTH &&
    isFiniteTimestamp(item.addedAt) &&
    item.addedAt >= createdAt && item.addedAt <= updatedAt)) return false;
  return isUniqueItems(items as NamedWatchlistItem[]);
}

export function isValidNamedWatchlistCollection(value: unknown): value is NamedWatchlistCollection {
  if (!isRecord(value) || !isRecord(value.activeListIds) ||
    Object.keys(value.activeListIds).length !== 2 ||
    !Object.hasOwn(value.activeListIds, "crypto") ||
    !Object.hasOwn(value.activeListIds, "forex") ||
    !Array.isArray(value.lists) || value.lists.length > MAX_NAMED_WATCHLISTS ||
    !value.lists.every(isValidNamedWatchlist)) return false;

  const lists = value.lists as NamedWatchlist[];
  const ids = new Set(lists.map((list) => list.id));
  if (ids.size !== lists.length) return false;
  const names = new Set(lists.map((list) => `${list.market}:${list.name.toLocaleLowerCase("en-US")}`));
  if (names.size !== lists.length) return false;
  for (const market of ["crypto", "forex"] as const) {
    const activeId = value.activeListIds[market];
    if (activeId !== null &&
      (typeof activeId !== "string" || !lists.some((list) => list.id === activeId && list.market === market))) {
      return false;
    }
  }
  return true;
}

function withList(
  collection: NamedWatchlistCollection,
  updated: NamedWatchlist,
): NamedWatchlistCollection {
  return {
    ...collection,
    lists: collection.lists.map((list) => list.id === updated.id ? updated : list),
  };
}

function getList(collection: NamedWatchlistCollection, listId: string): NamedWatchlist {
  const list = collection.lists.find((item) => item.id === listId);
  if (!list) throw new RangeError("Named watchlist does not exist");
  return list;
}

function assertTimestamp(now: number, previous: number): void {
  if (!Number.isFinite(now) || now < previous) {
    throw new RangeError("Watchlist update timestamp is invalid");
  }
}

export function createNamedWatchlist(
  collection: NamedWatchlistCollection,
  market: LiveMarketName,
  name: string,
  id: string,
  now: number,
): NamedWatchlistCollection {
  const normalizedName = name.trim();
  if (!id || id.length > 128 || normalizedName.length < 1 ||
    normalizedName.length > MAX_WATCHLIST_NAME_LENGTH || !Number.isFinite(now) || now < 0) {
    throw new RangeError("Watchlist name or identity is invalid");
  }
  if (collection.lists.some((list) => list.id === id)) {
    throw new RangeError("Named watchlist ID already exists");
  }
  if (collection.lists.length >= MAX_NAMED_WATCHLISTS) {
    throw new RangeError("Named watchlist limit reached");
  }
  const duplicate = collection.lists.some((list) =>
    list.market === market && list.name.toLocaleLowerCase("en-US") === normalizedName.toLocaleLowerCase("en-US"));
  if (duplicate) throw new RangeError("A watchlist with this name already exists for this market");
  const list: NamedWatchlist = {
    id,
    name: normalizedName,
    market,
    createdAt: now,
    updatedAt: now,
    items: [],
  };
  return {
    activeListIds: { ...collection.activeListIds, [market]: id },
    lists: [list, ...collection.lists],
  };
}

export function selectNamedWatchlist(
  collection: NamedWatchlistCollection,
  market: LiveMarketName,
  listId: string | null,
): NamedWatchlistCollection {
  if (listId !== null && !collection.lists.some((list) => list.id === listId && list.market === market)) {
    throw new RangeError("Selected watchlist does not belong to this market");
  }
  return {
    ...collection,
    activeListIds: { ...collection.activeListIds, [market]: listId },
  };
}

export function renameNamedWatchlist(
  collection: NamedWatchlistCollection,
  listId: string,
  name: string,
  now: number,
): NamedWatchlistCollection {
  const list = getList(collection, listId);
  const normalizedName = name.trim();
  assertTimestamp(now, list.updatedAt);
  if (normalizedName.length < 1 || normalizedName.length > MAX_WATCHLIST_NAME_LENGTH) {
    throw new RangeError("Watchlist name is invalid");
  }
  if (collection.lists.some((item) =>
    item.id !== listId && item.market === list.market &&
    item.name.toLocaleLowerCase("en-US") === normalizedName.toLocaleLowerCase("en-US"))) {
    throw new RangeError("A watchlist with this name already exists for this market");
  }
  return withList(collection, { ...list, name: normalizedName, updatedAt: now });
}

export function deleteNamedWatchlist(
  collection: NamedWatchlistCollection,
  listId: string,
): NamedWatchlistCollection {
  const list = getList(collection, listId);
  const lists = collection.lists.filter((item) => item.id !== listId);
  const activeListIds = collection.activeListIds[list.market] === listId
    ? { ...collection.activeListIds, [list.market]: lists.find((item) => item.market === list.market)?.id ?? null }
    : collection.activeListIds;
  return { activeListIds, lists };
}

export function addWatchlistSymbol(
  collection: NamedWatchlistCollection,
  listId: string,
  symbol: string,
  now: number,
): NamedWatchlistCollection {
  const list = getList(collection, listId);
  assertTimestamp(now, list.updatedAt);
  if (!(SUPPORTED_SYMBOLS[list.market] as readonly string[]).includes(symbol)) {
    throw new RangeError("Symbol is not supported for this watchlist market");
  }
  if (list.items.some((item) => item.symbol === symbol)) {
    throw new RangeError("Symbol is already in this watchlist");
  }
  if (list.items.length >= MAX_WATCHLIST_ITEMS) throw new RangeError("Watchlist item limit reached");
  return withList(collection, {
    ...list,
    updatedAt: now,
    items: [...list.items, { symbol, note: "", addedAt: now }],
  });
}

export function removeWatchlistSymbol(
  collection: NamedWatchlistCollection,
  listId: string,
  symbol: string,
  now: number,
): NamedWatchlistCollection {
  const list = getList(collection, listId);
  assertTimestamp(now, list.updatedAt);
  return withList(collection, {
    ...list,
    updatedAt: now,
    items: list.items.filter((item) => item.symbol !== symbol),
  });
}

export function moveWatchlistSymbol(
  collection: NamedWatchlistCollection,
  listId: string,
  symbol: string,
  direction: "up" | "down",
  now: number,
): NamedWatchlistCollection {
  const list = getList(collection, listId);
  assertTimestamp(now, list.updatedAt);
  const index = list.items.findIndex((item) => item.symbol === symbol);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= list.items.length) return collection;
  const items = [...list.items];
  [items[index], items[targetIndex]] = [items[targetIndex]!, items[index]!];
  return withList(collection, { ...list, items, updatedAt: now });
}

export function updateWatchlistItemNote(
  collection: NamedWatchlistCollection,
  listId: string,
  symbol: string,
  note: string,
  now: number,
): NamedWatchlistCollection {
  const list = getList(collection, listId);
  assertTimestamp(now, list.updatedAt);
  if (note.length > MAX_WATCHLIST_NOTE_LENGTH) throw new RangeError("Watchlist note is too long");
  if (!list.items.some((item) => item.symbol === symbol)) throw new RangeError("Watchlist symbol does not exist");
  return withList(collection, {
    ...list,
    updatedAt: now,
    items: list.items.map((item) => item.symbol === symbol ? { ...item, note } : item),
  });
}

export function parseNamedWatchlistCollection(serialized: string | null): NamedWatchlistCollection | null {
  if (!serialized || serialized.length > MAX_NAMED_WATCHLIST_STORAGE_CHARS) return null;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed) || parsed.schemaVersion !== NAMED_WATCHLIST_SCHEMA_VERSION ||
      !isValidNamedWatchlistCollection(parsed.collection)) return null;
    return parsed.collection;
  } catch {
    return null;
  }
}

export function readNamedWatchlistCollection(storage: KeyValueStorage | null): NamedWatchlistCollection {
  if (!storage) return createEmptyNamedWatchlistCollection();
  try {
    return parseNamedWatchlistCollection(storage.getItem(NAMED_WATCHLIST_STORAGE_KEY)) ??
      createEmptyNamedWatchlistCollection();
  } catch {
    return createEmptyNamedWatchlistCollection();
  }
}

export function writeNamedWatchlistCollection(
  storage: KeyValueStorage | null,
  collection: NamedWatchlistCollection,
): boolean {
  if (!storage || !isValidNamedWatchlistCollection(collection)) return false;
  const serialized = JSON.stringify({
    schemaVersion: NAMED_WATCHLIST_SCHEMA_VERSION,
    collection,
  });
  if (serialized.length > MAX_NAMED_WATCHLIST_STORAGE_CHARS ||
    !parseNamedWatchlistCollection(serialized)) return false;
  try {
    const existing = storage.getItem(NAMED_WATCHLIST_STORAGE_KEY);
    if (existing !== null && !parseNamedWatchlistCollection(existing)) return false;
    storage.setItem(NAMED_WATCHLIST_STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}
