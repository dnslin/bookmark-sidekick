import test from 'node:test';
import assert from 'node:assert/strict';
import Fuse from 'fuse.js';
import * as domain from '../src/domain.ts';
import { loadModule } from './helpers/load-module.mjs';

const search = loadModule(new URL('../src/search.ts',import.meta.url), {'fuse.js':{default:Fuse},'./domain':domain});
const load = () => loadModule(new URL('../src/search-client.ts',import.meta.url), {'./search':search});
const books = [{id:'a',title:'React',url:'https://example.com/a',category:'开发',tags:[],summary:'',addedAt:100}];
const delayed = () => new Promise(resolve => setTimeout(resolve,170));
function fakeWorker() {
  return { messages:[], terminated:false, onmessage:null, onerror:null, postMessage(value) {this.messages.push(value);}, terminate() {this.terminated=true;}, reply(value) {this.onmessage?.({data:value});} };
}

test('空搜索不创建 Worker；快速查询合并，只发最后一条', async t => {
  const {BookmarkSearchClient} = load();
  const worker = fakeWorker(); let created=0;
  const client = new BookmarkSearchClient(()=>{created++;return worker;});
  t.after(()=>client.dispose());
  client.search(books,' ');
  assert.equal(created,0);
  client.search(books,'Re');
  client.search(books,'React');
  assert.equal(client.getState().status,'loading');
  await delayed();
  assert.equal(created,1);
  assert.equal(worker.messages.length,1);
  assert.equal(worker.messages[0].query,'React');
});

test('新查询或清空查询之后，旧 Worker 回包不能覆盖当前结果', async t => {
  const {BookmarkSearchClient} = load();
  const worker = fakeWorker(); const client = new BookmarkSearchClient(()=>worker); t.after(()=>client.dispose());
  client.search(books,'React'); await delayed(); const old=worker.messages[0].id;
  client.search(books,'TypeScript');
  worker.reply({type:'result',id:old,hits:[{bookmarkId:'old'}],terms:['react'],snapshotCount:1});
  assert.equal(client.getState().status,'loading');
  assert.deepEqual(client.getState().hits,[]);
  await delayed(); const current=worker.messages.at(-1).id;
  worker.reply({type:'result',id:current,hits:[{bookmarkId:'a'}],terms:['typescript'],snapshotCount:1});
  assert.equal(client.getState().status,'ready');
  assert.deepEqual(client.getState().hits,[{bookmarkId:'a'}]);
  client.search(books,'');
  worker.reply({type:'result',id:current,hits:[{bookmarkId:'late'}],terms:['typescript'],snapshotCount:1});
  assert.equal(client.getState().status,'idle');
  assert.deepEqual(client.getState().hits,[]);
});

test('Worker 加载和查询失败显示错误，重试创建新 Worker，旧线程结果仍无效', async t => {
  const {BookmarkSearchClient} = load();
  const workers=[]; const client=new BookmarkSearchClient(()=>{const worker=fakeWorker();workers.push(worker);return worker;});t.after(()=>client.dispose());
  client.search(books,'React');await delayed();
  workers[0].reply({type:'error',id:workers[0].messages[0].id,error:'数据库读取失败'});
  assert.equal(client.getState().status,'error');
  assert.equal(client.getState().error,'数据库读取失败');
  client.retry();await delayed();
  assert.equal(workers.length,2);assert.equal(workers[0].terminated,true);
  workers[0].reply({type:'result',id:workers[0].messages[0].id,hits:[{bookmarkId:'late'}],terms:[],snapshotCount:2});
  assert.equal(client.getState().status,'loading');
  const current=workers[1].messages[0].id;
  workers[1].reply({type:'result',id:current,hits:[{bookmarkId:'a'}],terms:['react'],snapshotCount:1});
  assert.equal(client.getState().status,'ready');
  workers[1].onerror({message:'worker stopped'});
  assert.equal(client.getState().status,'error');assert.match(client.getState().error,/worker stopped/);
  client.search(books,'TypeScript');await delayed();
  assert.equal(workers.length,3);
});

test('仅阅读状态变更不重新查询，元数据变化会刷新；清空后保留 Worker，卸载才销毁', async () => {
  const {BookmarkSearchClient} = load();
  const worker=fakeWorker();const client=new BookmarkSearchClient(()=>worker);
  const notifications=[];const unsubscribe=client.subscribe(state=>notifications.push(state.status));
  client.search(books,'React');await delayed();
  const id=worker.messages[0].id;worker.reply({type:'result',id,hits:[{bookmarkId:'a'}],terms:['react'],snapshotCount:1});
  client.search([{...books[0],readingState:'read'}],'React');await delayed();
  assert.equal(worker.messages.length,1);assert.equal(client.getState().status,'ready');
  client.search([{...books[0],title:'React 指南'}],'React');await delayed();
  assert.equal(worker.messages.length,2);
  client.search(books,'');assert.equal(worker.terminated,false);
  assert.equal(worker.messages.length,3);
  assert.equal(worker.messages.at(-1).query,'');
  assert.deepEqual(worker.messages.at(-1).bookmarks,[]);
  assert.ok(worker.messages.at(-1).id > id);
  unsubscribe();client.dispose();assert.equal(worker.terminated,true);
  assert.ok(notifications.includes('loading'));assert.ok(notifications.includes('ready'));
});
