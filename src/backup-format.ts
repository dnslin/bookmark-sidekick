import { z } from 'zod';

const recordSchema = z.object({
  url: z.string().max(16_384),
  title: z.string().max(2000),
  folder: z.string().max(4000),
  category: z.string().max(24),
  tags: z.array(z.string().max(32)).max(3),
  summary: z.string().max(1000),
  snapshot: z.object({
    html: z.string().max(1_000_000),
    text: z.string().max(500_000),
    capturedAt: z.number(),
  }).optional(),
});

const backedUpSettingsSchema = z.object({
  baseUrl: z.string().trim().max(4096).refine(value => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, '请输入 HTTP/HTTPS API 地址'),
  apiKey: z.string().max(4096),
  model: z.string().trim().max(200),
  categories: z.array(z.string().trim().min(1).max(24)).min(1).max(20)
    .refine(values => new Set(values).size === values.length, '分类名称不能重复'),
  consent: z.boolean(),
});

const commonSchema = {
  format: z.literal('bookmark-sidekick'),
  exportedAt: z.string().max(100).optional(),
  entries: z.array(recordSchema).max(100_000),
};

const backupSchema = z.discriminatedUnion('version', [
  z.object({ ...commonSchema, version: z.literal(1) }),
  z.object({ ...commonSchema, version: z.literal(2), settings: backedUpSettingsSchema }),
]);

export type ParsedBackup = z.infer<typeof backupSchema>;

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

export function parseBackup(input: unknown): ParsedBackup {
  return backupSchema.parse(input);
}

export function categoriesFromEntries(backup: ParsedBackup): string[] {
  return [...new Set(backup.entries.map(entry => entry.category.trim()).filter(Boolean))];
}

export function inspectBackup(input: unknown): BackupPreview {
  const backup = parseBackup(input);
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
