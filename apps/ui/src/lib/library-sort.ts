import type { ItemSort } from "@citegeist/ops";
import { useCallback, useState } from "react";

/** How the library table is ordered. The core sorts the whole scope, not the loaded page. */
export interface LibrarySort {
  sort: ItemSort;
  order: "asc" | "desc";
}

/** Date added, newest first. */
export const DEFAULT_SORT: LibrarySort = { sort: "added", order: "desc" };

const KEY = "citegeist.librarySort";
const SORTS: readonly ItemSort[] = ["added", "title", "authors", "year", "type", "status"];

/** The order a column starts with when it is clicked: newest first for dates, A to Z otherwise. */
export function firstOrder(sort: ItemSort): LibrarySort["order"] {
  return sort === "added" ? "desc" : "asc";
}

/** The sort after a click on a column header: the same column flips, another one starts fresh. */
export function nextSort(current: LibrarySort, column: ItemSort): LibrarySort {
  if (current.sort !== column) return { sort: column, order: firstOrder(column) };
  return { sort: column, order: current.order === "asc" ? "desc" : "asc" };
}

export function loadLibrarySort(): LibrarySort {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SORT;
    const value = JSON.parse(raw) as Partial<LibrarySort>;
    const sort = SORTS.find((s) => s === value.sort);
    if (!sort || (value.order !== "asc" && value.order !== "desc")) return DEFAULT_SORT;
    return { sort, order: value.order };
  } catch {
    return DEFAULT_SORT;
  }
}

/** The chosen sort, kept in localStorage so that the next start shows the same order. */
export function useLibrarySort(): [LibrarySort, (next: LibrarySort) => void] {
  const [sort, setSort] = useState<LibrarySort>(loadLibrarySort);
  const update = useCallback((next: LibrarySort) => {
    setSort(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // storage full or blocked: the choice holds until the window closes
    }
  }, []);
  return [sort, update];
}
