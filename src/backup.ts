import { db } from './db';
import { getSettings, setSettings, settingsSchema } from './settings';
import { parseBackup } from './backup-format';
import type { ParsedBackup } from './backup-format';
import type { Bookmark } from './domain';

export { inspectBackup } from './backup-format';
export type { BackupPreview } from './backup-format';

export async function exportBackup() {
  const [bookmarks, storedSnapshots, settings] = await Promise.all([
    db.bookmarks.toArray(),
    db.snapshots.toArray(),
    getSettings(),
  ]);
  const snapshots = new Map(storedSnapshots.map(snapshot => [snapshot.bookmarkId, snapshot]));
  return {
    format: 'bookmark-sidekick', version: 3 as const, exportedAt: new Date().toISOString(),
    settings: {
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      categories: settings.categories,
      consent: settings.consent,
    },
    entries: bookmarks.map(bookmark => {
      const snapshot = snapshots.get(bookmark.id);
      return {
        url: bookmark.url,
        title: bookmark.title,
        folder: bookmark.folder,
        category: bookmark.category,
        tags: bookmark.tags,
        summary: bookmark.summary,
        readingState: bookmark.readingState,
        ...(snapshot ? { snapshot: { html: snapshot.html, text: snapshot.text, capturedAt: snapshot.capturedAt, progress: snapshot.progress } } : {}),
      };
    }),
  };
}

type BackupEntry = ParsedBackup['entries'][number];
type BookmarkIdentity = Pick<Bookmark, 'url' | 'folder' | 'title'>;

function groupBy<T>(items: Set<T>, key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    const group = groups.get(value);
    if (group) group.push(item);
    else groups.set(value, [item]);
  }
  return groups;
}

function matchEntries(entries: BackupEntry[], bookmarks: Bookmark[]): [BackupEntry, Bookmark][] {
  const remainingEntries = new Set(entries);
  const remainingBookmarks = new Set(bookmarks);
  const matched: [BackupEntry, Bookmark][] = [];
  const keys: ((item: BookmarkIdentity) => string)[] = [
    item => JSON.stringify([item.url, item.folder, item.title]),
    item => JSON.stringify([item.url, item.folder]),
    item => item.url,
  ];
  // Reserve precise matches before falling back, and require uniqueness on both sides.
  for (const key of keys) {
    const entryGroups = groupBy(remainingEntries, key);
    const bookmarkGroups = groupBy(remainingBookmarks, key);
    for (const [identity, items] of entryGroups) {
      const candidates = bookmarkGroups.get(identity);
      const item = items.length === 1 ? items[0] : undefined;
      const bookmark = candidates?.length === 1 ? candidates[0] : undefined;
      if (!item || !bookmark) continue;
      remainingEntries.delete(item);
      remainingBookmarks.delete(bookmark);
      matched.push([item, bookmark]);
    }
  }
  return matched;
}

/** Restore metadata only; do not create, delete, or move Chrome bookmarks. IDs are device-specific. */
export async function importBackup(input: unknown) {
  const backup = parseBackup(input);
  const settings = settingsSchema.parse({ ...backup.settings, paused: false });
  let restored = 0;
  await db.transaction('rw', db.bookmarks, db.drafts, db.tasks, db.snapshots, async () => {
    const bookmarks = await db.bookmarks.toArray();
    for (const [item, bookmark] of matchEntries(backup.entries, bookmarks)) {
      await db.bookmarks.update(bookmark.id, {
        category: item.category,
        tags: item.tags,
        summary: item.summary,
        readingState: item.readingState,
        manual: true,
        revision: bookmark.revision + 1,
      });
      await db.drafts.delete(bookmark.id);
      await db.tasks.delete(bookmark.id);
      if (item.snapshot) {
        const existing = await db.snapshots.get(bookmark.id);
        let capturedAt = item.snapshot.capturedAt;
        if (existing) {
          const sameContent = existing.html === item.snapshot.html && existing.text === item.snapshot.text;
          capturedAt = sameContent ? existing.capturedAt : Math.max(existing.capturedAt + 1, capturedAt);
        }
        await db.snapshots.put({ ...item.snapshot, capturedAt, bookmarkId: bookmark.id, url: bookmark.url });
      }
      restored++;
    }
  });
  await setSettings(settings);
  return {
    restored,
    skipped: backup.entries.length - restored,
    settings,
    categoryCount: settings.categories.length,
  };
}
