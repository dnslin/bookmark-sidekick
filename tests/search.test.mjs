import test from 'node:test';
import assert from 'node:assert/strict';
import Fuse from 'fuse.js';
import * as domain from '../src/domain.ts';
import { loadModule } from './helpers/load-module.mjs';

const load = (FuseClass = Fuse) => loadModule(new URL('../src/search.ts', import.meta.url), {
  'fuse.js': { default: FuseClass }, './domain': domain,
});
const bookmark = (id, extra = {}) => ({
  id, title: `Article ${id}`, url: `https://example.com/${id}`, category: '文章', tags: [], summary: '', addedAt: 100, ...extra,
});
const snapshot = (id, text, extra = {}) => ({bookmarkId: id, url: `https://example.com/${id}`, text, capturedAt: 100, ...extra});
const ids = result => result.hits.map(hit => hit.bookmarkId);

test('空查询不创建 Fuse 索引，搜索结果用书签 ID 返回', () => {
  let indexes = 0;
  class CountingFuse extends Fuse { constructor(...args) { super(...args); indexes++; } }
  const {createLibrarySearch} = load(CountingFuse);
  const index = createLibrarySearch([bookmark('a', {title:'React 文档'})]);
  assert.deepEqual(index.search(' ').hits, []);
  assert.equal(indexes, 0);
  assert.deepEqual(ids(index.search('React')), ['a']);
  const first = indexes;
  index.search('文档');
  assert.equal(indexes, first);
});

test('中文分词和多词 AND 可跨标题、标签与正文，英文不区分大小写', () => {
  const {createLibrarySearch} = load();
  const index = createLibrarySearch([
    bookmark('a', {title:'内存管理', tags:['Go']}),
    bookmark('b', {title:'内存管理'}),
    bookmark('c', {title:'Go 并发'}),
  ], [snapshot('a', '追踪 goroutine 泄漏与资源释放。'), snapshot('b', '只介绍内存分配。'), snapshot('c','追踪协程泄漏。')]);
  assert.deepEqual(ids(index.search('内存 泄漏')), ['a']);
  assert.deepEqual(ids(index.search('GO GOROUTINE')), ['a']);
  assert.deepEqual(ids(index.search('内存 泄漏 不存在')), []);
  assert.ok(index.search('内存泄漏').terms.length >= 2);
});

test('保留元数据模糊匹配，但正文不接受拼写错误', () => {
  const {createLibrarySearch} = load();
  const index = createLibrarySearch([bookmark('a', {title:'React documentation'}), bookmark('b')], [snapshot('b', 'React documentation')]);
  assert.deepEqual(ids(index.search('Ract')), ['a']);
  assert.deepEqual(ids(index.search('React')), ['a', 'b']);
});

test('标题与标签命中优先，其次其他元数据，再次仅正文；相同相关度按收藏倒序', () => {
  const {createLibrarySearch} = load();
  const index = createLibrarySearch([
    bookmark('body', {addedAt: 900}),
    bookmark('summary', {summary:'quartz', addedAt:800}),
    bookmark('old', {title:'quartz', addedAt:100}),
    bookmark('new', {title:'quartz', addedAt:200}),
    bookmark('tag', {tags:['quartz'], addedAt:300}),
  ], [snapshot('body','quartz')]);
  const result = ids(index.search('quartz'));
  assert.deepEqual(new Set(result.slice(0,3)), new Set(['old','new','tag']));
  assert.ok(result.indexOf('new') < result.indexOf('old'));
  assert.deepEqual(result.slice(3), ['summary','body']);
});

test('同一书签多字段多词命中只出现一次，正文片段和半开区间来自原文', () => {
  const {createLibrarySearch} = load();
  const text = 'React 介绍状态。状态更新之后，React 会重新渲染界面。';
  const index = createLibrarySearch([bookmark('a',{title:'React',tags:['React']})],[snapshot('a',text)]);
  const result = index.search('React 状态');
  assert.deepEqual(ids(result), ['a']);
  const snippet = result.hits[0].snippet;
  assert.ok(snippet);
  assert.ok(snippet.text.includes('React'));
  assert.ok(snippet.ranges.length);
  for (let i = 0; i < snippet.ranges.length; i++) {
    const [start,end] = snippet.ranges[i];
    assert.ok(start >= 0 && end > start && end <= snippet.text.length);
    assert.ok(['react','状态'].includes(snippet.text.slice(start,end).toLowerCase()));
    if (i) assert.ok(snippet.ranges[i-1][1] < start);
  }
});

test('五十万字符正文末尾可以命中，片段保留命中文本且不切坏表情', () => {
  const {createLibrarySearch} = load();
  const text = '填充内容'.repeat(124980) + '🙂 这段文字记录 goroutine 泄漏的排查结果。';
  assert.ok(text.length > 499900);
  const index = createLibrarySearch([bookmark('a')], [snapshot('a',text)]);
  const {hits} = index.search('goroutine 泄漏');
  assert.equal(hits.length,1);
  assert.ok(hits[0].snippet.text.includes('goroutine'));
  assert.ok(hits[0].snippet.text.includes('泄漏'));
  assert.ok(hits[0].snippet.text.length <= 120);
  assert.ok(!hits[0].snippet.text.includes('\uFFFD'));
});

test('没有快照仍可搜索元数据；HTML 不进入检索，过期 URL 的正文不命中', () => {
  const {createLibrarySearch} = load();
  const index = createLibrarySearch([bookmark('a',{title:'TypeScript'}),bookmark('b'),bookmark('c',{url:'https://example.com/new'})],[
    snapshot('b','普通正文',{html:'<p>secretword</p>'}), snapshot('c','secretword'),
  ]);
  assert.deepEqual(ids(index.search('TypeScript')), ['a']);
  assert.deepEqual(ids(index.search('secretword')), []);
  assert.equal(index.search('TypeScript').snapshotCount,1);
});

test('阅读状态与位置变化不重建索引，快照替换和删除后立即更新结果', () => {
  let indexes = 0;
  class CountingFuse extends Fuse { constructor(...args) { super(...args); indexes++; } }
  const {createLibrarySearch} = load(CountingFuse);
  const a = bookmark('a'); const body = snapshot('a','quartz');
  const index = createLibrarySearch([a],[body]);
  index.search('quartz');
  const built = indexes;
  index.setBookmarks([{...a, readingState:'reading'}]);
  index.setSnapshot({...body, progress:.5});
  assert.deepEqual(ids(index.search('quartz')), ['a']);
  assert.equal(indexes,built);
  index.setSnapshot({...body,text:'zircon',capturedAt:101});
  assert.deepEqual(ids(index.search('zircon')),['a']);
  assert.deepEqual(ids(index.search('quartz')),[]);
  index.removeSnapshot('a');
  assert.deepEqual(ids(index.search('zircon')),[]);
});

test('词内直撇号、弯撇号和句点按字面匹配，操作标点不启用表达式语法', () => {
  const {createLibrarySearch} = load();
  const index = createLibrarySearch([bookmark('a'),bookmark('b')],[
    snapshot('a',"can't and don’t lose Node.js state; quartz and zircon"),
    snapshot('b','can and do not lose nodeXjs state; quartz'),
  ]);
  assert.deepEqual(ids(index.search("can't")),['a']);
  assert.deepEqual(ids(index.search('don’t')),['a']);
  assert.deepEqual(ids(index.search('node.js')),['a']);
  assert.deepEqual(ids(index.search('^node.js$')),['a']);
  assert.deepEqual(ids(index.search('quartz | zircon')),['a']);
  assert.deepEqual(new Set(ids(index.search('!quartz'))),new Set(['a','b']));
});
