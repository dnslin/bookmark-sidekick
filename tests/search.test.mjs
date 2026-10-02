import test from 'node:test';
import assert from 'node:assert/strict';
import Fuse from 'fuse.js';
import { filterBookmarks } from '../src/library.ts';
import { loadModule } from './helpers/load-module.mjs';

const rows = [
  { id: 'a', title: 'React 文档', url: 'https://react.dev', category: '开发', tags: ['前端'], summary: '用户界面教程' },
  { id: 'b', title: '界面设计', url: 'https://example.com/design', category: '设计', tags: ['前端'], summary: 'React 组件设计' },
  { id: 'c', title: 'TypeScript 文档', url: 'https://typescriptlang.org', category: '', tags: ['类型'], summary: '开发工具' },
];
const options = { keys: [{ name: 'title', weight: 3 }, 'url', 'category', 'tags', 'summary'], threshold: 0.36, ignoreLocation: true };
const load = dependencies => loadModule(new URL('../src/search.ts', import.meta.url), dependencies);

test('搜索保留原有匹配、排序、分类和标签筛选结果', () => {
  const { createBookmarkSearch } = load({ 'fuse.js': { default: Fuse } });
  for (const [category, tag] of [[null, ''], ['开发', ''], [null, '前端'], ['', '类型']]) {
    const scoped = filterBookmarks(rows, category, tag);
    const search = createBookmarkSearch(scoped);
    for (const query of ['', '  ', ' React ', '前端', '开发', 'not-found']) {
      const expected = query.trim() ? new Fuse(scoped, options).search(query.trim()).map(result => result.item) : scoped;
      assert.deepEqual(search(query), expected);
    }
  }
});

test('同一集合的连续查询只建一次索引，空查询不建索引', () => {
  let indexes = 0;
  class CountingFuse extends Fuse {
    constructor(...args) { super(...args); indexes++; }
  }
  const { createBookmarkSearch } = load({ 'fuse.js': { default: CountingFuse } });
  const search = createBookmarkSearch(rows);
  assert.deepEqual(search(' '), rows);
  assert.equal(indexes, 0);
  assert.equal(search('React')[0].id, 'a');
  assert.equal(search('TypeScript')[0].id, 'c');
  search('界面');
  assert.equal(indexes, 1);
});

test('替换集合后新索引包含新增和修改的数据', () => {
  const { createBookmarkSearch } = load({ 'fuse.js': { default: Fuse } });
  const original = createBookmarkSearch(rows);
  assert.equal(original('Rust').length, 0);
  const changed = createBookmarkSearch([{ ...rows[0], title: 'Rust 文档' }]);
  assert.equal(changed('Rust')[0].id, 'a');
  assert.equal(changed('TypeScript').length, 0);
});
