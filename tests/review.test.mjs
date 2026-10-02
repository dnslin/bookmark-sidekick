import test from 'node:test';
import assert from 'node:assert/strict';
import * as domain from '../src/domain.ts';
import { loadModule } from './helpers/load-module.mjs';
import { createComponentHarness, settle } from './helpers/component-harness.mjs';

const bookmark = id => ({ id, title: `书签${id}`, url: `https://example.com/${id}`, tags: [], summary: '' });
const draft = id => ({ bookmarkId: id, category: '开发', confidence: 1, tags: [], summary: '' });
function setup(props, rpc = async () => ({ applied: 2, skipped: 0 })) {
  const harness = createComponentHarness();
  const { Review } = loadModule(new URL('../src/components/Review.tsx', import.meta.url), { react: harness.hooks, '../domain': domain, '../messages': { rpc }, '../db': {}, './SiteIcon': {}, './CategorySelect': {} });
  const values = { busy: false, categories: ['开发'], working: 0, run: async (_label, fn) => { await fn(); return true; }, notify() {}, ...props };
  const render = () => harness.render(Review, values);
  render();
  return { harness, props: values, render };
}
const card = harness => harness.find(node => node.type === 'article');
const queue = harness => harness.nodes(node => node.type === 'button' && node.props['aria-label']?.startsWith('查看'));

test('待确认列表按建议顺序显示，跳过已删除书签且批量应用顺序不变', async () => {
  let submitted;
  const { harness } = setup({ bookmarks: [bookmark('1'), bookmark('2')], drafts: [draft('2'), draft('missing'), draft('1')] }, async message => { submitted = message; return { applied: 2, skipped: 0 }; });
  assert.equal(card(harness).props['aria-label'], '书签2 的分类建议');
  assert.deepEqual(queue(harness).map(node => node.props['aria-label']), ['查看 书签1 的分类建议']);
  harness.find(node => node.type === 'button' && node.props.className === 'text-button review-batch').props.onClick();
  await settle();
  assert.deepEqual(submitted.ids, ['2', '1']);
});

test('选中的建议跟随书签更新，建议消失后回到队首', () => {
  const { harness, props, render } = setup({ bookmarks: [bookmark('1'), bookmark('2')], drafts: [draft('2'), draft('1')] });
  queue(harness)[0].props.onClick();
  render();
  assert.equal(card(harness).props['aria-label'], '书签1 的分类建议');
  props.bookmarks = [{ ...bookmark('1'), title: '更新标题' }, bookmark('2')];
  render();
  assert.equal(card(harness).props['aria-label'], '更新标题 的分类建议');
  props.drafts = [draft('2')];
  render();
  assert.equal(card(harness).props['aria-label'], '书签2 的分类建议');
});

test('连接大量建议时书签 ID 访问次数随列表长度线性增长', () => {
  const size = 200;
  let reads = 0;
  const bookmarks = Array.from({ length: size }, (_, i) => ({ ...bookmark(String(i)), get id() { reads++; return String(i); } }));
  const { harness } = setup({ bookmarks, drafts: Array.from({ length: size }, (_, i) => draft(String(i))) });
  assert.equal(queue(harness).length, size - 1);
  assert.ok(reads <= size * 3, `读取了 ${reads} 次书签 ID，期望不超过 ${size * 3} 次`);
});
