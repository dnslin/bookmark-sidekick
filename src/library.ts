import type { Bookmark } from './domain.ts';

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

export function filterBookmarks(bookmarks: Bookmark[], category: string | null, tag: string) {
  return bookmarks.filter(bookmark => (category === null || bookmark.category === category) && (!tag || bookmark.tags.includes(tag)));
}
