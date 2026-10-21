import test from 'node:test';
import assert from 'node:assert/strict';
import { createComponentHarness, settle } from './helpers/component-harness.mjs';
import * as domain from '../src/domain.ts';
import { loadModule } from './helpers/load-module.mjs';

const load = () => loadModule(new URL('../src/components/reading.ts', import.meta.url));

test('正文定位按文本节点映射，能够跨 inline 节点与折叠空白', () => {
  const { findReaderMatches } = load();
  assert.deepEqual(findReaderMatches([{text:'前言：中',block:1},{text:'断',block:1},{text:'恢复\n  体验',block:1}], ['中断恢复','恢复 体验']), [
    {nodeIndex:0,start:3,end:4}, {nodeIndex:1,start:0,end:1}, {nodeIndex:2,start:0,end:7},
  ]);
});

test('不同段落不拼接成不存在的词，匹配忽略英文大小写', () => {
  const { findReaderMatches } = load();
  assert.deepEqual(findReaderMatches([{text:'中断',block:1},{text:'恢复',block:2}], ['中断恢复']), []);
  assert.deepEqual(findReaderMatches([{text:'Read REACT again',block:1}], ['react']), [{nodeIndex:0,start:5,end:10}]);
});

test('阅读位置停止 500ms 后保存，持续滚动最多两秒提交一次', async t => {
  t.mock.timers.enable({ apis:['setTimeout'] });
  const { createProgressSaver } = load();
  const writes = [];
  const saver = createProgressSaver(async value => { writes.push(value); return true; }, assert.fail);
  saver.record(.1);
  t.mock.timers.tick(499);
  await settle();
  assert.deepEqual(writes, []);
  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(writes, [.1]);
  for (const value of [.2,.3,.4,.5,.6]) { saver.record(value); t.mock.timers.tick(400); }
  await settle();
  assert.deepEqual(writes, [.1,.6]);
  await saver.dispose();
});

test('阅读位置串行写入，离开时补写，错误可见且可重试', async () => {
  const { createProgressSaver } = load();
  let finish;
  const waiting = new Promise(resolve => { finish = resolve; });
  const writes = [];
  const saver = createProgressSaver(async value => { writes.push(value); if (value === .2) await waiting; return true; }, assert.fail);
  saver.record(.2);
  const first = saver.flush();
  await settle();
  saver.record(.4);
  const leaving = saver.dispose();
  await settle();
  assert.deepEqual(writes, [.2]);
  finish();
  await Promise.all([first,leaving]);
  assert.deepEqual(writes, [.2,.4]);

  const errors = [];
  let fail = true;
  const retry = createProgressSaver(async () => { if (fail) throw new Error('写入失败'); return true; }, error => errors.push(error.message));
  retry.record(.5);
  await retry.flush();
  assert.deepEqual(errors, ['写入失败']);
  fail = false;
  await retry.flush();
  await retry.dispose();
});

function readerHarness(t, rpc, notify) {
  const previous = { document:globalThis.document, window:globalThis.window, requestAnimationFrame:globalThis.requestAnimationFrame, cancelAnimationFrame:globalThis.cancelAnimationFrame };
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const harness = createComponentHarness();
  t.after(() => { harness.unmount(); Object.assign(globalThis,previous); });
  const Reader = loadModule(new URL('../src/components/Reader.tsx', import.meta.url), { react:harness.hooks, dompurify:{ default:{ sanitize:html=>html } }, '../domain':domain, '../messages':{rpc}, './reading':load() }).default;
  const props = { bookmark:{ id:'a', title:'文章', readingState:'read' }, snapshot:{bookmarkId:'a',url:'https://example.com',html:'<p>文章</p>',text:'文章',capturedAt:1,progress:1}, busy:false, notify, run:async (_label,fn)=>{try{await fn();return true;}catch(error){notify(error.message);return false;}} };
  harness.render(Reader,props);
  return {harness,Reader,props};
}

test('原地重新阅读先重置为待读，再进入阅读中，并显示真实成功结果', async t => {
  const messages = [];
  const notices = [];
  const {harness,Reader,props} = readerHarness(t,async message=>{messages.push(message);return true;},message=>notices.push(message));
  harness.find(node=>node.type==='button' && node.props.type==='button').props.onClick();
  await settle();
  assert.deepEqual(messages,[{type:'SET_READING',id:'a',state:'later'},{type:'SET_READING',id:'a',state:'reading'}]);
  assert.deepEqual(notices,['已开始重新阅读']);
  harness.render(Reader,props);
  assert.ok(harness.find(node=>node.type==='span' && node.props.children?.includes?.(0)));
});

test('原地重新阅读第二步失败时保留零进度并报告失败，不伪报完成', async t => {
  const notices = [];
  const {harness,Reader,props} = readerHarness(t,async message=>{if(message.state==='reading')throw new Error('阅读状态写入失败');return true;},message=>notices.push(message));
  harness.find(node=>node.type==='button' && node.props.type==='button').props.onClick();
  await settle();
  assert.deepEqual(notices,['阅读状态写入失败']);
  harness.render(Reader,props);
  assert.ok(harness.find(node=>node.type==='span' && node.props.children?.includes?.(0)));
});
