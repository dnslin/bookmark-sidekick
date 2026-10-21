import test from 'node:test';
import assert from 'node:assert/strict';
import * as library from '../src/library.ts';
const { groupBookmarksByDate, filterBookmarks } = library;

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

test('稍后读只包含主动加入的待读和阅读中，分类与标签继续取交集', () => {
  const rows = [
    { ...bookmark('none', 5, '开发', ['前端']), readingState: 'none' },
    { ...bookmark('later', 4, '开发', ['前端']), readingState: 'later' },
    { ...bookmark('reading', 3, '设计', ['前端']), readingState: 'reading' },
    { ...bookmark('read', 2, '开发', ['前端']), readingState: 'read' },
  ];
  assert.deepEqual(filterBookmarks(rows, null, '', 'later', 'pending').map(b => b.id), ['later', 'reading']);
  assert.deepEqual(filterBookmarks(rows, '开发', '前端', 'later', 'pending').map(b => b.id), ['later']);
  assert.deepEqual(filterBookmarks(rows, null, '', 'later', 'read').map(b => b.id), ['read']);
  assert.deepEqual(filterBookmarks(rows, null, '', 'all', 'read').map(b => b.id), ['none', 'later', 'reading', 'read']);
});

test('阅读列表优先显示阅读中，同一阅读状态按收藏时间倒序', () => {
  const rows = [
    { ...bookmark('old-later', 1), readingState: 'later' },
    { ...bookmark('reading', 2), readingState: 'reading' },
    { ...bookmark('new-later', 5), readingState: 'later' },
    { ...bookmark('read', 3), readingState: 'read' },
  ];
  assert.deepEqual(library.groupBookmarksForReading(rows).map(group => [group.label, group.bookmarks.map(b => b.id)]), [
    ['阅读中', ['reading']], ['待读', ['new-later', 'old-later']], ['已读', ['read']],
  ]);
});
