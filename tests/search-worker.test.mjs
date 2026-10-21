import test from 'node:test';
import assert from 'node:assert/strict';
import Fuse from 'fuse.js';
import * as domain from '../src/domain.ts';
import { loadModule } from './helpers/load-module.mjs';

const book = {id:'a',title:'Document',url:'https://example.com/a',category:'文章',tags:[],summary:'',addedAt:1};
const body = (text='quartz',extra={}) => ({bookmarkId:'a',url:book.url,text,html:'<p>not indexed</p>',capturedAt:100,progress:0,...extra});
const tick = () => new Promise(resolve=>setImmediate(resolve));
async function until(predicate) {for(let i=0;i<30;i++){if(predicate())return;await tick();}throw new Error('搜索线程没有返回预期状态');}
function setup(t,{rows=[body()],readError,gate}={}) {
  const metrics={fullReads:0,pointReads:0,keyReads:0,indexes:0,queries:0};let notify;
  const messages=[];const scope={postMessage(value){messages.push(value);},onmessage:null};
  const previous=globalThis.self;globalThis.self=scope;t.after(()=>{globalThis.self=previous;});
  const db={snapshots:{
    orderBy(name){assert.equal(name,'capturedAt');return{async eachKey(callback){metrics.keyReads++;for(const row of rows)callback(row.capturedAt,{primaryKey:row.bookmarkId});}};},
    async each(callback){metrics.fullReads++;if(gate)await gate;if(readError)throw readError;for(const row of rows)callback(row);},
    async get(id){metrics.pointReads++;return rows.find(row=>row.bookmarkId===id);},
  }};
  const liveQuery=querier=>({subscribe(observer){notify=async()=>{try{observer.next(await querier());}catch(error){observer.error(error);}};void notify();return{unsubscribe(){}};}});
  class CountingFuse extends Fuse {constructor(...args){super(...args);metrics.indexes++;}}
  const search=loadModule(new URL('../src/search.ts',import.meta.url),{'fuse.js':{default:CountingFuse},'./domain':domain});
  const instrumented={...search,createLibrarySearch(...args){const index=search.createLibrarySearch(...args);return{...index,search(query){metrics.queries++;return index.search(query);}};}};
  loadModule(new URL('../src/search.worker.ts',import.meta.url),{'./db':{db},'dexie':{liveQuery},'./search':instrumented});
  return {metrics,messages,async request(id,query){scope.onmessage({data:{id,query,bookmarks:query?[book]:[]}});await tick();},async change(next){rows=next;await notify();await tick();}};
}

test('初次正文使用游标逐条读取，进度通知不重新读取 HTML 或重做查询', async t=>{
  const worker=setup(t);await worker.request(1,'quartz');await until(()=>worker.messages.some(value=>value.type==='result'));
  assert.deepEqual(worker.messages.at(-1).hits.map(hit=>hit.bookmarkId),['a']);
  assert.equal(worker.metrics.fullReads,1);assert.equal(worker.metrics.pointReads,0);
  const before=worker.messages.length;
  await worker.change([body('quartz',{progress:.5})]);await tick();
  assert.equal(worker.metrics.fullReads,1);assert.equal(worker.metrics.pointReads,0);assert.equal(worker.messages.length,before);
});

test('正文版本更新只重读改变的记录，删除快照后结果与覆盖数量同步更新', async t=>{
  const worker=setup(t);await worker.request(1,'quartz');await until(()=>worker.messages.some(value=>value.type==='result'));
  await worker.change([body('zircon',{capturedAt:101})]);await until(()=>worker.messages.at(-1)?.type==='result'&&worker.messages.at(-1).hits.length===0);
  assert.equal(worker.metrics.fullReads,1);assert.equal(worker.metrics.pointReads,1);
  await worker.request(2,'zircon');await until(()=>worker.messages.at(-1)?.id===2);
  assert.equal(worker.messages.at(-1).hits[0].bookmarkId,'a');
  await worker.change([]);await until(()=>worker.messages.at(-1)?.type==='result'&&worker.messages.at(-1).snapshotCount===0);
  assert.deepEqual(worker.messages.at(-1).hits,[]);
});

test('初次正文读取失败返回明确错误，不将失败显示成空结果', async t=>{
  const worker=setup(t,{readError:new Error('模拟 IndexedDB 失败')});await worker.request(1,'quartz');await until(()=>worker.messages.some(value=>value.type==='error'));
  assert.match(worker.messages.at(-1).error,/IndexedDB 失败/);
  assert.equal(worker.messages.some(value=>value.type==='result'),false);
});

test('正文尚未准备完成时收到新查询，只为最新查询返回结果', async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const worker=setup(t,{rows:[body('zircon')],gate});await worker.request(1,'quartz');await worker.request(2,'zircon');release();
  await until(()=>worker.messages.some(value=>value.type==='result'));
  const results=worker.messages.filter(value=>value.type==='result');
  assert.equal(results.length,1);assert.equal(results[0].id,2);assert.equal(results[0].hits[0].bookmarkId,'a');
});

test('初始化中清空后正文变化不查询也不建索引；再次输入复用缓存，清空后不发布旧结果', async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const worker=setup(t,{gate});
  await worker.request(1,'quartz');await worker.request(2,'');release();await tick();
  await worker.change([body('zircon',{capturedAt:101})]);await tick();
  assert.equal(worker.metrics.queries,0);assert.equal(worker.metrics.indexes,0);
  assert.equal(worker.messages.some(value=>value.type==='result'),false);
  await worker.request(3,'zircon');await until(()=>worker.messages.at(-1)?.type==='result');
  assert.equal(worker.messages.at(-1).hits[0].bookmarkId,'a');
  assert.equal(worker.metrics.fullReads,1);
  const queries=worker.metrics.queries;const indexes=worker.metrics.indexes;
  await worker.request(4,'');const published=worker.messages.length;
  await worker.change([body('sapphire',{capturedAt:102})]);await tick();
  assert.equal(worker.messages.length,published);assert.equal(worker.metrics.queries,queries);assert.equal(worker.metrics.indexes,indexes);
  await worker.request(5,'sapphire');await until(()=>worker.messages.at(-1)?.id===5);
  assert.equal(worker.messages.at(-1).hits[0].bookmarkId,'a');assert.equal(worker.metrics.fullReads,1);assert.equal(worker.metrics.indexes,indexes);
});
