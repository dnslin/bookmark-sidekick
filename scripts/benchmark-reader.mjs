import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { findReaderMatches } from '../src/components/reading.ts';

const firstTail = 'İ🧭 中断';
const secondTail = '恢复';
const prefixLength = 500000 - firstTail.length - secondTail.length;
const paragraph = '正文 English text 继续阅读。';
const prefix = paragraph.repeat(Math.ceil(prefixLength / paragraph.length)).slice(0, prefixLength);
const parts = [{ text: prefix + firstTail, block: 1 }, { text: secondTail, block: 1 }];
assert.equal(parts.reduce((sum, part) => sum + part.text.length, 0), 500000);

// Fixed text-node input; excludes DOM traversal, sanitization, scrolling and browser rendering.
for (const [terms, expected] of [
  [[], []],
  [['中断恢复'], [{ nodeIndex: 0, start: prefix.length + 4, end: prefix.length + 6 }, { nodeIndex: 1, start: 0, end: 2 }]],
]) {
  globalThis.gc?.();
  const beforeHeap = process.memoryUsage().heapUsed;
  const started = performance.now();
  const matches = findReaderMatches(parts, terms);
  const milliseconds = performance.now() - started;
  const heapIncreaseMiB = (process.memoryUsage().heapUsed - beforeHeap) / 1024 / 1024;
  assert.deepEqual(matches, expected);
  console.log(JSON.stringify({ characters: 500000, terms, milliseconds: +milliseconds.toFixed(2), heapIncreaseMiB: +heapIncreaseMiB.toFixed(2), matches }, null, 2));
}

assert.deepEqual(findReaderMatches([{ text: 'İ中文🧭React', block: 1 }], ['i', 'react']), [
  { nodeIndex: 0, start: 0, end: 1 }, { nodeIndex: 0, start: 5, end: 10 },
]);
assert.deepEqual(findReaderMatches([{ text: 'A \n', block: 1 }, { text: '\t B', block: 1 }], ['a b']), [
  { nodeIndex: 0, start: 0, end: 2 }, { nodeIndex: 1, start: 2, end: 3 },
]);
assert.deepEqual(findReaderMatches([{ text: '中断', block: 1 }, { text: '恢复', block: 2 }], ['中断恢复']), []);
console.log('原文 UTF-16 范围、大小写扩展、表情、跨节点空白与段落边界检查通过。');
