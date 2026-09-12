import { z } from 'zod';
import { DEFAULT_CATEGORIES, isWebUrl } from './domain';

export const settingsSchema = z.object({
  baseUrl: z.string().trim().refine(v => v === '' || (isWebUrl(v) && !new URL(v).username && !new URL(v).password), '请输入 HTTP/HTTPS API 地址'),
  apiKey: z.string().max(4096),
  model: z.string().trim().max(200),
  categories: z.array(z.string().trim().min(1).max(24)).min(1).max(20)
    .refine(v => new Set(v).size === v.length, '分类名称不能重复'),
  consent: z.boolean(),
  paused: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  baseUrl: '', apiKey: '', model: '', categories: DEFAULT_CATEGORIES,
  consent: false, paused: false,
};
export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get('settings');
  const parsed = settingsSchema.safeParse({ ...defaultSettings, ...result.settings });
  return parsed.success ? parsed.data : { ...defaultSettings };
}
export async function setSettings(input: Settings): Promise<void> {
  await chrome.storage.local.set({ settings: settingsSchema.parse(input) });
}
export function isConfigured(s: Settings): boolean {
  return s.consent && isWebUrl(s.baseUrl) && !!s.model.trim();
}
// Chrome match patterns scope hosts, not individual TCP ports.
export function originPattern(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}/*`;
}
