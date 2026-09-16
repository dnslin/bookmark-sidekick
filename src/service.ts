import { db } from './db';
import { applySuggestion, canApply, cleanUrl, classifyStatus, flattenBookmarks, isClaimable, isWebUrl, mergeNative, safeError, taskFailure, analysisTotal, withTimeoutRetries } from './domain';
import type { Bookmark, Snapshot, Suggestion, Task } from './domain';
import { getSettings, isConfigured, setSettings } from './settings';
import { classify } from './llm';
import type { Message } from './messages';

const ALARM = 'bookmark-sidekick-work';
let syncChain: Promise<unknown> = Promise.resolve();
let working = false;
let enqueueChain: Promise<unknown> = Promise.resolve();

export async function ensureAlarm() {
  if (!await chrome.alarms.get(ALARM)) await chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
}

export function syncBookmarks(): Promise<string[]> {
  const sync = syncChain.catch(() => undefined).then(async () => {
    const native = flattenBookmarks(await chrome.bookmarks.getTree());
    const added: string[] = [];
    await db.transaction('rw', db.bookmarks, db.drafts, db.tasks, db.snapshots, async () => {
      const old = new Map((await db.bookmarks.toArray()).map(b => [b.id, b]));
      const alive = new Set(native.map(b => b.id));
      for (const item of native) {
        const existing = old.get(item.id);
        const merged = mergeNative(existing, item);
        if (!existing) added.push(item.id);
        await db.bookmarks.put(merged);
        if (existing && existing.revision !== merged.revision) {
          await db.drafts.delete(item.id);
          await db.tasks.delete(item.id);
          if (existing.url !== item.url) await db.snapshots.delete(item.id);
        }
      }
      const removed = [...old.keys()].filter(id => !alive.has(id));
      await db.bookmarks.bulkDelete(removed);
      await db.drafts.bulkDelete(removed);
      await db.tasks.bulkDelete(removed);
      await db.snapshots.bulkDelete(removed);
    });
    return added;
  });
  syncChain = sync;
  return sync;
}

export function enqueue(ids?: string[], mode: Task['mode'] = 'draft'): Promise<void> {
  const queued = enqueueChain.catch(() => undefined).then(() => enqueueTasks(ids, mode));
  enqueueChain = queued;
  return queued;
}

async function enqueueTasks(ids: string[] | undefined, mode: Task['mode']) {
  const settings = await getSettings();
  if (!isConfigured(settings)) throw new Error('请先配置模型，并允许将书签信息发送给该模型');
  const progress = await chrome.storage.local.get('analysisProgress');
  const total = await db.transaction('rw', db.bookmarks, db.tasks, db.drafts, async () => {
    const tasksBefore = await db.tasks.count();
    const records = ids ? (await db.bookmarks.bulkGet(ids)).filter((b): b is Bookmark => !!b) : (await db.bookmarks.toArray()).filter(b => !b.category);
    for (const b of records) {
      if (!isWebUrl(b.url)) continue;
      const task = await db.tasks.get(b.id);
      if (task && !ids) continue;
      if (!ids && await db.drafts.get(b.id)) continue;
      // A revision token invalidates a request that is already in flight.
      const revision = b.revision + 1;
      await db.bookmarks.update(b.id, { revision });
      await db.drafts.delete(b.id);
      await db.tasks.put({ bookmarkId: b.id, revision, mode, status: 'pending', leaseUntil: 0, attempts: 0 });
    }
    return analysisTotal(progress.analysisProgress?.total ?? 0, tasksBefore, await db.tasks.count());
  });
  await chrome.storage.local.set({ analysisProgress: { total } });
  await ensureAlarm();
  void pump();
}

/** Claims are persisted, so terminating an MV3 worker does not lose progress. */
export async function pump(): Promise<void> {
  if (working) return;
  working = true;
  try {
    while (true) {
      const settings = await getSettings();
      if (!isConfigured(settings) || settings.paused) return;
      const batch = await db.transaction('rw', db.tasks, async () => {
        const pending = (await db.tasks.toArray()).filter(t => isClaimable(t, Date.now())).slice(0, 6);
        for (const task of pending) {
          await db.tasks.update(task.bookmarkId, { status: 'running', leaseUntil: Date.now() + 60_000, attempts: task.attempts + 1 });
        }
        return pending;
      });
      if (!batch.length) return;
      const inputs: (Bookmark & { text?: string })[] = [];
      for (const task of batch) {
        const bookmark = await db.bookmarks.get(task.bookmarkId);
        if (!bookmark || bookmark.revision !== task.revision) {
          const currentTask = await db.tasks.get(task.bookmarkId);
          if (currentTask?.revision === task.revision) await db.tasks.delete(task.bookmarkId);
          continue;
        }
        const snapshot = await db.snapshots.get(bookmark.id);
        inputs.push({ ...bookmark, text: snapshot?.text });
      }
      if (!inputs.length) continue;
      try {
        const rows = await classify(settings, inputs);
        // Honor revocation while the request was in flight. Never commit after consent was withdrawn.
        const latestSettings = await getSettings();
        if (!isConfigured(latestSettings)) {
          await db.tasks.where('status').equals('running').modify({ status: 'pending', leaseUntil: 0 });
          return;
        }
        await db.transaction('rw', db.bookmarks, db.drafts, db.tasks, async () => {
          for (const row of rows) {
            const task = batch.find(t => t.bookmarkId === row.id)!;
            const currentTask = await db.tasks.get(row.id);
            const bookmark = await db.bookmarks.get(row.id);
            if (!bookmark || currentTask?.revision !== task.revision || bookmark.revision !== task.revision) continue;
            if (!latestSettings.categories.includes(row.category)) {
              await db.tasks.update(row.id, { status: 'failed', error: '分类列表已修改，请重新分析', leaseUntil: 0 });
              continue;
            }
            const suggestion: Suggestion = { bookmarkId: row.id, revision: task.revision, category: row.category, tags: row.tags, summary: row.summary, confidence: row.confidence };
            // New saves may apply automatically; uncertain results and initial imports always stay drafts.
            if (task.mode === 'auto' && row.confidence >= 0.65 && !bookmark.manual) {
              await db.bookmarks.put(applySuggestion(bookmark, suggestion));
            } else {
              await db.drafts.put(suggestion);
            }
            await db.tasks.delete(row.id);
          }
        });
      } catch (error) {
        let failed = false;
        await db.transaction('rw', db.tasks, async () => {
          for (const task of batch) {
            const current = await db.tasks.get(task.bookmarkId);
            if (current?.revision === task.revision) {
              const result = taskFailure(error, current.attempts);
              await db.tasks.update(task.bookmarkId, result);
              failed ||= result.status === 'failed';
            }
          }
        });
        if (failed) {
          const latest = await getSettings();
          await setSettings({ ...latest, paused: true });
          return;
        }
      }
    }
  } finally {
    working = false;
  }
}

export async function applyDrafts(ids: string[]) {
  // Refresh source revisions immediately before applying. Native bookmarks are never moved here.
  await syncBookmarks();
  const categories = (await getSettings()).categories;
  let applied = 0;
  await db.transaction('rw', db.bookmarks, db.drafts, db.tasks, async () => {
    for (const id of new Set(ids)) {
      const draft = await db.drafts.get(id);
      const bookmark = await db.bookmarks.get(id);
      if (!draft || !categories.includes(draft.category) || !canApply(bookmark, draft)) continue;
      await db.bookmarks.put({ ...applySuggestion(bookmark, draft), revision: bookmark.revision + 1 });
      await db.drafts.delete(id);
      await db.tasks.delete(id);
      applied++;
    }
  });
  return { applied, skipped: ids.length - applied };
}

async function saveBookmark(input: Extract<Message, { type: 'SAVE' }>) {
  const url = cleanUrl(input.url);
  await syncBookmarks();
  let record = (await db.bookmarks.toArray()).find(b => isWebUrl(b.url) && cleanUrl(b.url) === url);
  const existed = !!record;
  if (!record) {
    const native = await chrome.bookmarks.create({ title: input.title.trim().slice(0, 1000) || url, url });
    await syncBookmarks();
    record = await db.bookmarks.get(native.id);
  }
  if (!record) throw new Error('无法读取已创建的书签，请重试');
  if (input.snapshot && cleanUrl(input.snapshot.url) === url) {
    const snapshot: Snapshot = {
      bookmarkId: record.id, url: input.snapshot.url, capturedAt: Date.now(),
      html: input.snapshot.html.slice(0, 1_000_000), text: input.snapshot.text.slice(0, 500_000),
    };
    await db.snapshots.put(snapshot);
  }
  if (!record.manual && (!existed || !record.category) && isConfigured(await getSettings())) await enqueue([record.id], 'auto');
  return { id: record.id, existed };
}

async function checkLink(id: string) {
  const b = await db.bookmarks.get(id);
  if (!b || !isWebUrl(b.url)) throw new Error('只能检查 HTTP/HTTPS 网页');
  let result: ReturnType<typeof classifyStatus>;
  try {
    // No login cookies. A blocked request is NOT treated as a dead page.
    let response = await fetch(b.url, { method: 'HEAD', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(b.url, { method: 'GET', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      void response.body?.cancel();
    }
    result = classifyStatus(response.status);
  } catch {
    result = { state: 'unknown', detail: '超时、网络错误或权限不足，不能认定失效' };
  }
  const latest = await db.bookmarks.get(id);
  if (latest?.url === b.url) await db.bookmarks.update(id, { linkState: result.state, checkedAt: Date.now(), checkDetail: result.detail });
  return result;
}

export async function handleMessage(message: Message): Promise<unknown> {
  switch (message.type) {
    case 'SYNC': {
      await syncBookmarks();
      return { count: await db.bookmarks.count() };
    }
    case 'ANALYZE': await syncBookmarks(); await enqueue(message.ids); return true;
    case 'RETRY': {
      await db.tasks.where('status').equals('failed').modify({ status: 'pending', leaseUntil: 0, attempts: 0, error: undefined });
      const settings = await getSettings();
      await setSettings({ ...settings, paused: false });
      void pump(); return true;
    }
    case 'PAUSE': {
      const settings = await getSettings();
      await setSettings({ ...settings, paused: message.paused });
      if (!message.paused) void pump();
      return true;
    }
    case 'TEST_MODEL': {
      const settings = await getSettings();
      if (!isConfigured(settings)) throw new Error('请先保存模型设置并允许发送书签信息');
      try {
        await withTimeoutRetries(() => classify(settings, [{ id: 'connection-test', title: 'Go programming documentation', url: 'https://go.dev/doc/', folder: '', addedAt: 0, revision: 1, category: '', tags: [], summary: '', manual: false, linkState: 'unknown' }]));
      } catch (e) { throw new Error(safeError(e)); }
      return true;
    }
    case 'APPLY': return applyDrafts(message.ids);
    case 'EDIT_DRAFT': {
      if (!(await getSettings()).categories.includes(message.category)) throw new Error('分类不存在');
      await db.drafts.update(message.id, { category: message.category, confidence: 1 });
      return true;
    }
    case 'SAVE': return saveBookmark(message);
    case 'EDIT': {
      if (!(await getSettings()).categories.includes(message.category)) throw new Error('分类不存在');
      await chrome.bookmarks.update(message.id, { title: message.title.trim().slice(0, 1000) });
      await syncBookmarks();
      await db.transaction('rw', db.bookmarks, db.tasks, db.drafts, async () => {
        const b = await db.bookmarks.get(message.id);
        if (!b) throw new Error('书签已被删除');
        await db.bookmarks.update(message.id, { category: message.category, manual: true, revision: b.revision + 1 });
        await db.tasks.delete(message.id); await db.drafts.delete(message.id);
      });
      return true;
    }
    case 'DELETE': await chrome.bookmarks.remove(message.id); await syncBookmarks(); return true;
    case 'CHECK': return checkLink(message.id);
    default: throw new Error('未知操作');
  }
}

export function initializeBackground() {
  // Listeners must be registered synchronously at worker startup.
  chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
    void handleMessage(message).then(value => sendResponse({ ok: true, value }), error => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : '操作失败，请重试' });
    });
    return true;
  });
  const boot = async () => {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    await ensureAlarm();
    await syncBookmarks();
    void pump();
  };
  chrome.runtime.onInstalled.addListener(() => { void boot().catch(() => undefined); });
  chrome.runtime.onStartup.addListener(() => { void boot().catch(() => undefined); });
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void pump().catch(() => undefined); });
  const sync = () => { void syncBookmarks().catch(() => undefined); };
  // Only the explicit SAVE path queues auto-classification. Native onCreated is also fired
  // by our own create() call, so queuing here would race and replace the auto task.
  chrome.bookmarks.onCreated.addListener(sync);
  chrome.bookmarks.onChanged.addListener(sync);
  chrome.bookmarks.onMoved.addListener(sync);
  chrome.bookmarks.onRemoved.addListener(sync);
  chrome.bookmarks.onImportEnded.addListener(sync);
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  void ensureAlarm().catch(() => undefined);
}
