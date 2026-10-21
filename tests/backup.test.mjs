import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectBackup } from '../src/backup-format.ts';

const entry = (category, snapshot = undefined) => ({
  url: 'https://example.com/',
  title: 'Example',
  folder: 'Bookmarks',
  category,
  tags: [],
  summary: '',
  readingState: 'none',
  ...(snapshot ? { snapshot } : {}),
});

test('v3 备份预览包含模型配置、自定义分类和快照数量', () => {
  const preview = inspectBackup({
    format: 'bookmark-sidekick',
    version: 3,
    exportedAt: '2026-09-12T00:00:00.000Z',
    settings: {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'example-model',
      categories: ['开发', '自定义'],
      consent: true,
    },
    entries: [entry('自定义', { html: '<p>text</p>', text: 'text', capturedAt: 1, progress: .4 })],
  });

  assert.equal(preview.version, 3);
  assert.equal(preview.entryCount, 1);
  assert.equal(preview.snapshotCount, 1);
  assert.deepEqual(preview.categories, ['开发', '自定义']);
  assert.deepEqual(preview.model, {
    baseUrl: 'https://api.example.com/v1',
    model: 'example-model',
    consent: true,
    hasApiKey: true,
  });
});

test('明确拒绝旧版与未知备份版本', () => {
  for (const version of [1, 2, 4]) {
    assert.throws(() => inspectBackup({ format: 'bookmark-sidekick', version, entries: [] }), /仅支持 v3/);
  }
});

test('v3 允许 20 个标签，并验证阅读状态和阅读位置', () => {
  const settings = { baseUrl: '', apiKey: '', model: '', categories: ['开发'], consent: false };
  const input = { format: 'bookmark-sidekick', version: 3, settings, entries: [{ ...entry('开发'), tags: Array.from({ length: 20 }, (_, i) => `标签${i}`), readingState: 'reading', snapshot: { html: '正文', text: '正文', capturedAt: 1, progress: .8 } }] };
  assert.equal(inspectBackup(input).entryCount, 1);
  const invalid = structuredClone(input);
  invalid.entries[0].tags.push('第21个标签');
  assert.throws(() => inspectBackup(invalid));
  invalid.entries[0].tags.pop();
  invalid.entries[0].snapshot.progress = 1.1;
  assert.throws(() => inspectBackup(invalid));
  invalid.entries[0].snapshot.progress = .4;
  invalid.entries[0].readingState = 'invalid';
  assert.throws(() => inspectBackup(invalid));
});
