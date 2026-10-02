import { performance } from 'node:perf_hooks';
import Fuse from 'fuse.js';
import { loadModule } from '../tests/helpers/load-module.mjs';

const { createBookmarkSearch } = loadModule(new URL('../src/search.ts', import.meta.url), { 'fuse.js': { default: Fuse } });
const bookmarks = Array.from({ length: 10_000 }, (_, id) => ({
  id: String(id), title: `React TypeScript documentation ${id}`, url: `https://example.com/${id}`,
  category: id % 2 ? '开发' : '设计', tags: ['前端', '组件'], summary: `界面开发与组件设计教程 ${id}`,
}));
const queries = ['React', 'TypeScript', '组件', '前端', '开发', '界面', '教程', 'documentation'];
const options = { keys: [{ name: 'title', weight: 3 }, 'url', 'category', 'tags', 'summary'], threshold: 0.36, ignoreLocation: true };
const samples = { before: [], after: [] };
for (let round = 0; round < 12; round++) {
  for (const mode of round % 2 ? ['after', 'before'] : ['before', 'after']) {
    const search = mode === 'after' ? createBookmarkSearch(bookmarks)
      : query => new Fuse(bookmarks, options).search(query).map(result => result.item);
    const start = performance.now();
    for (const query of queries) search(query);
    if (round >= 2) samples[mode].push(performance.now() - start);
  }
}
const summarize = values => {
  values.sort((a, b) => a - b);
  return { medianMs: Number(((values[4] + values[5]) / 2).toFixed(2)),
    minMs: Number(values[0].toFixed(2)), maxMs: Number(values.at(-1).toFixed(2)) };
};
console.log(JSON.stringify({ bookmarks: bookmarks.length, queries: queries.length, samples: samples.before.length,
  before: summarize(samples.before), after: summarize(samples.after) }, null, 2));
