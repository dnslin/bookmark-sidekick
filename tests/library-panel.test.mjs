import test from 'node:test';
import assert from 'node:assert/strict';
import { createComponentHarness } from './helpers/component-harness.mjs';
import { loadModule } from './helpers/load-module.mjs';
import * as library from '../src/library.ts';
import * as domain from '../src/domain.ts';

const bookmark = id => ({ id, title: `书签 ${id}`, url: `https://example.com/${id}`, category: '开发', tags: ['前端'], addedAt: 1, readingState: 'none', linkState: 'unknown' });
const BulkEditor = () => null;
function setup(overrides = {}) {
  const harness = createComponentHarness();
  const components = loadModule(new URL('../src/components/LibraryPanel.tsx', import.meta.url), {
    react: harness.hooks,
    'motion/react': { motion: { main: 'main' }, useReducedMotion: () => true },
    '../library': library,
    '../domain': domain,
    './SiteIcon': { SiteIcon: () => null },
    './BulkEditor': { BulkEditor },
    './HighlightedText': { HighlightedText: () => null },
  });
  const props = { bookmarks: [bookmark('a'), bookmark('b')], totalCount: 3, pendingCount: 0, readCount: 0, query: '', category: null, tag: '', scope: 'all', readingFilter: 'pending', categories: ['开发'], availableTags: [], busy: false, ready: true, searchState: { hits: [], terms: [], snapshotCount: 0, status: 'idle', error: '', retry() {} }, run: async (_label, fn) => { await fn(); return true; }, notify() {}, onScopeChange() {}, onReadingFilterChange() {}, onShowAll() {}, onOpen() {}, onDetails() {}, onReadingMenu() {}, onReadMatch() {}, onRefresh() {}, ...overrides };
  const render = () => harness.render(components.LibraryPanel, props);
  render();
  return { harness, props, render, ...components };
}
const button = (harness, name) => harness.find(node => node.type === 'button' && node.props.children === name);

test('整理时全选只提交当前结果，取消面板保留选择', () => {
  const { harness, props, render, BookmarkRow } = setup();
  button(harness, '整理').props.onClick(); render();
  const rows = harness.nodes(node => node.type === BookmarkRow);
  rows[0].props.onSelect(); render();
  const all = harness.find(node => node.type === 'input' && node.props['aria-label'] === '选择当前结果');
  all.props.onChange(); render();
  button(harness, '批量修改').props.onClick(); render();
  let modal = harness.find(node => node.type === BulkEditor);
  assert.deepEqual(modal.props.ids, ['a', 'b']);
  assert.equal(props.totalCount, 3);
  modal.props.onClose(); render();
  button(harness, '批量修改').props.onClick(); render();
  modal = harness.find(node => node.type === BulkEditor);
  assert.deepEqual(modal.props.ids, ['a', 'b']);
});

test('修改搜索条件退出整理并清除选择，成功提交也退出整理', () => {
  const { harness, props, render, BookmarkRow } = setup();
  button(harness, '整理').props.onClick(); render();
  harness.find(node => node.type === BookmarkRow).props.onSelect(); render();
  props.query = '新查询'; props.searchState = { ...props.searchState, status: 'ready' }; render();
  assert.ok(button(harness, '整理'));
  assert.equal(harness.nodes(node => node.type === BulkEditor).length, 0);
  props.query = ''; render();
  button(harness, '整理').props.onClick(); render();
  harness.find(node => node.type === BookmarkRow).props.onSelect(); render();
  button(harness, '批量修改').props.onClick(); render();
  harness.find(node => node.type === BulkEditor).props.onApplied({ applied: 1, skipped: 0 }); render();
  assert.ok(button(harness, '整理'));
});

test('书签行在整理模式只选择，不打开网页', () => {
  const { harness, BookmarkRow } = setup();
  let opens = 0; let selected = 0;
  const props = { bookmark: bookmark('a'), selected: false, organizing: true, busy: false, onOpen() { opens++; }, onSelect() { selected++; }, onDetails() {}, onReadingMenu() {} };
  harness.render(BookmarkRow, props);
  harness.find(node => node.type === 'button' && node.props.className === 'bookmark-main').props.onClick();
  assert.equal(selected, 1); assert.equal(opens, 0);
  props.organizing = false; harness.render(BookmarkRow, props);
  harness.find(node => node.type === 'button' && node.props.className === 'bookmark-main').props.onClick();
  assert.equal(opens, 1);
});

test('正文搜索失败显示重试入口，不显示空结果并禁止整理', () => {
  let retries = 0;
  const { harness } = setup({ query: '正文', bookmarks: [], searchState: { hits: [], terms: [], snapshotCount: 0, status: 'error', error: '读取失败', retry() { retries++; } } });
  assert.ok(harness.find(node => node.props.role === 'alert'));
  button(harness, '重试搜索').props.onClick();
  assert.equal(retries, 1);
  assert.equal(button(harness, '整理').props.disabled, true);
  assert.equal(harness.nodes(node => node.props.children === '没有找到匹配的书签').length, 0);
});
