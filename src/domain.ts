/** Pure functions. Kept dependency-free so the critical rules can run under node:test. */
export const DEFAULT_CATEGORIES = ['开发', 'AI', '设计', '工具', '产品', '文章', '工作', '生活', '其他'];
export type LinkState = 'unknown' | 'available' | 'unavailable' | 'restricted';
export interface Bookmark {
  id: string;
  title: string;
  url: string;
  folder: string;
  addedAt: number;
  revision: number;
  category: string;
  tags: string[];
  summary: string;
  manual: boolean;
  linkState: LinkState;
  checkedAt?: number;
  checkDetail?: string;
}
export interface Suggestion {
  bookmarkId: string;
  revision: number;
  category: string;
  tags: string[];
  summary: string;
  confidence: number;
}
export interface Task {
  bookmarkId: string;
  revision: number;
  mode: 'draft' | 'auto';
  status: 'pending' | 'running' | 'failed';
  leaseUntil: number;
  attempts: number;
  error?: string;
}
export interface Snapshot {
  bookmarkId: string;
  url: string;
  html: string;
  text: string;
  capturedAt: number;
}
export interface NativeNode {
  id: string;
  title: string;
  url?: string;
  dateAdded?: number;
  children?: NativeNode[];
}

export function isWebUrl(input: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(input).protocol); } catch { return false; }
}

// Only remove well-known tracking keys. id, key, ref, source, signatures and hashes are preserved.
export function cleanUrl(input: string): string {
  if (!isWebUrl(input)) throw new Error('仅支持 HTTP / HTTPS 网页');
  const u = new URL(input);
  const tracking = new Set(['fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid']);
  for (const key of [...u.searchParams.keys()]) {
    if (/^utm_/i.test(key) || tracking.has(key.toLowerCase())) u.searchParams.delete(key);
  }
  return u.href;
}

export function hostname(input: string): string {
  try { return new URL(input).hostname; } catch { return input; }
}

export function flattenBookmarks(nodes: NativeNode[], path: string[] = []): Omit<Bookmark, 'revision' | 'category' | 'tags' | 'summary' | 'manual' | 'linkState'>[] {
  return nodes.flatMap(node => {
    if (node.url) return [{
      id: node.id, title: node.title || node.url, url: node.url,
      folder: path.join(' / '), addedAt: node.dateAdded ?? 0,
    }];
    return flattenBookmarks(node.children ?? [], node.title ? [...path, node.title] : path);
  });
}

export function mergeNative(existing: Bookmark | undefined, native: ReturnType<typeof flattenBookmarks>[number]): Bookmark {
  if (!existing) return { ...native, revision: 1, category: '', tags: [], summary: '', manual: false, linkState: 'unknown' };
  const urlChanged = existing.url !== native.url;
  const contentChanged = urlChanged || existing.title !== native.title;
  return {
    ...existing, ...native,
    revision: existing.revision + (contentChanged ? 1 : 0),
    ...(urlChanged ? { category: '', tags: [], summary: '', manual: false, linkState: 'unknown' as const, checkedAt: undefined, checkDetail: undefined } : {}),
  };
}

export function canApply(bookmark: Bookmark | undefined, suggestion: Suggestion): bookmark is Bookmark {
  return Boolean(bookmark && bookmark.id === suggestion.bookmarkId && bookmark.revision === suggestion.revision);
}

export function applySuggestion(bookmark: Bookmark, suggestion: Suggestion): Bookmark {
  if (!canApply(bookmark, suggestion)) throw new Error('书签已变化，需要重新分析');
  return { ...bookmark, category: suggestion.category, tags: suggestion.tags, summary: suggestion.summary, manual: false };
}

export function isClaimable(task: Task, now: number): boolean {
  return task.status === 'pending' || (task.status === 'running' && task.leaseUntil <= now);
}

export function validateBatchIds(expected: string[], actual: string[]): void {
  if (new Set(actual).size !== actual.length) throw new Error('模型返回了重复书签 ID');
  if (expected.length !== actual.length || expected.some(id => !actual.includes(id))) {
    throw new Error('模型返回的书签 ID 不完整或不匹配');
  }
}

export function classifyStatus(status: number): { state: LinkState; detail: string } {
  if (status >= 200 && status < 400) return { state: 'available', detail: `HTTP ${status}` };
  if (status === 404 || status === 410) return { state: 'unavailable', detail: `HTTP ${status}，可能已删除` };
  if ([401, 403, 429].includes(status)) return { state: 'restricted', detail: `HTTP ${status}，登录、限流或访问限制，不代表失效` };
  return { state: 'unknown', detail: `HTTP ${status}，暂时无法判断` };
}

export function safeError(error: unknown): string {
  const e = error as { statusCode?: number; name?: string } | undefined;
  if (e?.statusCode === 401 || e?.statusCode === 403) return '模型鉴权失败，请检查 API Key 和访问权限';
  if (e?.statusCode === 429) return '模型请求限流，请稍后重试';
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return '模型响应超时，请使用响应更快的模型后重试';
  // Do not render raw SDK errors: they can include request headers or page data.
  return '模型请求或输出校验失败。请检查接口地址、模型名称及网络，然后重试';
}
