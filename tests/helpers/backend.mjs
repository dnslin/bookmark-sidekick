import { loadModule } from './load-module.mjs';
import * as domain from '../../src/domain.ts';

const copy = value => value === undefined ? undefined : structuredClone(value);
const servicePath = new URL('../../src/service.ts', import.meta.url);

export function createBackend({ native = [], bookmarks = [], drafts = [], tasks = [], snapshots = [], classify, getTree, path = servicePath } = {}) {
  const metrics = { trees: 0, bookmarkWrites: 0, bulkPuts: 0, fullTaskReads: 0, taskRowsRead: 0, indexedTaskReads: 0 };
  function table(name, key, records) {
    const rows = new Map(records.map(row => [row[key], copy(row)]));
    const ordered = () => [...rows.values()].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
    const api = {
      rows,
      async get(id) { return copy(rows.get(id)); },
      async bulkGet(ids) { return ids.map(id => copy(rows.get(id))); },
      async count() { return rows.size; },
      async toArray() {
        if (name === 'tasks') { metrics.fullTaskReads++; metrics.taskRowsRead += rows.size; }
        return copy(ordered());
      },
      async put(row) {
        if (name === 'bookmarks') metrics.bookmarkWrites++;
        rows.set(row[key], copy(row));
      },
      async bulkPut(records) {
        if (name === 'bookmarks') metrics.bulkPuts++;
        for (const row of records) await api.put(row);
      },
      async delete(id) { rows.delete(id); },
      async bulkDelete(ids) { for (const id of ids) rows.delete(id); },
      async update(id, changes) {
        const row = rows.get(id);
        if (!row) return 0;
        rows.set(id, { ...row, ...copy(changes) });
        return 1;
      },
      where(index) {
        let values;
        let predicate = () => true;
        let maximum = Infinity;
        const collection = {
          equals(value) { values = [value]; return collection; },
          anyOf(...input) { values = Array.isArray(input[0]) ? input[0] : input; return collection; },
          filter(fn) { const previous = predicate; predicate = row => previous(row) && fn(row); return collection; },
          limit(value) { maximum = value; return collection; },
          async toArray() {
            if (name === 'tasks') metrics.indexedTaskReads++;
            const matches = [];
            const candidates = ordered().filter(row => !values || values.includes(row[index]))
              .sort((a, b) => String(a[index]).localeCompare(String(b[index])));
            for (const row of candidates) {
              if (matches.length >= maximum) break;
              if (name === 'tasks') metrics.taskRowsRead++;
              if (predicate(row)) matches.push(row);
            }
            return copy(matches);
          },
          async modify(changes) {
            for (const row of await collection.toArray()) await api.update(row[key], changes);
          },
        };
        return collection;
      },
    };
    return api;
  }
  const db = {
    bookmarks: table('bookmarks', 'id', bookmarks),
    drafts: table('drafts', 'bookmarkId', drafts),
    tasks: table('tasks', 'bookmarkId', tasks),
    snapshots: table('snapshots', 'bookmarkId', snapshots),
    async transaction(...args) { return args.at(-1)(); },
  };
  const event = () => {
    const listeners = [];
    return { addListener(fn) { listeners.push(fn); }, emit(...args) { for (const fn of listeners) fn(...args); } };
  };
  const storage = {
    settings: { baseUrl: 'https://model.example/v1', apiKey: '', model: 'test-model', categories: ['开发', '工具'], consent: true, paused: false },
  };
  const requests = [];
  const browser = {
    runtime: { id: 'test-extension', getURL: path => `chrome-extension://test-extension/${path}`, onMessage: event(), onInstalled: event(), onStartup: event() },
    bookmarks: {
      onCreated: event(), onChanged: event(), onMoved: event(), onRemoved: event(), onImportBegan: event(), onImportEnded: event(),
      async getTree() { metrics.trees++; return getTree ? getTree(copy(native), metrics.trees) : copy(native); },
    },
    storage: { local: {
      async get(key) { return { [key]: copy(storage[key]) }; },
      async set(input) { Object.assign(storage, copy(input)); },
      async setAccessLevel() {},
    } },
    sidePanel: { async setPanelBehavior() {} },
    alarms: { async get() { return {}; }, async create() {}, onAlarm: event() },
  };
  globalThis.chrome = browser;
  const settings = loadModule(new URL('../../src/settings.ts', import.meta.url), { './domain': domain });
  const service = loadModule(path, {
    './db': { db }, './domain': domain, './settings': settings,
    './llm': { async classify(value, items) {
      requests.push(copy(items));
      return classify ? classify(value, items) : items.map(item => ({ id: item.id, category: '开发', tags: ['代码'], summary: '文档', confidence: 0.9 }));
    } },
  });
  return { service, db, metrics, browser, storage, requests, setNative(value) { native = value; } };
}

export const nativeBookmark = (id, extra = {}) => ({ id, title: `书签 ${id}`, url: `https://example.com/${id}`, dateAdded: 100, ...extra });
export const bookmark = (id, extra = {}) => ({ ...domain.mergeNative(undefined, { id, title: `书签 ${id}`, url: `https://example.com/${id}`, folder: '', addedAt: 100 }), ...extra });
export const task = (id, extra = {}) => ({ bookmarkId: id, revision: 1, mode: 'draft', status: 'pending', leaseUntil: 0, attempts: 0, ...extra });
export const tick = () => new Promise(resolve => setImmediate(resolve));
export async function waitFor(predicate) {
  for (let i = 0; i < 20; i++) { if (predicate()) return; await tick(); }
  throw new Error('后台未在预期时间内完成');
}
