import Dexie, { type EntityTable } from 'dexie';
import type { Bookmark, Suggestion, Snapshot, Task } from './domain';

export const db = new Dexie('bookmark-sidekick') as Dexie & {
  bookmarks: EntityTable<Bookmark, 'id'>;
  drafts: EntityTable<Suggestion, 'bookmarkId'>;
  snapshots: EntityTable<Snapshot, 'bookmarkId'>;
  tasks: EntityTable<Task, 'bookmarkId'>;
};
db.version(1).stores({
  bookmarks: '&id, url, category, addedAt',
  drafts: '&bookmarkId, category',
  snapshots: '&bookmarkId',
  tasks: '&bookmarkId, status',
});
