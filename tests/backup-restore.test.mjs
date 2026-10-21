import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-module.mjs';
import * as backupFormat from '../src/backup-format.ts';
import * as domain from '../src/domain.ts';

const bookmark = (id, title, folder = '书签栏 / 开发', changes = {}) => ({
  id, title, folder, url: 'https://example.com/', addedAt: 100,
  revision: 4, category: '', tags: [], summary: '', manual: false, linkState: 'unknown', readingState: 'none',
  ...changes,
});
const entry = (title, category, folder = '书签栏 / 开发', changes = {}) => ({
  title, category, folder, url: 'https://example.com/', tags: [], summary: category, readingState: 'none',
  ...changes,
});
const settings = {
  baseUrl: 'https://api.example.com/v1', apiKey: 'test-key', model: 'test-model',
  categories: ['开发', '自定义'], consent: true, paused: true,
};

function table(records, key) {
  const rows = new Map(records.map(record => [record[key], structuredClone(record)]));
  return {
    rows,
    async get(id) { const record = rows.get(id); return record ? structuredClone(record) : undefined; },
    async toArray() { return [...rows.values()].map(record => structuredClone(record)); },
    async update(id, changes) { rows.set(id, { ...rows.get(id), ...structuredClone(changes) }); },
    async delete(id) { rows.delete(id); },
    async put(record) { rows.set(record[key], structuredClone(record)); },
  };
}

function harness(bookmarks, { snapshots = [], drafts = [], tasks = [], storedSettings = settings } = {}) {
  let currentSettings = structuredClone(storedSettings);
  globalThis.chrome = {
    storage: { local: {
      async get() { return { settings: structuredClone(currentSettings) }; },
      async set(input) { currentSettings = structuredClone(input.settings); },
    } },
  };
  const db = {
    bookmarks: table(bookmarks, 'id'), snapshots: table(snapshots, 'bookmarkId'),
    drafts: table(drafts, 'bookmarkId'), tasks: table(tasks, 'bookmarkId'),
    async transaction(...args) { return args.at(-1)(); },
  };
  const actualSettings = loadModule(new URL('../src/settings.ts', import.meta.url), { './domain': domain });
  const backup = loadModule(new URL('../src/backup.ts', import.meta.url), {
    './db': { db }, './settings': actualSettings, './backup-format': backupFormat,
  });
  return { db, ...backup, get settings() { return currentSettings; } };
}

test('导出后跨设备恢复，同网址同文件夹的不同标题不交换分类、摘要和快照', async () => {
  const source = harness([
    bookmark('old-a', '文档 A', undefined, { category: '开发', tags: ['A'], summary: '摘要 A' }),
    bookmark('old-b', '文档 B', undefined, { category: '自定义', tags: ['B'], summary: '摘要 B' }),
  ], { snapshots: [
    { bookmarkId: 'old-a', url: 'https://example.com/', html: '<p>A</p>', text: '正文 A', capturedAt: 1, progress: .3 },
    { bookmarkId: 'old-b', url: 'https://example.com/', html: '<p>B</p>', text: '正文 B', capturedAt: 2, progress: .7 },
  ] });
  const exported = await source.exportBackup();
  const untouched = bookmark('unrelated', '其他', undefined, { url: 'https://other.example/' });
  const target = harness([bookmark('new-b', '文档 B'), bookmark('new-a', '文档 A'), untouched], {
    drafts: [{ bookmarkId: 'new-a' }, { bookmarkId: 'new-b' }, { bookmarkId: 'unrelated' }],
    tasks: [{ bookmarkId: 'new-a' }, { bookmarkId: 'new-b' }, { bookmarkId: 'unrelated' }],
  });

  const result = await target.importBackup(exported);

  assert.equal(result.restored, 2);
  assert.equal(result.skipped, 0);
  for (const [id, title, category, letter, capturedAt] of [
    ['new-a', '文档 A', '开发', 'A', 1], ['new-b', '文档 B', '自定义', 'B', 2],
  ]) {
    assert.deepEqual(target.db.bookmarks.rows.get(id), bookmark(id, title, undefined, {
      category, tags: [letter], summary: `摘要 ${letter}`, manual: true, revision: 5,
    }));
    assert.deepEqual(target.db.snapshots.rows.get(id), {
      bookmarkId: id, url: 'https://example.com/', html: `<p>${letter}</p>`, text: `正文 ${letter}`, capturedAt, progress: letter === 'A' ? .3 : .7,
    });
  }
  assert.deepEqual(target.db.bookmarks.rows.get('unrelated'), untouched);
  assert.deepEqual([...target.db.drafts.rows.keys()], ['unrelated']);
  assert.deepEqual([...target.db.tasks.rows.keys()], ['unrelated']);
  assert.deepEqual(target.settings, { ...settings, paused: false });
});

test('同网址和文件夹有多个候选且标题不匹配时跳过，保留本地数据', async () => {
  const bookmarks = [bookmark('a', '文档 A'), bookmark('b', '文档 B')];
  const snapshot = { bookmarkId: 'a', url: 'https://example.com/', html: 'local', text: 'local', capturedAt: 9, progress: .6 };
  const target = harness(bookmarks, {
    drafts: [{ bookmarkId: 'a' }], tasks: [{ bookmarkId: 'a' }], snapshots: [snapshot],
  });

  const result = await target.importBackup({ format: 'bookmark-sidekick', version: 3, settings,
    entries: [entry('旧标题', '自定义', undefined, { snapshot: { html: 'backup', text: 'backup', capturedAt: 1, progress: 0 } })],
  });

  assert.equal(result.restored, 0);
  assert.equal(result.skipped, 1);
  assert.deepEqual(await target.db.bookmarks.toArray(), bookmarks);
  assert.deepEqual(await target.db.snapshots.toArray(), [snapshot]);
  assert.deepEqual([...target.db.drafts.rows.keys()], ['a']);
  assert.deepEqual([...target.db.tasks.rows.keys()], ['a']);
});

test('网址、文件夹和标题均相同的多个本地书签仍有歧义，不能任选一个恢复', async () => {
  const target = harness([bookmark('a', '文档'), bookmark('b', '文档')]);
  const result = await target.importBackup({ format: 'bookmark-sidekick', version: 3, settings, entries: [entry('文档', '开发')] });

  assert.equal(result.restored, 0);
  assert.equal(result.skipped, 1);
  assert.deepEqual([...target.db.bookmarks.rows.values()].map(row => row.category), ['', '']);
});

test('同一匹配层级有多个备份条目争用一个目标时跳过，不能任选一个分类', async () => {
  for (const title of ['文档', '新标题']) {
    const original = bookmark('new', title);
    const target = harness([original]);
    const result = await target.importBackup({ format: 'bookmark-sidekick', version: 3, settings, entries: [
      entry('文档', '分类 A'), entry('文档', '分类 B'),
    ] });

    assert.equal(result.restored, 0);
    assert.equal(result.skipped, 2);
    assert.deepEqual(target.db.bookmarks.rows.get('new'), original);
  }
});

test('前面的唯一网址回退不能消耗后面按网址、文件夹和标题精确匹配的目标', async () => {
  const target = harness([bookmark('new', '文档')]);
  const result = await target.importBackup({ format: 'bookmark-sidekick', version: 3, settings, entries: [
    entry('已删除', '旧分类', '已删除文件夹'), entry('文档', '精确分类'),
  ] });

  assert.equal(result.restored, 1);
  assert.equal(result.skipped, 1);
  assert.equal(target.db.bookmarks.rows.get('new').category, '精确分类');
});

test('先恢复精确条目，再按剩余的唯一网址和文件夹恢复标题已变更的条目', async () => {
  const target = harness([bookmark('a', '文档 A'), bookmark('b', '文档 B 新标题')]);
  const result = await target.importBackup({ format: 'bookmark-sidekick', version: 3, settings, entries: [
    entry('文档 B 旧标题', 'B 分类'), entry('文档 A', 'A 分类'),
  ] });

  assert.equal(result.restored, 2);
  assert.equal(result.skipped, 0);
  assert.equal(target.db.bookmarks.rows.get('a').category, 'A 分类');
  assert.equal(target.db.bookmarks.rows.get('b').category, 'B 分类');
});

test('网址和文件夹的唯一匹配优先于更早的唯一网址回退', async () => {
  const target = harness([bookmark('new', '新标题')]);
  const result = await target.importBackup({ format: 'bookmark-sidekick', version: 3, settings, entries: [
    entry('旧标题', '网址分类', '旧文件夹'), entry('旧标题', '文件夹分类'),
  ] });

  assert.equal(result.restored, 1);
  assert.equal(result.skipped, 1);
  assert.equal(target.db.bookmarks.rows.get('new').category, '文件夹分类');
});

test('v3 唯一网址恢复包含 20 个标签、阅读状态、位置和模型配置', async () => {
  const current = { ...settings, categories: ['现有分类'], model: 'current-model' };
  const target = harness([bookmark('new', '新标题', '新文件夹')], { storedSettings: current });
  const tags = Array.from({ length: 20 }, (_, i) => `标签${i}`);
  const result = await target.importBackup({ format: 'bookmark-sidekick', version: 3, settings,
    entries: [entry('旧标题', '备份分类', '旧文件夹', { tags, readingState: 'reading', snapshot: { html: '<p>正文</p>', text: '正文', capturedAt: 40, progress: .64 } })],
  });

  assert.equal(result.restored, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.categoryCount, 2);
  assert.deepEqual(target.settings, { ...settings, paused: false });
  assert.equal(target.db.bookmarks.rows.get('new').category, '备份分类');
  assert.deepEqual(target.db.bookmarks.rows.get('new').tags, tags);
  assert.equal(target.db.bookmarks.rows.get('new').readingState, 'reading');
  assert.equal(target.db.snapshots.rows.get('new').progress, .64);
  assert.equal(target.db.snapshots.rows.get('new').capturedAt, 40);
});

test('重复恢复同一备份不回退正文版本，旧阅读页始终不能回写', async () => {
  const current = { bookmarkId: 'a', url: 'https://example.com/', html: '<p>旧正文</p>', text: '旧正文', capturedAt: 100, progress: .6 };
  const target = harness([bookmark('a', '文档')], { snapshots: [current] });
  const input = { format: 'bookmark-sidekick', version: 3, settings, entries: [entry('文档', '开发', undefined, { readingState: 'reading', snapshot: { html: '<p>新正文</p>', text: '新正文', capturedAt: 100, progress: .4 } })] };
  const service = loadModule(new URL('../src/service.ts', import.meta.url), { './db': { db: target.db }, './domain': domain, './settings': {}, './llm': {} });
  await target.importBackup(input);
  assert.equal(target.db.snapshots.rows.get('a').capturedAt, 101);
  assert.equal(target.db.snapshots.rows.get('a').progress, .4);
  assert.equal(await service.handleMessage({ type: 'SAVE_PROGRESS', id: 'a', capturedAt: 100, progress: .9 }), false);
  await target.importBackup(input);
  assert.equal(target.db.snapshots.rows.get('a').capturedAt, 101);
  assert.equal(await service.handleMessage({ type: 'SAVE_PROGRESS', id: 'a', capturedAt: 100, progress: .9 }), false);
  assert.equal(target.db.snapshots.rows.get('a').progress, .4);
});

test('恢复更旧的不同正文仍递增版本并拒绝此前阅读页', async () => {
  const current = { bookmarkId: 'a', url: 'https://example.com/', html: '<p>当前正文</p>', text: '当前正文', capturedAt: 200, progress: .6 };
  const target = harness([bookmark('a', '文档')], { snapshots: [current] });
  await target.importBackup({ format: 'bookmark-sidekick', version: 3, settings, entries: [entry('文档', '开发', undefined, { snapshot: { html: '<p>备份正文</p>', text: '备份正文', capturedAt: 50, progress: .2 } })] });
  const service = loadModule(new URL('../src/service.ts', import.meta.url), { './db': { db: target.db }, './domain': domain, './settings': {}, './llm': {} });
  assert.equal(target.db.snapshots.rows.get('a').capturedAt, 201);
  assert.equal(await service.handleMessage({ type: 'SAVE_PROGRESS', id: 'a', capturedAt: 200, progress: .9 }), false);
  assert.equal(target.db.snapshots.rows.get('a').progress, .2);
});

test('相同正文恢复保留当前版本且重复操作幂等', async () => {
  const current = { bookmarkId: 'a', url: 'https://example.com/', html: '<p>同一正文</p>', text: '同一正文', capturedAt: 100, progress: .6 };
  const target = harness([bookmark('a', '文档')], { snapshots: [current] });
  const input = { format: 'bookmark-sidekick', version: 3, settings, entries: [entry('文档', '开发', undefined, { snapshot: { html: current.html, text: current.text, capturedAt: 500, progress: .4 } })] };
  await target.importBackup(input);
  const first = structuredClone(target.db.snapshots.rows.get('a'));
  assert.equal(first.capturedAt, 100);
  assert.equal(first.progress, .4);
  await target.importBackup(input);
  assert.deepEqual(target.db.snapshots.rows.get('a'), first);
});
