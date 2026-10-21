import Fuse from 'fuse.js';
import { cleanUrl, isWebUrl } from './domain';
import type { Bookmark, Snapshot } from './domain';

export type SearchBookmark = Pick<Bookmark, 'id' | 'title' | 'url' | 'category' | 'tags' | 'summary' | 'addedAt'>;
export type SearchSnapshot = Pick<Snapshot, 'bookmarkId' | 'url' | 'text' | 'capturedAt'>;
export interface SearchHit {
  bookmarkId: string;
  /** UTF-16 offsets into text, with an exclusive end. */
  snippet?: { text: string; ranges: [number, number][] };
}
export interface SearchResult { hits: SearchHit[]; terms: string[]; snapshotCount: number }
export interface SearchRequest { id: number; query: string; bookmarks: SearchBookmark[] }
export type SearchResponse =
  | ({ type: 'result'; id: number } & SearchResult)
  | { type: 'loading'; id: number }
  | { type: 'error'; id: number; error: string };

export function toSearchBookmarks(bookmarks: SearchBookmark[]): SearchBookmark[] {
  return bookmarks.map(({ id, title, url, category, tags, summary, addedAt }) => ({ id, title, url, category, tags: [...tags], summary, addedAt }));
}

export function sameSearchBookmarks(left: SearchBookmark[], right: SearchBookmark[]): boolean {
  return left.length === right.length && left.every((a, index) => {
    const b = right[index]!;
    return a.id === b.id && a.title === b.title && a.url === b.url && a.category === b.category && a.summary === b.summary && a.addedAt === b.addedAt &&
      a.tags.length === b.tags.length && a.tags.every((tag, i) => tag === b.tags[i]);
  });
}

function snippet(text: string, ranges: [number, number][]): SearchHit['snippet'] {
  if (!ranges.length) return undefined;
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let start = Math.max(0, ranges[0]![0] - 36);
  let end = Math.min(text.length, start + 110);
  if (start && /[\uDC00-\uDFFF]/.test(text[start]!)) start--;
  if (end < text.length && /[\uDC00-\uDFFF]/.test(text[end]!)) end--;
  const prefix = start > 0 ? '…' : '';
  const selected: [number, number][] = [];
  for (const [from, to] of ranges) {
    if (from >= end) break;
    if (to <= start) continue;
    const range: [number, number] = [Math.max(start, from) - start + prefix.length, Math.min(end, to) - start + prefix.length];
    const previous = selected.at(-1);
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else selected.push(range);
  }
  return { text: prefix + text.slice(start, end) + (end < text.length ? '…' : ''), ranges: selected };
}

export function createLibrarySearch(initialBookmarks: SearchBookmark[] = [], initialSnapshots: SearchSnapshot[] = []) {
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  const tokenize = (text: string) => [...segmenter.segment(text)].filter(part => part.isWordLike).map(part => part.segment.toLocaleLowerCase());
  let bookmarks: SearchBookmark[] = [];
  let byId = new Map<string, SearchBookmark>();
  const snapshots = new Map<string, SearchSnapshot>();
  const searchableSnapshots = new Set<string>();
  let metadataIndex: Fuse<SearchBookmark> | undefined;
  let bodyIndex: Fuse<SearchSnapshot> | undefined;

  function updateSnapshotEligibility(id: string) {
    const bookmark = byId.get(id);
    const saved = snapshots.get(id);
    if (bookmark && saved?.text.trim() && isWebUrl(bookmark.url) && isWebUrl(saved.url) && cleanUrl(bookmark.url) === cleanUrl(saved.url)) searchableSnapshots.add(id);
    else searchableSnapshots.delete(id);
  }
  function setBookmarks(values: SearchBookmark[]) {
    if (sameSearchBookmarks(bookmarks, values)) return;
    const previous = byId;
    bookmarks = toSearchBookmarks(values);
    byId = new Map(bookmarks.map(bookmark => [bookmark.id, bookmark]));
    metadataIndex = undefined;
    for (const id of snapshots.keys()) if (previous.get(id)?.url !== byId.get(id)?.url) updateSnapshotEligibility(id);
  }
  function setSnapshot(value: SearchSnapshot) {
    const previous = snapshots.get(value.bookmarkId);
    if (previous && previous.url === value.url && previous.text === value.text && previous.capturedAt === value.capturedAt) return;
    const saved = { bookmarkId: value.bookmarkId, url: value.url, text: value.text, capturedAt: value.capturedAt };
    snapshots.set(saved.bookmarkId, saved);
    if (bodyIndex) {
      if (previous) bodyIndex.remove(item => item.bookmarkId === saved.bookmarkId);
      bodyIndex.add(saved);
    }
    updateSnapshotEligibility(saved.bookmarkId);
  }
  function removeSnapshot(id: string) {
    snapshots.delete(id); searchableSnapshots.delete(id);
    bodyIndex?.remove(item => item.bookmarkId === id);
  }
  function search(query: string): SearchResult {
    const terms = [...new Set(tokenize(query.trim()))];
    if (!terms.length) return { hits: [], terms, snapshotCount: searchableSnapshots.size };
    metadataIndex ??= new Fuse(bookmarks, {
      keys: [{ name: 'title', weight: 3 }, 'url', 'category', 'tags', 'summary'],
      threshold: 0.36, ignoreLocation: true, useTokenSearch: true, tokenize, includeMatches: true, includeScore: true,
    });
    bodyIndex ??= new Fuse([...snapshots.values()], {
      keys: ['text'], threshold: 0, ignoreLocation: true, useExtendedSearch: true, includeMatches: true, includeScore: true,
    });
    const found = new Map<string, { terms: Set<string>; group: number; score: number; ranges: [number, number][] }>();
    for (const term of terms) {
      const perTerm = new Map<string, { group: number; score: number; ranges: [number, number][] }>();
      for (const result of metadataIndex.search(term)) {
        const group = result.matches?.some(match => match.key === 'title' || match.key === 'tags') ? 0 : 1;
        perTerm.set(result.item.id, { group, score: result.score ?? 1, ranges: [] });
      }
      // Fuse 7.5 accepts include-match string leaves, not $contains object operators.
      // Quoting the segmented term keeps punctuation literal and never exposes query operators.
      for (const result of bodyIndex.search({ text: `'"${term.replaceAll('|', '\\|')}"` })) {
        const id = result.item.bookmarkId;
        if (!searchableSnapshots.has(id)) continue;
        const metadata = perTerm.get(id);
        const indices = result.matches?.[0]?.indices ?? [];
        const first = indices[0]?.[0] ?? 0;
        const ranges: [number, number][] = [];
        for (const [from, to] of indices) {
          if (from > first + 110) break;
          ranges.push([from, to + 1]);
        }
        perTerm.set(id, { group: metadata?.group ?? 2, score: metadata?.score ?? result.score ?? 1, ranges });
      }
      for (const [id, match] of perTerm) {
        const previous = found.get(id);
        if (previous) {
          previous.terms.add(term); previous.group = Math.min(previous.group, match.group); previous.score += match.score; previous.ranges.push(...match.ranges);
        } else found.set(id, { terms: new Set([term]), ...match });
      }
    }
    const hits = [...found.entries()].filter(([, match]) => match.terms.size === terms.length)
      .sort(([leftId, left], [rightId, right]) => left.group - right.group || left.score - right.score || byId.get(rightId)!.addedAt - byId.get(leftId)!.addedAt)
      .map(([bookmarkId, match]) => {
        const saved = snapshots.get(bookmarkId);
        const excerpt = saved && match.ranges.length ? snippet(saved.text, match.ranges) : undefined;
        return { bookmarkId, ...(excerpt ? { snippet: excerpt } : {}) };
      });
    return { hits, terms, snapshotCount: searchableSnapshots.size };
  }
  setBookmarks(initialBookmarks);
  initialSnapshots.forEach(setSnapshot);
  return { setBookmarks, setSnapshot, removeSnapshot, search };
}
