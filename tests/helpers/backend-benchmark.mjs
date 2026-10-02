import { performance } from 'node:perf_hooks';
import { createBackend, nativeBookmark, bookmark, task } from './backend.mjs';

const baseline = process.argv[2];
if (!baseline) throw new Error('请传入修改前 service.ts 的路径');

async function measure(path, scenario) {
  const times = [];
  let metrics;
  for (let sample = 0; sample < 8; sample++) {
    const ids = Array.from({ length: scenario === 'tasks' ? 120 : 100 }, (_, i) => String(i));
    const backend = scenario === 'tasks'
      ? createBackend({ path, bookmarks: ids.map(id => bookmark(id)), tasks: [
        ...ids.map(id => task(id)),
        ...Array.from({ length: 1000 }, (_, i) => task(`failed-${i}`, { status: 'failed' })),
        task('future', { status: 'running', leaseUntil: Date.now() + 60_000 }),
      ] })
      : createBackend({ path, native: ids.map(id => nativeBookmark(id)) });
    if (scenario !== 'tasks') backend.service.initializeBackground();
    const start = performance.now();
    if (scenario === 'tasks') await backend.service.pump();
    else {
      if (scenario === 'import') backend.browser.bookmarks.onImportBegan.emit();
      for (const id of ids) backend.browser.bookmarks.onCreated.emit(id);
      if (scenario === 'import') backend.browser.bookmarks.onImportEnded.emit();
      await backend.service.syncBookmarks();
    }
    const elapsed = performance.now() - start;
    if (sample > 0) times.push(elapsed);
    metrics = { ...backend.metrics, modelRequests: backend.requests.length, drafts: backend.db.drafts.rows.size };
  }
  return { medianMs: Number(times.sort((a, b) => a - b)[3].toFixed(2)), ...metrics };
}

for (const scenario of ['created', 'import', 'tasks']) {
  const before = await measure(baseline, scenario);
  const after = await measure(new URL('../../src/service.ts', import.meta.url), scenario);
  console.log(JSON.stringify({ scenario, warmup: 1, measuredSamples: 7, before, after }));
}
