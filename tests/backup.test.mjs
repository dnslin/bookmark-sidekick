import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectBackup } from '../src/backup.ts';

const entry = (category, snapshot = undefined) => ({
  url: 'https://example.com/',
  title: 'Example',
  folder: 'Bookmarks',
  category,
  tags: [],
  summary: '',
  ...(snapshot ? { snapshot } : {}),
});

test('v2 备份预览包含模型配置、自定义分类和快照数量', () => {
  const preview = inspectBackup({
    format: 'bookmark-sidekick',
    version: 2,
    exportedAt: '2026-09-12T00:00:00.000Z',
    settings: {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'example-model',
      categories: ['开发', '自定义'],
      consent: true,
    },
    entries: [entry('自定义', { html: '<p>text</p>', text: 'text', capturedAt: 1 })],
  });

  assert.equal(preview.version, 2);
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

test('v1 备份从书签条目补回去重后的分类', () => {
  const preview = inspectBackup({
    format: 'bookmark-sidekick',
    version: 1,
    entries: [entry('自定义'), entry('自定义'), entry('开发'), entry('')],
  });

  assert.equal(preview.version, 1);
  assert.deepEqual(preview.categories, ['自定义', '开发']);
  assert.equal(preview.model, undefined);
});

test('拒绝未知备份版本', () => {
  assert.throws(() => inspectBackup({ format: 'bookmark-sidekick', version: 3, entries: [] }));
});
