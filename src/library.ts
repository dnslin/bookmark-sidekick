import type { Bookmark } from './domain.ts';

export type LibraryScope = 'all' | 'later';
export type ReadingFilter = 'pending' | 'read';

export function groupBookmarksByDate(bookmarks: Bookmark[], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  const groups = new Map<string, Bookmark[]>();
  for (const bookmark of bookmarks) {
    const label = bookmark.addedAt >= today ? '今天' : bookmark.addedAt >= yesterday ? '昨天' : '更早';
    const group = groups.get(label) ?? [];
    group.push(bookmark);
    groups.set(label, group);
  }
  return [...groups].map(([label, bookmarks]) => ({ label, bookmarks }));
}

export function filterBookmarks(bookmarks: Bookmark[], category: string | null, tag: string, scope: LibraryScope = 'all', reading: ReadingFilter = 'pending') {
  return bookmarks.filter(bookmark => (category === null || bookmark.category === category)
    && (!tag || bookmark.tags.includes(tag))
    && (scope === 'all' || (reading === 'read' ? bookmark.readingState === 'read' : ['later', 'reading'].includes(bookmark.readingState))));
}

export function groupBookmarksForReading(bookmarks: Bookmark[]) {
  const sorted = [...bookmarks].sort((a, b) => b.addedAt - a.addedAt);
  return ([['reading', '阅读中'], ['later', '待读'], ['read', '已读']] as const)
    .map(([state, label]) => ({ label, bookmarks: sorted.filter(bookmark => bookmark.readingState === state) }))
    .filter(group => group.bookmarks.length);
}
