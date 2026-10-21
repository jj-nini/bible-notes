export interface ReaderState {
  book: string;
  chapter: number;
  v1: string;
  v2: string;
  parallel: boolean;
  ko: boolean;
  size: number;
  /** Verse to highlight and scroll to (set when arriving from search). */
  hl: number | null;
  fromSearch: boolean;
}

export type SearchMode = "topic" | "keyword";

export interface SearchQuery {
  q: string;
  mode: SearchMode;
  /** Bumps on every submit so the same query can be re-run. */
  nonce: number;
}

export const READER_SIZES = ["16px", "18px", "20px", "22px"];

const KEY = "bible-notes:reader";

export const defaultReader: ReaderState = {
  book: "PHP", chapter: 4, v1: "KRV", v2: "AMP", parallel: false, ko: false, size: 1, hl: null, fromSearch: false,
};

/** Restores where the reader left off (a per-browser convenience only). */
export function loadReader(): ReaderState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaultReader, ...JSON.parse(raw), hl: null, fromSearch: false };
  } catch {
    /* ignore */
  }
  return defaultReader;
}

export function saveReader(s: ReaderState) {
  try {
    const { book, chapter, v1, v2, parallel, size } = s;
    localStorage.setItem(KEY, JSON.stringify({ book, chapter, v1, v2, parallel, size }));
  } catch {
    /* ignore */
  }
}
