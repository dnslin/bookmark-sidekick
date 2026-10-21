import type { BookmarkEdits, BulkEdits, ReadingState, Snapshot } from './domain';
export type Message =
  | { type: 'SYNC' }
  | { type: 'ANALYZE'; ids?: string[] }
  | { type: 'RETRY' }
  | { type: 'PAUSE'; paused: boolean }
  | { type: 'TEST_MODEL' }
  | { type: 'APPLY'; ids: string[] }
  | { type: 'EDIT_DRAFT'; id: string; category: string }
  | { type: 'EDIT'; id: string; changes: BookmarkEdits }
  | { type: 'BULK_EDIT'; ids: string[]; changes: BulkEdits }
  | { type: 'SET_READING'; id: string; state: ReadingState }
  | { type: 'SAVE_PROGRESS'; id: string; capturedAt: number; progress: number }
  | { type: 'DELETE'; id: string }
  | { type: 'CHECK'; id: string }
  | { type: 'SAVE'; url: string; title: string; snapshot?: Omit<Snapshot, 'bookmarkId' | 'capturedAt' | 'progress'> };

type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
export async function rpc<T = unknown>(message: Message): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as Reply<T> | undefined;
  if (!response) throw new Error('后台未响应，请在扩展管理页面重新加载');
  if (!response.ok) throw new Error(response.error);
  return response.value;
}
