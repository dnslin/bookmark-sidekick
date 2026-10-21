import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import Fuse from 'fuse.js';
import * as domain from '../src/domain.ts';
import { loadModule } from '../tests/helpers/load-module.mjs';

const { createLibrarySearch } = loadModule(new URL('../src/search.ts', import.meta.url), { 'fuse.js': { default: Fuse }, './domain': domain });
const round = value => Number(value.toFixed(2));
const paragraph = '收藏的文章记录工程设计与状态恢复。阅读清单保留用户上下文，检索结果展示真实片段。 Reliable background tasks preserve state and continue after an interruption. ';
const content = paragraph.repeat(Math.ceil(4000 / paragraph.length)).slice(0,4000);

// Fixed simulated corpora; this does not measure IndexedDB I/O, Worker messages or UI rendering.
for (const size of [1000, 10000]) {
  const bookmarks = Array.from({length:size},(_,id)=>({
    id:String(id), title:`Golang 工程文档 ${id}`, url:`https://example.com/${id}`, category:'开发', tags:['工程'], summary:'编程资料', addedAt:id,
  }));
  const snapshots = bookmarks.map((bookmark,id)=>({bookmarkId:bookmark.id,url:bookmark.url,capturedAt:1,text:content + (id%17===0?' 检查 goroutine 泄漏。':' 浏览本文的实现细节。')}));
  const beforeHeap = process.memoryUsage().heapUsed;
  const start = performance.now();
  const index = createLibrarySearch(bookmarks,snapshots);
  const prepared = performance.now();
  const first = index.search('goroutine 泄漏');
  const ready = performance.now();
  assert.equal(first.hits.length,Math.ceil(size/17));
  const queries = [];
  for(const query of ['goroutine 泄漏','GOLANG goroutine','状态 恢复','doesnotexist']) {
    const began = performance.now(); const result = index.search(query); const elapsed=performance.now()-began;
    if(query==='GOLANG goroutine') assert.equal(result.hits.length,Math.ceil(size/17));
    if(query==='状态 恢复') assert.equal(result.hits.length,size);
    if(query==='doesnotexist') assert.equal(result.hits.length,0);
    queries.push({query,milliseconds:round(elapsed),hits:result.hits.length,over300ms:elapsed>300});
  }
  console.log(JSON.stringify({bookmarks:size,characters:snapshots.reduce((total,item)=>total+item.text.length,0),prepareRecordsMs:round(prepared-start),firstQueryAndIndexMs:round(ready-prepared),heapIncreaseMiB:round((process.memoryUsage().heapUsed-beforeHeap)/1024/1024),queries},null,2));
}

const text='正文填充'.repeat(124980)+'🙂 最后检查 goroutine 泄漏。';
const boundary=createLibrarySearch([{id:'boundary',title:'长文章',url:'https://example.com/long',category:'文章',tags:[],summary:'',addedAt:1}],[{bookmarkId:'boundary',url:'https://example.com/long',capturedAt:1,text}]);
const began=performance.now();const result=boundary.search('goroutine 泄漏');
assert.equal(result.hits[0].bookmarkId,'boundary');
assert.ok(result.hits[0].snippet.text.includes('goroutine'));
assert.ok(result.hits[0].snippet.text.includes('泄漏'));
console.log(JSON.stringify({boundaryCharacters:text.length,firstQueryAndIndexMs:round(performance.now()-began),snippet:result.hits[0].snippet},null,2));

for (const {name, text, query, expected} of [
  {name:'dense-short-term', text:'a '.repeat(200000), query:'a', expected:'a'},
  {name:'unicode-expansion-at-tail', text:'İ 正文填充。'.repeat(71430).slice(0,499970)+'🙂 最后 quartz 泄漏。', query:'quartz 泄漏', expected:'quartz'},
]) {
  const beforeHeap=process.memoryUsage().heapUsed;
  const index=createLibrarySearch([{id:'edge',title:'边界正文',url:'https://example.com/edge',category:'',tags:[],summary:'',addedAt:1}],[{bookmarkId:'edge',url:'https://example.com/edge',capturedAt:1,text}]);
  const start=performance.now();const result=index.search(query);const elapsed=performance.now()-start;
  assert.deepEqual(result.hits.map(hit=>hit.bookmarkId),['edge']);
  const snippet=result.hits[0].snippet;
  assert.ok(snippet.text.length<=120);assert.equal(snippet.text.isWellFormed(),true);
  assert.ok(snippet.ranges.some(([start,end])=>snippet.text.slice(start,end)===expected));
  console.log(JSON.stringify({case:name,characters:text.length,firstQueryAndIndexMs:round(elapsed),heapDeltaMiB:round((process.memoryUsage().heapUsed-beforeHeap)/1024/1024),snippetCharacters:snippet.text.length,highlightRanges:snippet.ranges.length,firstMarked:snippet.text.slice(...snippet.ranges[0])},null,2));
}
