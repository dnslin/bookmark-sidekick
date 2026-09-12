import { z } from 'zod';
import { db } from './db';
import { getSettings, setSettings, settingsSchema } from './settings';
import type { Settings } from './settings';

const recordSchema = z.object({
  url: z.string().max(16_384), title: z.string().max(2000), folder: z.string().max(4000),
  category: z.string().max(24), tags: z.array(z.string().max(32)).max(3), summary: z.string().max(1000),
  snapshot: z.object({ html: z.string().max(1_000_000), text: z.string().max(500_000), capturedAt: z.number() }).optional(),
});
const backedUpSettingsSchema = settingsSchema.pick({
  baseUrl: true,
  apiKey: true,
  model: true,
  categories: true,
  consent: true,
});
const commonSchema = {
  format: z.literal('bookmark-sidekick'),
  exportedAt: z.string().max(100).optional(),
  entries: z.array(recordSchema).max(100_000),
};
const schema = z.discriminatedUnion('version', [
  z.object({ ...commonSchema, version: z.literal(1) }),
  z.object({ ...commonSchema, version: z.literal(2), settings: backedUpSettingsSchema }),
]);
type ParsedBackup = z.infer<typeof schema>;

export interface BackupPreview {
  version: 1 | 2;
  exportedAt?: string;
  entryCount: number;
  snapshotCount: number;
  categories: string[];
  model?: {
    baseUrl: string;
    model: string;
    consent: boolean;
    hasApiKey: boolean;
  };
}

function categoriesFromEntries(backup: ParsedBackup): string[] {
  return [...new Set(backup.entries.map(entry => entry.category.trim()).filter(Boolean))];
}

export function inspectBackup(input: unknown): BackupPreview {
  const backup = schema.parse(input);
  const categories = backup.version === 2 ? backup.settings.categories : categoriesFromEntries(backup);
  return {
    version: backup.version,
    exportedAt: backup.exportedAt,
    entryCount: backup.entries.length,
    snapshotCount: backup.entries.filter(entry => entry.snapshot).length,
    categories,
    ...(backup.version === 2 ? {
      model: {
        baseUrl: backup.settings.baseUrl,
        model: backup.settings.model,
        consent: backup.settings.consent,
        hasApiKey: Boolean(backup.settings.apiKey),
      },
    } : {}),
  };
}

export async function exportBackup() {
  const [bookmarks, storedSnapshots, settings] = await Promise.all([
    db.bookmarks.toArray(),
    db.snapshots.toArray(),
    getSettings(),
  ]);
  const snapshots = new Map(storedSnapshots.map(snapshot => [snapshot.bookmarkId, snapshot]));
  return {
    format: 'bookmark-sidekick', version: 2 as const, exportedAt: new Date().toISOString(),
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
        ...(snapshot ? { snapshot: { html: snapshot.html, text: snapshot.text, capturedAt: snapshot.capturedAt } } : {}),
      };
    }),
  };
}

async function settingsForRestore(backup: ParsedBackup): Promise<Settings> {
  if (backup.version === 2) return settingsSchema.parse({ ...backup.settings, paused: false });

  const current = await getSettings();
  const backupCategories = categoriesFromEntries(backup);
  const categories = [...new Set([...backupCategories, ...current.categories])].slice(0, 20);
  return settingsSchema.parse({ ...current, categories });
}

/** Restore metadata only; do not create, delete, or move Chrome bookmarks. IDs are device-specific. */
export async function importBackup(input: unknown) {
  const backup = schema.parse(input);
  const settings = await settingsForRestore(backup);
  let restored = 0;
  let skipped = 0;
  await db.transaction('rw', db.bookmarks, db.drafts, db.tasks, db.snapshots, async () => {
    const bookmarks = await db.bookmarks.toArray();
    const used = new Set<string>();
    for (const item of backup.entries) {
      const matches = bookmarks.filter(bookmark => bookmark.url === item.url && !used.has(bookmark.id));
      const bookmark = matches.find(candidate => candidate.folder === item.folder) ?? (matches.length === 1 ? matches[0] : undefined);
      if (!bookmark) { skipped++; continue; }
      used.add(bookmark.id);
      await db.bookmarks.update(bookmark.id, {
        category: item.category,
        tags: item.tags,
        summary: item.summary,
        manual: true,
        revision: bookmark.revision + 1,
      });
      await db.drafts.delete(bookmark.id);
      await db.tasks.delete(bookmark.id);
      if (item.snapshot) await db.snapshots.put({ ...item.snapshot, bookmarkId: bookmark.id, url: bookmark.url });
      restored++;
    }
  });
  await setSettings(settings);
  return {
    restored,
    skipped,
    settings,
    settingsRestored: backup.version === 2,
    categoryCount: settings.categories.length,
  };
}
