import { z } from 'zod';
import { db } from './db';

const recordSchema = z.object({
  url: z.string().max(16_384), title: z.string().max(2000), folder: z.string().max(4000),
  category: z.string().max(24), tags: z.array(z.string().max(32)).max(3), summary: z.string().max(1000),
  snapshot: z.object({ html: z.string().max(1_000_000), text: z.string().max(500_000), capturedAt: z.number() }).optional(),
});
const schema = z.object({ format: z.literal('bookmark-sidekick'), version: z.literal(1), entries: z.array(recordSchema).max(100_000) });

export async function exportBackup() {
  const bookmarks = await db.bookmarks.toArray();
  const snapshots = new Map((await db.snapshots.toArray()).map(s => [s.bookmarkId, s]));
  return {
    format: 'bookmark-sidekick', version: 1, exportedAt: new Date().toISOString(),
    entries: bookmarks.map(b => {
      const snapshot = snapshots.get(b.id);
      return { url: b.url, title: b.title, folder: b.folder, category: b.category, tags: b.tags, summary: b.summary,
        ...(snapshot ? { snapshot: { html: snapshot.html, text: snapshot.text, capturedAt: snapshot.capturedAt } } : {}) };
    }),
  };
}

/** Restore metadata only; do not create, delete, or move Chrome bookmarks. IDs are device-specific. */
export async function importBackup(input: unknown) {
  const backup = schema.parse(input);
  let restored = 0;
  let skipped = 0;
  await db.transaction('rw', db.bookmarks, db.drafts, db.tasks, db.snapshots, async () => {
    const bookmarks = await db.bookmarks.toArray();
    const used = new Set<string>();
    for (const item of backup.entries) {
      const matches = bookmarks.filter(b => b.url === item.url && !used.has(b.id));
      const b = matches.find(b => b.folder === item.folder) ?? (matches.length === 1 ? matches[0] : undefined);
      if (!b) { skipped++; continue; }
      used.add(b.id);
      await db.bookmarks.update(b.id, { category: item.category, tags: item.tags, summary: item.summary, manual: true, revision: b.revision + 1 });
      await db.drafts.delete(b.id); await db.tasks.delete(b.id);
      if (item.snapshot) await db.snapshots.put({ ...item.snapshot, bookmarkId: b.id, url: b.url });
      restored++;
    }
  });
  return { restored, skipped };
}
