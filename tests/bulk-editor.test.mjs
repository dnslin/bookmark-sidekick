import test from 'node:test';
import assert from 'node:assert/strict';
import * as domain from '../src/domain.ts';
import { createComponentHarness, settle } from './helpers/component-harness.mjs';
import { loadModule } from './helpers/load-module.mjs';

const select = (harness, label) => harness.find(node => node.type === 'select' && node.props['aria-label'] === label);
const button = (harness, label) => harness.find(node => node.type === 'button' && node.props.children === label);
const run = async (_label, operation) => { try { await operation(); return true; } catch { return false; } };
function setup(rpc = async () => ({ applied: 2, skipped: 0 })) {
  const harness = createComponentHarness();
  const dependencies = { react: harness.hooks, '../domain': domain, '../messages': { rpc }, './TagEditor': { TagEditor: 'TagEditor' }, './Modal': { Modal: 'Modal' } };
  return { harness, BulkEditor: loadModule(new URL('../src/components/BulkEditor.tsx', import.meta.url), dependencies).BulkEditor, ReadingMenu: loadModule(new URL('../src/components/ReadingMenu.tsx', import.meta.url), dependencies).ReadingMenu };
}
const props = extra => ({ ids: ['a','b'], categories: ['开发','设计'], availableTags: ['React'], busy: false, run, notify() {}, onClose() {}, onApplied() {}, ...extra });

test('批量面板默认保持不变，只有阅读安排时不发送整理字段', async () => {
  let submitted;
  let applied = 0;
  const { harness, BulkEditor } = setup(async message => { submitted = message; return { applied: 2, skipped: 0 }; });
  const value = props({ onApplied() { applied++; } });
  harness.render(BulkEditor, value);
  assert.equal(harness.find(node => node.props.type === 'submit').props.disabled, true);
  select(harness,'批量阅读安排').props.onChange({ target: { value: 'read' } });
  harness.render(BulkEditor, value);
  harness.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await settle();
  assert.deepEqual(submitted, { type: 'BULK_EDIT', ids: ['a','b'], changes: { readingState: 'read' } });
  assert.equal(applied, 1);
});

test('批量标签添加包含未回车输入，使用增量操作而非整组替换', async () => {
  let submitted;
  const { harness, BulkEditor } = setup(async message => { submitted = message; return { applied: 2, skipped: 0 }; });
  const value = props();
  harness.render(BulkEditor, value);
  select(harness,'批量分类').props.onChange({ target: { value: '设计' } });
  select(harness,'批量标签操作').props.onChange({ target: { value: 'add' } });
  harness.render(BulkEditor, value);
  harness.find(node => node.type === 'TagEditor').props.onPendingChange(' 前端 ');
  harness.render(BulkEditor, value);
  harness.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await settle();
  assert.deepEqual(submitted.changes, { category: '设计', tags: { operation: 'add', values: ['前端'] } });
});

test('批量写入失败保留面板和输入并展示错误，取消不写入', async () => {
  let calls = 0;
  let closed = 0;
  let applied = 0;
  const { harness, BulkEditor } = setup(async () => { calls++; throw new Error('存储空间不足'); });
  const value = props({ onClose() { closed++; }, onApplied() { applied++; } });
  harness.render(BulkEditor, value);
  select(harness,'批量阅读安排').props.onChange({ target: { value: 'later' } });
  harness.render(BulkEditor, value);
  harness.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await settle();
  harness.render(BulkEditor, value);
  assert.equal(select(harness,'批量阅读安排').props.value, 'later');
  assert.equal(harness.find(node => node.props.role === 'alert').props.children, '存储空间不足');
  assert.equal(applied, 0);
  button(harness,'取消').props.onClick();
  assert.equal(closed, 1);
  assert.equal(calls, 1);
});

test('阅读菜单移出只发送阅读状态，失败不关闭菜单', async () => {
  let submitted;
  let closed = 0;
  let fail = true;
  const { harness, ReadingMenu } = setup(async message => { submitted = message; if (fail) throw new Error('写入失败'); return true; });
  const value = { bookmark: { id:'a', title:'文章', readingState:'reading' }, busy:false, run, notify() {}, onClose() { closed++; }, onReader() {} };
  harness.render(ReadingMenu, value);
  button(harness,'移出阅读列表，保留书签').props.onClick();
  await settle();
  harness.render(ReadingMenu, value);
  assert.equal(closed, 0);
  assert.equal(harness.find(node => node.props.role === 'alert').props.children, '写入失败');
  fail = false;
  button(harness,'移出阅读列表，保留书签').props.onClick();
  await settle();
  assert.deepEqual(submitted, { type:'SET_READING', id:'a', state:'none' });
  assert.equal(closed, 1);
});
