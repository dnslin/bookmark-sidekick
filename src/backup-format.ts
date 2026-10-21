import { z } from 'zod';
import { MAX_TAG_LENGTH, MAX_TAGS } from './domain.ts';

export const UNSUPPORTED_BACKUP_FORMAT = '不支持此备份格式，仅支持 v3 备份';

const recordSchema = z.object({
  url: z.string().max(16_384),
  title: z.string().max(2000),
  folder: z.string().max(4000),
  category: z.string().max(24),
  tags: z.array(z.string().max(MAX_TAG_LENGTH)).max(MAX_TAGS),
  summary: z.string().max(1000),
  readingState: z.enum(['none', 'later', 'reading', 'read']),
  snapshot: z.object({
    html: z.string().max(1_000_000),
    text: z.string().max(500_000),
    capturedAt: z.number(),
    progress: z.number().min(0).max(1),
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

const backupSchema = z.object({
  format: z.literal('bookmark-sidekick'),
  version: z.literal(3),
  exportedAt: z.string().max(100).optional(),
  entries: z.array(recordSchema).max(100_000),
  settings: backedUpSettingsSchema,
});

export type ParsedBackup = z.infer<typeof backupSchema>;

export interface BackupPreview {
  version: 3;
  exportedAt?: string;
  entryCount: number;
  snapshotCount: number;
  categories: string[];
  model: {
    baseUrl: string;
    model: string;
    consent: boolean;
    hasApiKey: boolean;
  };
}

export function parseBackup(input: unknown): ParsedBackup {
  if (input && typeof input === 'object' && 'version' in input && input.version !== 3) throw new Error(UNSUPPORTED_BACKUP_FORMAT);
  return backupSchema.parse(input);
}

export function inspectBackup(input: unknown): BackupPreview {
  const backup = parseBackup(input);
  return {
    version: backup.version,
    exportedAt: backup.exportedAt,
    entryCount: backup.entries.length,
    snapshotCount: backup.entries.filter(entry => entry.snapshot).length,
    categories: backup.settings.categories,
    model: {
      baseUrl: backup.settings.baseUrl,
      model: backup.settings.model,
      consent: backup.settings.consent,
      hasApiKey: Boolean(backup.settings.apiKey),
    },
  };
}
