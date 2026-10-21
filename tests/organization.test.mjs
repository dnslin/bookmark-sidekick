import test from 'node:test';
import assert from 'node:assert/strict';
import * as domain from '../src/domain.ts';
import { bookmark, createBackend, nativeBookmark, task } from './helpers/backend.mjs';

const snapshot = (id, changes = {}) => ({ bookmarkId: id, url: `https://example.com/${id}`, html: '<p>正文</p>', text: '正文', capturedAt: 10, progress: .4, ...changes });
const backendFor = (ids = ['a'], options = {}) => createBackend({ native: ids.map(id => nativeBookmark(id)), bookmarks: ids.map(id => bookmark(id)), ...options });

test('标签去除首尾空白、忽略大小写重复，并保留第一种写法', () => {
  assert.deepEqual(domain.normalizeTags([' React ', 'react', '前端', '前端']), ['React', '前端']);
  assert.deepEqual(domain.normalizeTags([]), []);
  assert.throws(() => domain.normalizeTags(['  ']), /标签/);
  assert.throws(() => domain.normalizeTags(['长'.repeat(33)]), /32/);
  assert.throws(() => domain.normalizeTags(Array.from({ length: 21 }, (_, i) => `标签 ${i}`)), /20/);
});

test('编辑标签只改变提交字段，并使旧 AI 建议与任务过期', async () => {
  const b = bookmark('a', { category: '工具', title: '后台新标题', tags: ['原标签'], summary: '现有摘要' });
  const backend = backendFor(['a'], {
    native: [nativeBookmark('a', { title: b.title })], bookmarks: [b],
    tasks: [task('a')], drafts: [{ bookmarkId: 'a', revision: 1 }],
  });
  await backend.service.handleMessage({ type: 'EDIT', id: 'a', changes: { tags: [' React ', 'react'] } });
  const saved = await backend.db.bookmarks.get('a');
  assert.equal(saved.title, '后台新标题');
  assert.equal(saved.category, '工具');
  assert.equal(saved.summary, '现有摘要');
  assert.deepEqual(saved.tags, ['React']);
  assert.equal(saved.manual, true);
  assert.equal(saved.revision, 2);
  assert.equal(await backend.db.tasks.get('a'), undefined);
  assert.equal(await backend.db.drafts.get('a'), undefined);
  assert.equal(backend.metrics.nativeUpdates, 0);
});

test('只编辑标题不提交旧分类或标签，并同步原生书签标题', async () => {
  const backend = backendFor(['a'], { bookmarks: [bookmark('a', { category: '工具', tags: ['最新标签'] })] });
  await backend.service.handleMessage({ type: 'EDIT', id: 'a', changes: { title: ' 用户新标题 ' } });
  const b = await backend.db.bookmarks.get('a');
  assert.equal(b.title, '用户新标题');
  assert.equal(b.category, '工具');
  assert.deepEqual(b.tags, ['最新标签']);
  assert.equal(backend.metrics.nativeUpdates, 1);
  assert.equal((await backend.browser.bookmarks.getTree())[0].title, '用户新标题');
});

test('标题已写入后本地整理保存失败时说明部分成功，并保留错误原因', async () => {
  const backend = backendFor(['a'], { bookmarks: [bookmark('a', { tags: ['原标签'] })] });
  const failure = new Error('IndexedDB 写入失败');
  backend.db.bookmarks.update = async () => { throw failure; };
  await assert.rejects(backend.service.handleMessage({ type: 'EDIT', id: 'a', changes: { title: '新标题', tags: ['新标签'] } }), error => {
    assert.equal(error.message, '标题已更新，本地整理数据保存失败，请重试');
    assert.equal(error.cause, failure);
    return true;
  });
  assert.equal((await backend.browser.bookmarks.getTree())[0].title, '新标题');
  assert.deepEqual((await backend.db.bookmarks.get('a')).tags, ['原标签']);
});

test('标题已写入后原生同步失败也保留部分成功与原始原因', async () => {
  const failure = new Error('读取原生书签失败');
  let failSync = true;
  const backend = backendFor(['a'], { getTree: native => { if (failSync) throw failure; return native; } });
  await assert.rejects(backend.service.handleMessage({ type: 'EDIT', id: 'a', changes: { title: '新标题' } }), error => {
    assert.equal(error.message, '标题已更新，本地整理数据保存失败，请重试');
    assert.equal(error.cause, failure);
    return true;
  });
  failSync = false;
  assert.equal((await backend.browser.bookmarks.getTree())[0].title, '新标题');
});

test('标题请求本身失败时保留原始错误，不报告标题已更新', async () => {
  const backend = backendFor();
  const failure = new Error('Chrome 标题更新失败');
  backend.browser.bookmarks.update = async () => { throw failure; };
  await assert.rejects(backend.service.handleMessage({ type: 'EDIT', id: 'a', changes: { title: '新标题' } }), error => error === failure);
});

test('没有标题补丁的整理失败不会报告标题已更新', async () => {
  const backend = backendFor();
  const failure = new Error('IndexedDB 写入失败');
  backend.db.bookmarks.update = async () => { throw failure; };
  await assert.rejects(backend.service.handleMessage({ type: 'EDIT', id: 'a', changes: { tags: ['新标签'] } }), error => error === failure);
  assert.equal(backend.metrics.nativeUpdates, 0);
});

test('AI 请求期间清空手动标签，晚到的结果不能覆盖', async () => {
  let backend;
  backend = backendFor(['a'], { tasks: [task('a', { mode: 'auto' })], classify: async (_settings, items) => {
    await backend.service.handleMessage({ type: 'EDIT', id: 'a', changes: { tags: [] } });
    return items.map(item => ({ id: item.id, category: '开发', tags: ['AI标签'], summary: '摘要', confidence: .9 }));
  } });
  await backend.service.pump();
  const saved = await backend.db.bookmarks.get('a');
  assert.deepEqual(saved.tags, []);
  assert.equal(saved.manual, true);
  assert.equal(await backend.db.drafts.get('a'), undefined);
});

test('加入稍后读不会改变 AI 版本、手动保护或已有任务', async () => {
  const b = bookmark('a', { manual: true, revision: 3 });
  const work = task('a', { revision: 3 });
  const backend = backendFor(['a'], { bookmarks: [b], tasks: [work] });
  await backend.service.handleMessage({ type: 'SET_READING', id: 'a', state: 'later' });
  assert.deepEqual(await backend.db.bookmarks.get('a'), { ...b, readingState: 'later' });
  assert.deepEqual(await backend.db.tasks.get('a'), work);
});

test('AI 请求期间加入稍后读，分类结果和阅读状态都保留', async () => {
  let backend;
  backend = backendFor(['a'], { tasks: [task('a', { mode: 'auto' })], classify: async (_settings, items) => {
    await backend.service.handleMessage({ type: 'SET_READING', id: 'a', state: 'later' });
    return items.map(item => ({ id: item.id, category: '开发', tags: ['代码'], summary: '摘要', confidence: .9 }));
  } });
  await backend.service.pump();
  const saved = await backend.db.bookmarks.get('a');
  assert.equal(saved.readingState, 'later');
  assert.equal(saved.category, '开发');
});

test('重复加入阅读中的书签保留状态和进度；已读重加从头阅读', async () => {
  const backend = backendFor(['a'], { bookmarks: [bookmark('a', { readingState: 'reading' })], snapshots: [snapshot('a')] });
  await backend.service.handleMessage({ type: 'SET_READING', id: 'a', state: 'later' });
  assert.equal((await backend.db.bookmarks.get('a')).readingState, 'reading');
  assert.equal((await backend.db.snapshots.get('a')).progress, .4);
  await backend.service.handleMessage({ type: 'SET_READING', id: 'a', state: 'read' });
  await backend.service.handleMessage({ type: 'SET_READING', id: 'a', state: 'later' });
  assert.equal((await backend.db.bookmarks.get('a')).readingState, 'later');
  assert.equal((await backend.db.snapshots.get('a')).progress, 0);
});

test('旧界面自动打开不能把已读或已移出的书签重新加入阅读中', async () => {
  const backend = backendFor(['a', 'b'], { bookmarks: [bookmark('a', { readingState: 'read' }), bookmark('b', { readingState: 'none' })] });
  await backend.service.handleMessage({ type: 'SET_READING', id: 'a', state: 'reading' });
  await backend.service.handleMessage({ type: 'SET_READING', id: 'b', state: 'reading' });
  assert.equal((await backend.db.bookmarks.get('a')).readingState, 'read');
  assert.equal((await backend.db.bookmarks.get('b')).readingState, 'none');
});

test('重新保存同网址快照重置阅读位置并保留阅读安排', async () => {
  const backend = backendFor(['a'], { bookmarks: [bookmark('a', { readingState: 'reading' })], snapshots: [snapshot('a')] });
  const saved = await backend.service.handleMessage({ type: 'SAVE', url: 'https://example.com/a', title: '标题', snapshot: { url: 'https://example.com/a', html: '<p>新正文</p>', text: '新正文' } });
  assert.deepEqual(saved, { id: 'a', existed: true });
  const updated = await backend.db.snapshots.get('a');
  assert.equal(updated.progress, 0);
  assert.equal(updated.text, '新正文');
  assert.equal((await backend.db.bookmarks.get('a')).readingState, 'reading');
});

test('同一毫秒连续保存快照仍更新正文版本，旧阅读页不能回写', async () => {
  const backend = backendFor(['a'], { bookmarks: [bookmark('a', { category: '工具', manual: true })] });
  const now = Date.now;
  Date.now = () => 100;
  try {
    for (const text of ['第一份正文', '第二份正文']) await backend.service.handleMessage({ type: 'SAVE', url: 'https://example.com/a', title: '标题', snapshot: { url: 'https://example.com/a', html: `<p>${text}</p>`, text } });
    assert.equal((await backend.db.snapshots.get('a')).capturedAt, 101);
    assert.equal((await backend.db.snapshots.get('a')).text, '第二份正文');
    assert.equal(await backend.service.handleMessage({ type: 'SAVE_PROGRESS', id: 'a', capturedAt: 100, progress: .8 }), false);
  } finally { Date.now = now; }
});

test('原生网址改变会清除阅读安排与旧快照', async () => {
  const backend = backendFor(['a'], { bookmarks: [bookmark('a', { readingState: 'reading' })], snapshots: [snapshot('a')] });
  backend.setNative([nativeBookmark('a', { url: 'https://example.com/new' })]);
  await backend.service.syncBookmarks();
  assert.equal((await backend.db.bookmarks.get('a')).readingState, 'none');
  assert.equal(await backend.db.snapshots.get('a'), undefined);
});

test('保存阅读位置只更新当前快照，旧快照与异常值不能覆盖', async () => {
  const b = bookmark('a', { readingState: 'reading', manual: true });
  const backend = backendFor(['a'], { bookmarks: [b], snapshots: [snapshot('a')] });
  assert.equal(await backend.service.handleMessage({ type: 'SAVE_PROGRESS', id: 'a', capturedAt: 10, progress: .8 }), true);
  assert.deepEqual(await backend.db.bookmarks.get('a'), b);
  assert.deepEqual(await backend.db.snapshots.get('a'), snapshot('a', { progress: .8 }));
  assert.equal(await backend.service.handleMessage({ type: 'SAVE_PROGRESS', id: 'a', capturedAt: 9, progress: .2 }), false);
  assert.equal((await backend.db.snapshots.get('a')).progress, .8);
  await assert.rejects(backend.service.handleMessage({ type: 'SAVE_PROGRESS', id: 'a', capturedAt: 10, progress: NaN }), /阅读位置/);
  await assert.rejects(backend.service.handleMessage({ type: 'SAVE_PROGRESS', id: 'a', capturedAt: 10, progress: 2 }), /阅读位置/);
});

test('批量添加和移除标签逐条保留其他标签，并只处理仍存在的选中书签', async () => {
  const backend = backendFor(['a', 'b'], { bookmarks: [bookmark('a', { tags: ['React'] }), bookmark('b', { tags: ['后端'] })] });
  const added = await backend.service.handleMessage({ type: 'BULK_EDIT', ids: ['a', 'b', 'deleted'], changes: { tags: { operation: 'add', values: ['前端', 'react'] } } });
  assert.deepEqual(added, { applied: 2, skipped: 1 });
  assert.deepEqual((await backend.db.bookmarks.get('a')).tags, ['React', '前端']);
  assert.deepEqual((await backend.db.bookmarks.get('b')).tags, ['后端', '前端', 'react']);
  await backend.service.handleMessage({ type: 'BULK_EDIT', ids: ['a', 'b'], changes: { tags: { operation: 'remove', values: ['REACT'] } } });
  assert.deepEqual((await backend.db.bookmarks.get('a')).tags, ['前端']);
  assert.deepEqual((await backend.db.bookmarks.get('b')).tags, ['后端', '前端']);
});

test('批量标签超过上限时整批不写入，保留任务和原有整理信息', async () => {
  const original = [bookmark('a', { tags: ['原标签'] }), bookmark('b', { tags: Array.from({ length: 20 }, (_, i) => `标签 ${i}`) })];
  const backend = backendFor(['a', 'b'], { bookmarks: original, tasks: [task('a'), task('b')] });
  await assert.rejects(backend.service.handleMessage({ type: 'BULK_EDIT', ids: ['a', 'b'], changes: { category: '工具', tags: { operation: 'add', values: ['新增'] } } }), /20/);
  assert.deepEqual(await backend.db.bookmarks.toArray(), original);
  assert.equal(await backend.db.tasks.count(), 2);
});

test('批量只更新阅读状态，不取消后台任务或更改手动保护', async () => {
  const original = [bookmark('a'), bookmark('b', { readingState: 'reading', manual: true })];
  const backend = backendFor(['a', 'b'], { bookmarks: original, tasks: [task('a'), task('b')] });
  assert.deepEqual(await backend.service.handleMessage({ type: 'BULK_EDIT', ids: ['a', 'b'], changes: { readingState: 'read' } }), { applied: 2, skipped: 0 });
  for (const b of original) assert.deepEqual(await backend.db.bookmarks.get(b.id), { ...b, readingState: 'read' });
  assert.equal(await backend.db.tasks.count(), 2);
});
