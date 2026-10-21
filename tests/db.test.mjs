import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-module.mjs';

test('v2 升级补齐阅读字段、保留原数据并为快照建立抓取时间索引', async () => {
  const versions = new Map();
  class Database {
    version(number) {
      const schema = { stores: {}, upgrade: null };
      versions.set(number, schema);
      const chain = {
        stores(stores) { schema.stores = stores; return chain; },
        upgrade(callback) { schema.upgrade = callback; return chain; },
      };
      return chain;
    }
  }
  loadModule(new URL('../src/db.ts', import.meta.url), { dexie: { default: Database } });
  assert.equal(versions.get(2).stores.snapshots, '&bookmarkId, capturedAt');
  const rows = {
    bookmarks: [{ id: 'a', title: '原标题', category: '开发', tags: ['旧标签'], revision: 5, manual: true }],
    snapshots: [{ bookmarkId: 'a', html: '<p>原正文</p>', text: '原正文', capturedAt: 10 }],
  };
  await versions.get(2).upgrade({ table(name) { return { toCollection() { return { async modify(callback) { rows[name].forEach(callback); } }; } }; } });
  assert.deepEqual(rows.bookmarks[0], { id: 'a', title: '原标题', category: '开发', tags: ['旧标签'], revision: 5, manual: true, readingState: 'none' });
  assert.deepEqual(rows.snapshots[0], { bookmarkId: 'a', html: '<p>原正文</p>', text: '原正文', capturedAt: 10, progress: 0 });
});
