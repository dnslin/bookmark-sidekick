import { liveQuery } from 'dexie';
import { db } from './db';
import { createLibrarySearch } from './search';
import type { SearchRequest, SearchResponse } from './search';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SearchRequest>) => void) | null;
  postMessage: (message: SearchResponse) => void;
};
const index = createLibrarySearch();
const versions = new Map<string, number>();
let latest: SearchRequest | undefined;
let initialized = false;
let needsSearch = false;
let pendingUpdates = 0;
let dataError = '';
let updates: Promise<void> = Promise.resolve();

function fail(error: unknown) {
  dataError = `正文搜索读取失败：${error instanceof Error ? error.message : String(error)}`;
  if (latest) scope.postMessage({ type: 'error', id: latest.id, error: dataError });
}

function publish() {
  if (!latest) return;
  needsSearch = false;
  try { scope.postMessage({ type: 'result', id: latest.id, ...index.search(latest.query) }); }
  catch (error) { fail(error); }
}

async function refreshSnapshots(entries: [string, number][]) {
  if (!initialized) {
    // A value cursor releases each HTML record after retaining only searchable text.
    await db.snapshots.each(snapshot => {
      index.setSnapshot(snapshot);
      versions.set(snapshot.bookmarkId, snapshot.capturedAt);
    });
    return true;
  }
  const next = new Map(entries);
  const changed = entries.filter(([id, capturedAt]) => versions.get(id) !== capturedAt);
  const removed = [...versions.keys()].filter(id => !next.has(id));
  if (!changed.length && !removed.length) return false;
  if (latest) scope.postMessage({ type: 'loading', id: latest.id });
  for (const id of removed) { index.removeSnapshot(id); versions.delete(id); }
  for (const [id] of changed) {
    const snapshot = await db.snapshots.get(id);
    if (snapshot) { index.setSnapshot(snapshot); versions.set(id, snapshot.capturedAt); }
    else { index.removeSnapshot(id); versions.delete(id); }
  }
  return true;
}

// Observe index keys, not snapshot values: progress updates don't alter capturedAt.
liveQuery(async () => {
  const entries: [string, number][] = [];
  await db.snapshots.orderBy('capturedAt').eachKey((capturedAt, cursor) => {
    entries.push([String(cursor.primaryKey), capturedAt as number]);
  });
  return entries;
}).subscribe({
  next(entries) {
    pendingUpdates++;
    updates = updates.then(async () => {
      if (await refreshSnapshots(entries)) needsSearch = Boolean(latest);
      initialized = true;
      dataError = '';
    }).catch(fail).finally(() => {
      pendingUpdates--;
      if (!pendingUpdates && initialized && !dataError && needsSearch) publish();
    });
  },
  error: fail,
});

scope.onmessage = event => {
  if (!event.data.query.trim()) {
    latest = undefined;
    needsSearch = false;
    return;
  }
  latest = event.data;
  index.setBookmarks(latest.bookmarks);
  needsSearch = true;
  if (dataError) scope.postMessage({ type: 'error', id: latest.id, error: dataError });
  else if (initialized && !pendingUpdates) publish();
};
