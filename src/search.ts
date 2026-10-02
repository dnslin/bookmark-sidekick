import Fuse from 'fuse.js';
import type { Bookmark } from './domain';

export function createBookmarkSearch(bookmarks: Bookmark[]): (query: string) => Bookmark[] {
  let index: Fuse<Bookmark> | undefined;
  return query => {
    const text = query.trim();
    if (!text) return bookmarks;
    index ??= new Fuse(bookmarks, {
      keys: [{ name: 'title', weight: 3 }, 'url', 'category', 'tags', 'summary'],
      threshold: 0.36,
      ignoreLocation: true,
    });
    return index.search(text).map(result => result.item);
  };
}
