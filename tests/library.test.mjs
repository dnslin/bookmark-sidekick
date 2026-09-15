import test from 'node:test';
import assert from 'node:assert/strict';
import { groupBookmarksByDate, filterBookmarks } from '../src/library.ts';

const bookmark = (id, addedAt, category = '', tags = []) => ({ id, addedAt, category, tags });
test('收藏按本地日历边界分为今天、昨天和更早，保留组内顺序', () => {
  const now = new Date(2026, 8, 15, 8);
  const rows = [bookmark('a', new Date(2026, 8, 15).getTime()), bookmark('b', new Date(2026, 8, 14, 23, 59).getTime()), bookmark('c', new Date(2026, 8, 14).getTime()), bookmark('d', new Date(2026, 8, 13, 23, 59).getTime())];
  assert.deepEqual(groupBookmarksByDate(rows, now).map(g => [g.label, g.bookmarks.map(b => b.id)]), [['今天', ['a']], ['昨天', ['b', 'c']], ['更早', ['d']]]);
  assert.deepEqual(groupBookmarksByDate([], now), []);
});
test('未分类筛选区别于全部，分类与标签同时生效', () => {
  const rows = [bookmark('a', 1, '', ['界面设计']), bookmark('b', 2, '设计', ['界面设计']), bookmark('c', 3, '设计', ['前端'])];
  assert.equal(filterBookmarks(rows, null, '').length, 3);
  assert.deepEqual(filterBookmarks(rows, '', '').map(b => b.id), ['a']);
  assert.deepEqual(filterBookmarks(rows, '设计', '界面设计').map(b => b.id), ['b']);
  assert.deepEqual(filterBookmarks(rows, null, '不存在'), []);
});
