import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend, nativeBookmark, bookmark, task, tick, waitFor } from './helpers/backend.mjs';

test('等待执行的同步合并为一次，不变书签不重复写入', async () => {
  const native = Array.from({ length: 100 }, (_, i) => nativeBookmark(String(i)));
  const backend = createBackend({ native });
  const added = await Promise.all(Array.from({ length: 100 }, () => backend.service.syncBookmarks()));
  assert.equal(backend.metrics.trees, 1);
  assert.equal(backend.metrics.bookmarkWrites, 100);
  assert.equal(backend.metrics.bulkPuts, 1);
  assert.equal(added[0].length, 100);
  await backend.service.syncBookmarks();
  assert.equal(backend.metrics.trees, 2);
  assert.equal(backend.metrics.bookmarkWrites, 100);
});

test('运行中的同步收到请求后再读一次新树，显式 SYNC 等待最新数据', async () => {
  let release;
  let started;
  const began = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const backend = createBackend({ native: [nativeBookmark('a')], getTree: async (native, count) => {
    if (count === 1) { started(); await gate; }
    return native;
  } });
  const first = backend.service.syncBookmarks();
  await began;
  backend.setNative([nativeBookmark('a', { title: '最新标题' }), nativeBookmark('b')]);
  const second = backend.service.handleMessage({ type: 'SYNC' });
  const third = backend.service.syncBookmarks();
  release();
  await first;
  assert.deepEqual(await second, { count: 2 });
  await third;
  assert.equal(backend.metrics.trees, 2);
  assert.equal((await backend.db.bookmarks.get('a')).title, '最新标题');
});

test('一次同步失败不会阻断后续请求', async () => {
  const backend = createBackend({ native: [nativeBookmark('a')], getTree: (native, count) => {
    if (count === 1) throw new Error('书签读取失败');
    return native;
  } });
  await assert.rejects(backend.service.syncBookmarks(), /书签读取失败/);
  assert.deepEqual(await backend.service.syncBookmarks(), ['a']);
});

test('标题、网址、移动、删除和新增批量同步，并正确清理过期数据', async () => {
  const ids = ['a', 'b', 'c', 'd'];
  const backend = createBackend({
    bookmarks: ids.map(id => bookmark(id, { folder: '旧目录', category: '工具', manual: true, tags: ['旧标签'], summary: '旧摘要' })),
    drafts: ids.map(id => ({ bookmarkId: id, revision: 1, category: '工具', tags: [], summary: '', confidence: 0.8 })),
    tasks: ids.map(id => task(id)),
    snapshots: ids.map(id => ({ bookmarkId: id, url: `https://example.com/${id}`, html: '<p>正文</p>', text: '正文', capturedAt: 1 })),
    native: [{ id: 'folder', title: '新目录', children: [nativeBookmark('a', { title: '新标题' }), nativeBookmark('b', { url: 'https://example.com/new' }), nativeBookmark('c'), nativeBookmark('e')] }],
  });
  assert.deepEqual(await backend.service.syncBookmarks(), ['e']);
  const a = await backend.db.bookmarks.get('a');
  const b = await backend.db.bookmarks.get('b');
  const c = await backend.db.bookmarks.get('c');
  assert.equal(a.title, '新标题'); assert.equal(a.category, '工具'); assert.equal(a.revision, 2);
  assert.equal(b.category, ''); assert.equal(b.summary, ''); assert.equal(b.manual, false); assert.equal(b.revision, 2);
  assert.equal(c.folder, '新目录'); assert.equal(c.revision, 1);
  assert.equal(await backend.db.drafts.get('a'), undefined);
  assert.equal(await backend.db.tasks.get('b'), undefined);
  assert.ok(await backend.db.snapshots.get('a'));
  assert.equal(await backend.db.snapshots.get('b'), undefined);
  assert.ok(await backend.db.drafts.get('c'));
  for (const name of ['bookmarks', 'drafts', 'tasks', 'snapshots']) assert.equal(await backend.db[name].get('d'), undefined);
  assert.equal(backend.metrics.bookmarkWrites, 4);
  assert.equal(backend.metrics.bulkPuts, 1);
});

test('批量导入抑制创建事件，同期修改仍同步，结束后统一读取', async () => {
  const backend = createBackend({ native: Array.from({ length: 100 }, (_, i) => nativeBookmark(String(i))) });
  backend.service.initializeBackground();
  backend.browser.bookmarks.onImportBegan.emit();
  for (let i = 0; i < 100; i++) backend.browser.bookmarks.onCreated.emit(String(i));
  await tick();
  assert.equal(backend.metrics.trees, 0);
  const updated = [nativeBookmark('0', { title: '新标题' }), ...Array.from({ length: 99 }, (_, i) => nativeBookmark(String(i + 1)))];
  backend.setNative(updated);
  backend.browser.bookmarks.onChanged.emit('0', { title: '新标题' });
  await backend.service.syncBookmarks();
  assert.equal(backend.metrics.trees, 1);
  assert.equal((await backend.db.bookmarks.get('0')).title, '新标题');
  backend.setNative([...updated, nativeBookmark('100')]);
  backend.browser.bookmarks.onCreated.emit('100');
  backend.browser.bookmarks.onImportEnded.emit();
  await backend.service.syncBookmarks();
  assert.equal(backend.metrics.trees, 2);
  assert.equal(backend.metrics.bookmarkWrites, 101);
  assert.equal((await backend.db.bookmarks.get('0')).title, '新标题');
});

test('领取待处理和过期任务，未过期及失败任务保持原状', async () => {
  const runnable = ['a', 'b', 'c', 'd', 'e', 'f'];
  const future = task('future', { status: 'running', leaseUntil: Date.now() + 60_000, attempts: 1 });
  const failed = task('failed', { status: 'failed', error: '旧错误', attempts: 4 });
  const backend = createBackend({
    bookmarks: [...runnable, 'future', 'failed'].map(id => bookmark(id)),
    tasks: [...runnable.slice(0, 4).map(id => task(id)), ...runnable.slice(4).map(id => task(id, { status: 'running', leaseUntil: 1, attempts: 1 })), future, failed],
  });
  await backend.service.pump();
  assert.deepEqual(backend.requests[0].map(row => row.id), runnable);
  assert.equal(await backend.db.drafts.count(), 6);
  assert.deepEqual(await backend.db.tasks.get('future'), future);
  assert.deepEqual(await backend.db.tasks.get('failed'), failed);
  assert.equal(backend.metrics.fullTaskReads, 0);
  assert.ok(backend.metrics.indexedTaskReads > 0);
});

test('每批最多领取六项，暂停后当前批次完成并保留剩余任务', async () => {
  const ids = Array.from({ length: 10 }, (_, i) => String(i));
  let backend;
  backend = createBackend({ bookmarks: ids.map(id => bookmark(id)), tasks: ids.map(id => task(id)), classify: (_settings, items) => {
    backend.storage.settings.paused = true;
    return items.map(item => ({ id: item.id, category: '开发', tags: [], summary: '', confidence: 0.8 }));
  } });
  await backend.service.pump();
  assert.equal(backend.requests.length, 1);
  assert.equal(backend.requests[0].length, 6);
  assert.equal(await backend.db.drafts.count(), 6);
  assert.equal(await backend.db.tasks.count(), 4);
});

test('批量建议留草稿，自动分类保护手动分类', async () => {
  const backend = createBackend({
    bookmarks: [bookmark('draft'), bookmark('auto'), bookmark('manual', { category: '工具', manual: true })],
    tasks: [task('draft'), task('auto', { mode: 'auto' }), task('manual', { mode: 'auto' })],
  });
  await backend.service.pump();
  assert.equal((await backend.db.bookmarks.get('draft')).category, '');
  assert.ok(await backend.db.drafts.get('draft'));
  assert.equal((await backend.db.bookmarks.get('auto')).category, '开发');
  assert.equal(await backend.db.drafts.get('auto'), undefined);
  assert.equal((await backend.db.bookmarks.get('manual')).category, '工具');
  assert.ok(await backend.db.drafts.get('manual'));
  assert.equal(await backend.db.tasks.count(), 0);
});

test('撤回授权后不提交在途结果，任务保留并能继续', async () => {
  let backend;
  let revoke = true;
  backend = createBackend({ bookmarks: [bookmark('a')], tasks: [task('a')], classify: (_settings, items) => {
    if (revoke) backend.storage.settings.consent = false;
    return items.map(item => ({ id: item.id, category: '开发', tags: [], summary: '', confidence: 0.8 }));
  } });
  await backend.service.pump();
  assert.equal((await backend.db.tasks.get('a')).status, 'pending');
  assert.equal((await backend.db.tasks.get('a')).attempts, 1);
  assert.equal(await backend.db.drafts.count(), 0);
  assert.equal((await backend.db.bookmarks.get('a')).category, '');
  revoke = false;
  backend.storage.settings.consent = true;
  await backend.service.pump();
  assert.ok(await backend.db.drafts.get('a'));
  assert.equal(await backend.db.tasks.count(), 0);
});

test('失败暂停后显式重试失败项，已完成草稿保留', async () => {
  let shouldFail = true;
  const backend = createBackend({
    bookmarks: [bookmark('a'), bookmark('done')], tasks: [task('a')],
    drafts: [{ bookmarkId: 'done', revision: 1, category: '工具', tags: [], summary: '已有结果', confidence: 0.9 }],
    classify: (_settings, items) => {
      if (shouldFail) throw Object.assign(new Error('鉴权失败'), { statusCode: 401 });
      return items.map(item => ({ id: item.id, category: '开发', tags: [], summary: '', confidence: 0.8 }));
    },
  });
  await backend.service.pump();
  assert.equal((await backend.db.tasks.get('a')).status, 'failed');
  assert.equal(backend.storage.settings.paused, true);
  shouldFail = false;
  await backend.service.handleMessage({ type: 'RETRY' });
  await waitFor(() => backend.db.tasks.rows.size === 0);
  assert.equal(backend.storage.settings.paused, false);
  assert.equal((await backend.db.drafts.get('done')).summary, '已有结果');
  assert.ok(await backend.db.drafts.get('a'));
});

test('任务超时仍自动重试三次，耗尽后失败暂停', async () => {
  const backend = createBackend({ bookmarks: [bookmark('a')], tasks: [task('a')], classify: () => { throw new DOMException('timeout', 'TimeoutError'); } });
  await backend.service.pump();
  assert.equal(backend.requests.length, 4);
  const failed = await backend.db.tasks.get('a');
  assert.equal(failed.attempts, 4);
  assert.equal(failed.status, 'failed');
  assert.equal(backend.storage.settings.paused, true);
});

test('请求期间发生手动修改，晚到结果不能覆盖书签', async () => {
  let backend;
  backend = createBackend({ bookmarks: [bookmark('a')], tasks: [task('a', { mode: 'auto' })], classify: async (_settings, items) => {
    await backend.db.bookmarks.update('a', { category: '工具', manual: true, revision: 2 });
    await backend.db.tasks.delete('a');
    return items.map(item => ({ id: item.id, category: '开发', tags: [], summary: '', confidence: 0.9 }));
  } });
  await backend.service.pump();
  assert.equal((await backend.db.bookmarks.get('a')).category, '工具');
  assert.equal(await backend.db.drafts.count(), 0);
});
