import test from 'node:test';
import assert from 'node:assert/strict';
import * as domain from '../src/domain.ts';
import * as backupFormat from '../src/backup-format.ts';
import { createComponentHarness, settle } from './helpers/component-harness.mjs';
import { loadModule } from './helpers/load-module.mjs';

const settings = loadModule(new URL('../src/settings.ts', import.meta.url), { './domain': domain });
const editor = loadModule(new URL('../src/components/editor.ts', import.meta.url));
const initialSettings = () => ({ baseUrl: 'https://before.example/v1', apiKey: 'before', model: 'before-model', categories: ['开发', '设计'], consent: true, paused: false });
const bookmark = () => ({ id: '1', title: '原标题', url: 'https://example.com/', category: '开发', tags: [], summary: '', folder: '', linkState: 'unknown' });
const input = (harness, type) => harness.find(node => node.type === 'input' && node.props.type === type);
const category = harness => harness.find(node => node.props.label === '分类');
const button = (harness, text) => harness.find(node => node.type === 'button' && node.props.children === text);

function editors(harness, rpc = async () => true) {
  const dependencies = { react: harness.hooks, '../settings': settings, '../domain': domain, '../backup-format': backupFormat, '../messages': { rpc }, '../backup': { inspectBackup: () => ({ version: 3, entryCount: 0, snapshotCount: 0, categories: [], model: { baseUrl: '', model: '', consent: false, hasApiKey: false } }) }, './Appearance': {}, './CategoryEditor': {}, './CategorySelect': {}, './SiteIcon': {}, './TagEditor': { TagEditor: 'TagEditor' }, './editor': editor };
  return {
    SettingsForm: loadModule(new URL('../src/components/SettingsForm.tsx', import.meta.url), dependencies).default,
    Detail: loadModule(new URL('../src/components/Detail.tsx', import.meta.url), dependencies).Detail,
  };
}
function settingsProps(overrides = {}) {
  return { value: initialSettings(), busy: false, unclassifiedCount: 0, onSave: async () => true, onSaved() {}, onRestore: async () => true, notify() {}, onBackup() {}, ...overrides };
}
function detailProps(overrides = {}) {
  return { bookmark: { ...bookmark(), readingState: 'none' }, categories: ['开发', '设计'], availableTags: [], busy: false, configured: true, run: async (_label, fn) => { await fn(); return true; }, notify() {}, onReader() {}, onReading() {}, onOpen() {}, onDeleted() {}, ...overrides };
}

test('后台暂停保留设置草稿，未编辑模型跟随最新配置并一同提交', async () => {
  globalThis.chrome = { permissions: { request: async () => true } };
  const harness = createComponentHarness();
  const { SettingsForm } = editors(harness);
  let submitted;
  const props = settingsProps({ onSave: async value => { submitted = value; return true; } });
  harness.render(SettingsForm, props);
  input(harness, 'url').props.onChange({ target: { value: 'https://edited.example/v1' } });
  harness.render(SettingsForm, props);
  props.value = { ...props.value, paused: true, model: 'latest-model' };
  harness.render(SettingsForm, props);
  assert.equal(input(harness, 'url').props.value, 'https://edited.example/v1');
  button(harness, '保存设置').props.onClick();
  await settle();
  assert.equal(submitted.baseUrl, 'https://edited.example/v1');
  assert.equal(submitted.model, 'latest-model');
});

test('设置保存失败保留草稿，成功保存后字段重新跟随最新配置', async () => {
  globalThis.chrome = { permissions: { request: async () => true } };
  const harness = createComponentHarness();
  const { SettingsForm } = editors(harness);
  let succeeded = false;
  const props = settingsProps({ onSave: async value => { if (succeeded) props.value = value; return succeeded; } });
  harness.render(SettingsForm, props);
  input(harness, 'password').props.onChange({ target: { value: 'edited-key' } });
  harness.render(SettingsForm, props);
  button(harness, '保存设置').props.onClick();
  await settle();
  props.value = { ...props.value, apiKey: 'external-key' };
  harness.render(SettingsForm, props);
  assert.equal(input(harness, 'password').props.value, 'edited-key');
  succeeded = true;
  button(harness, '保存设置').props.onClick();
  await settle();
  props.value = { ...props.value, apiKey: 'next-key' };
  harness.render(SettingsForm, props);
  assert.equal(input(harness, 'password').props.value, 'next-key');
});

test('恢复失败保留设置草稿，恢复成功清除草稿及预览', async () => {
  const harness = createComponentHarness();
  const { SettingsForm } = editors(harness);
  let succeeded = false;
  const restored = { ...initialSettings(), baseUrl: 'https://restored.example/v1' };
  const props = settingsProps({ onRestore: async () => { if (succeeded) props.value = restored; return succeeded; } });
  harness.render(SettingsForm, props);
  input(harness, 'url').props.onChange({ target: { value: 'https://edited.example/v1' } });
  harness.render(SettingsForm, props);
  input(harness, 'file').props.onChange({ target: { files: [{ name: 'backup.json', size: 1, text: async () => '{}' }], value: 'backup.json' } });
  await settle();
  harness.render(SettingsForm, props);
  button(harness, '确认恢复').props.onClick();
  await settle();
  harness.render(SettingsForm, props);
  assert.equal(input(harness, 'url').props.value, 'https://edited.example/v1');
  assert.ok(button(harness, '确认恢复'));
  succeeded = true;
  button(harness, '确认恢复').props.onClick();
  await settle();
  harness.render(SettingsForm, props);
  assert.equal(input(harness, 'url').props.value, restored.baseUrl);
  assert.equal(button(harness, '确认恢复'), undefined);
});

test('详情未编辑字段跟随实时书签更新，没有编辑时不提交写入', async () => {
  const harness = createComponentHarness();
  let submitted;
  const { Detail } = editors(harness, async message => { submitted = message; });
  const props = detailProps();
  harness.render(Detail, props);
  props.bookmark = { ...props.bookmark, title: '外部新标题', category: '设计' };
  harness.render(Detail, props);
  assert.equal(input(harness, undefined).props.value, '外部新标题');
  assert.equal(category(harness).props.value, '设计');
  button(harness, '保存修改').props.onClick();
  await settle();
  assert.equal(submitted, undefined);
});

test('详情保留正在编辑的标题，同时同步未编辑分类', async () => {
  const harness = createComponentHarness();
  let submitted;
  const { Detail } = editors(harness, async message => { submitted = message; });
  const props = detailProps();
  harness.render(Detail, props);
  input(harness, undefined).props.onChange({ target: { value: '手动标题' } });
  harness.render(Detail, props);
  props.bookmark = { ...props.bookmark, title: '外部标题', category: '设计' };
  harness.render(Detail, props);
  button(harness, '保存修改').props.onClick();
  await settle();
  assert.deepEqual(submitted, { type: 'EDIT', id: '1', changes: { title: '手动标题' } });
});

test('详情保留手动分类，保存失败保留草稿，成功保存后解除覆盖', async () => {
  const harness = createComponentHarness();
  let succeeded = false;
  const props = detailProps({ run: async (_label, fn) => { if (!succeeded) return false; await fn(); return true; } });
  const { Detail } = editors(harness, async message => { props.bookmark = { ...props.bookmark, ...message.changes }; });
  harness.render(Detail, props);
  category(harness).props.onChange('设计');
  harness.render(Detail, props);
  props.bookmark = { ...props.bookmark, title: '外部标题' };
  harness.render(Detail, props);
  assert.equal(input(harness, undefined).props.value, '外部标题');
  button(harness, '保存修改').props.onClick();
  await settle();
  harness.render(Detail, props);
  assert.equal(category(harness).props.value, '设计');
  succeeded = true;
  button(harness, '保存修改').props.onClick();
  await settle();
  props.bookmark = { ...props.bookmark, category: '开发' };
  harness.render(Detail, props);
  assert.equal(category(harness).props.value, '开发');
});

test('未分类详情不假选首个分类，标签编辑不会顺带分类', () => {
  const harness = createComponentHarness();
  const { Detail } = editors(harness);
  harness.render(Detail, detailProps({ bookmark: { ...bookmark(), category: '' } }));
  assert.equal(category(harness).props.value, '');
});

test('设置保存等待期间的新输入保留，已经提交的其他字段解除覆盖', async () => {
  globalThis.chrome = { permissions: { request: async () => true } };
  let finish;
  const waiting = new Promise(resolve => { finish = resolve; });
  const harness = createComponentHarness();
  const { SettingsForm } = editors(harness);
  let navigated = false;
  const props = settingsProps({ onSave: async value => { props.value = value; await waiting; return true; }, onSaved: () => { navigated = true; } });
  harness.render(SettingsForm, props);
  input(harness, 'password').props.onChange({ target: { value: 'saved-key' } });
  harness.render(SettingsForm, props);
  input(harness, 'url').props.onChange({ target: { value: 'https://saved.example/v1' } });
  harness.render(SettingsForm, props);
  button(harness, '保存设置').props.onClick();
  await settle();
  harness.render(SettingsForm, props);
  input(harness, 'url').props.onChange({ target: { value: 'https://next-edit.example/v1' } });
  finish();
  await settle();
  props.value = { ...props.value, apiKey: 'latest-key' };
  harness.render(SettingsForm, props);
  assert.equal(input(harness, 'url').props.value, 'https://next-edit.example/v1');
  assert.equal(input(harness, 'password').props.value, 'latest-key');
  assert.equal(navigated, false);
});

test('普通保存成功且没有新输入时通知导航，测试连接成功仍留在设置页', async () => {
  globalThis.chrome = { permissions: { request: async () => true } };
  const harness = createComponentHarness();
  const { SettingsForm } = editors(harness);
  let navigations = 0;
  const props = settingsProps({ onSaved: () => { navigations++; } });
  harness.render(SettingsForm, props);
  button(harness, '保存设置').props.onClick();
  await settle();
  assert.equal(navigations, 1);
  harness.render(SettingsForm, props);
  button(harness, '测试连接').props.onClick();
  await settle();
  assert.equal(navigations, 1);
});

test('App 保存回调保留设置页，只有编辑组件通知完成时才导航', async t => {
  const listener = { addListener() {}, removeListener() {} };
  globalThis.chrome = { storage: { local: { get: async () => ({}) }, onChanged: listener }, tabs: { query: async () => [], onActivated: listener, onUpdated: listener } };
  const harness = createComponentHarness();
  t.after(() => harness.unmount());
  const library = loadModule(new URL('../src/library.ts', import.meta.url));
  const { App } = loadModule(new URL('../src/App.tsx', import.meta.url), {
    react: harness.hooks,
    'motion/react': { AnimatePresence: 'div', motion: { main: 'main', div: 'div' }, useReducedMotion: () => true },
    'dexie-react-hooks': { useLiveQuery: () => [] },
    './components/Appearance': { useTheme() {} },
    './components/Detail': {}, './components/SiteIcon': {}, './components/Review': {}, './components/Navigation': {},
    './components/LibraryPanel': { LibraryPanel: 'LibraryPanel' }, './components/ReadingMenu': { ReadingMenu: 'ReadingMenu' },
    './use-bookmark-search': { useBookmarkSearch: () => ({ hits: [], terms: [], snapshotCount: 0, status: 'idle', error: '', retry() {} }) },
    './settings': { ...settings, getSettings: async () => initialSettings(), setSettings: async () => {} },
    './domain': domain, './db': {}, './library': library, './messages': { rpc: async () => true },
  });
  harness.render(App);
  await settle();
  harness.find(node => node.type === 'button' && node.props['aria-label'] === '设置').props.onClick();
  harness.render(App);
  const editorProps = harness.find(node => typeof node.props.onSave === 'function').props;
  assert.equal(await editorProps.onSave(initialSettings(), false), true);
  harness.render(App);
  assert.equal(harness.find(node => node.props.className === 'app').props['data-page'], 'settings');
  editorProps.onSaved();
  harness.render(App);
  assert.equal(harness.find(node => node.props.className === 'app').props['data-page'], 'home');
});

test('详情保存等待期间的新标题保留，已经提交的分类解除覆盖', async () => {
  let finish;
  const waiting = new Promise(resolve => { finish = resolve; });
  const harness = createComponentHarness();
  const props = detailProps({ run: async (_label, fn) => { await fn(); await waiting; return true; } });
  const { Detail } = editors(harness, async message => { props.bookmark = { ...props.bookmark, ...message.changes }; });
  harness.render(Detail, props);
  category(harness).props.onChange('设计');
  harness.render(Detail, props);
  button(harness, '保存修改').props.onClick();
  await settle();
  harness.render(Detail, props);
  input(harness, undefined).props.onChange({ target: { value: '保存期间的新标题' } });
  finish();
  await settle();
  props.bookmark = { ...props.bookmark, category: '开发' };
  harness.render(Detail, props);
  assert.equal(input(harness, undefined).props.value, '保存期间的新标题');
  assert.equal(category(harness).props.value, '开发');
});

test('备份恢复清除此前草稿，同时保留恢复等待期间的新输入', async () => {
  let finish;
  const waiting = new Promise(resolve => { finish = resolve; });
  const harness = createComponentHarness();
  const { SettingsForm } = editors(harness);
  const restored = { ...initialSettings(), baseUrl: 'https://restored.example/v1', apiKey: 'restored-key' };
  const props = settingsProps({ onRestore: async () => { await waiting; props.value = restored; return true; } });
  harness.render(SettingsForm, props);
  input(harness, 'url').props.onChange({ target: { value: 'https://previous-edit.example/v1' } });
  harness.render(SettingsForm, props);
  input(harness, 'file').props.onChange({ target: { files: [{ name: 'backup.json', size: 1, text: async () => '{}' }], value: 'backup.json' } });
  await settle();
  harness.render(SettingsForm, props);
  button(harness, '确认恢复').props.onClick();
  await settle();
  input(harness, 'password').props.onChange({ target: { value: '恢复期间新密钥' } });
  finish();
  await settle();
  harness.render(SettingsForm, props);
  assert.equal(input(harness, 'url').props.value, restored.baseUrl);
  assert.equal(input(harness, 'password').props.value, '恢复期间新密钥');
});

test('详情只修改标签时提交标签补丁，并包含尚未按回车的输入', async () => {
  const harness = createComponentHarness();
  let submitted;
  const props = detailProps({ bookmark: { ...bookmark(), tags: ['React'], readingState: 'none' } });
  const { Detail } = editors(harness, async message => { submitted = message; props.bookmark = { ...props.bookmark, ...message.changes }; });
  harness.render(Detail, props);
  harness.find(node => node.type === 'TagEditor').props.onPendingChange(' 前端 ');
  harness.render(Detail, props);
  props.bookmark = { ...props.bookmark, title: '后台更新标题', category: '设计' };
  harness.render(Detail, props);
  button(harness, '保存修改').props.onClick();
  await settle();
  assert.deepEqual(submitted, { type: 'EDIT', id: '1', changes: { tags: ['React', '前端'] } });
});

test('详情允许清空标签，保存失败保留标签草稿', async () => {
  const harness = createComponentHarness();
  let succeeded = false;
  let submitted;
  const props = detailProps({ bookmark: { ...bookmark(), tags: ['React'], readingState: 'none' }, run: async (_label, fn) => { if (!succeeded) return false; await fn(); return true; } });
  const { Detail } = editors(harness, async message => { submitted = message; props.bookmark = { ...props.bookmark, ...message.changes }; });
  harness.render(Detail, props);
  harness.find(node => node.type === 'TagEditor').props.onChange([]);
  harness.render(Detail, props);
  button(harness, '保存修改').props.onClick();
  await settle();
  harness.render(Detail, props);
  assert.deepEqual(harness.find(node => node.type === 'TagEditor').props.value, []);
  succeeded = true;
  button(harness, '保存修改').props.onClick();
  await settle();
  assert.deepEqual(submitted.changes, { tags: [] });
});

test('详情保存期间新增的标签输入不会被之前成功提交清除', async () => {
  let finish;
  const waiting = new Promise(resolve => { finish = resolve; });
  const harness = createComponentHarness();
  const props = detailProps({ run: async (_label, fn) => { await fn(); await waiting; return true; } });
  const { Detail } = editors(harness, async message => { props.bookmark = { ...props.bookmark, ...message.changes }; });
  harness.render(Detail, props);
  harness.find(node => node.type === 'TagEditor').props.onPendingChange('React');
  harness.render(Detail, props);
  button(harness, '保存修改').props.onClick();
  await settle();
  harness.render(Detail, props);
  harness.find(node => node.type === 'TagEditor').props.onPendingChange('下一条');
  finish();
  await settle();
  harness.render(Detail, props);
  assert.equal(harness.find(node => node.type === 'TagEditor').props.pending, '下一条');
});

test('详情保存期间继续添加标签，第二次保存保留第一次已提交的标签', async () => {
  let finish;
  const waiting = new Promise(resolve => { finish = resolve; });
  const harness = createComponentHarness();
  const submitted = [];
  const props = detailProps({ bookmark: { ...bookmark(), tags: ['A'], readingState: 'none' } });
  const { Detail } = editors(harness, async message => {
    submitted.push(message);
    if (submitted.length === 1) await waiting;
    props.bookmark = { ...props.bookmark, ...message.changes };
  });
  harness.render(Detail, props);
  harness.find(node => node.type === 'TagEditor').props.onPendingChange('B');
  harness.render(Detail, props);
  button(harness, '保存修改').props.onClick();
  await settle();
  harness.render(Detail, props);
  let tagEditor = harness.find(node => node.type === 'TagEditor');
  tagEditor.props.onPendingChange('C');
  harness.render(Detail, props);
  tagEditor = harness.find(node => node.type === 'TagEditor');
  tagEditor.props.onChange([...tagEditor.props.value, 'C']);
  tagEditor.props.onPendingChange('');
  finish();
  await settle();
  harness.render(Detail, props);
  button(harness, '保存修改').props.onClick();
  await settle();
  assert.deepEqual(submitted.map(message => message.changes.tags), [['A','B'],['A','B','C']]);
});

test('详情标签保存失败时保留已提交标签芯片和等待期间的新输入', async () => {
  let finish;
  const waiting = new Promise(resolve => { finish = resolve; });
  const harness = createComponentHarness();
  const props = detailProps({ bookmark: { ...bookmark(), tags: ['A'], readingState: 'none' }, run: async (_label, fn) => { try { await fn(); return true; } catch { return false; } } });
  const { Detail } = editors(harness, async () => { await waiting; throw new Error('写入失败'); });
  harness.render(Detail, props);
  harness.find(node => node.type === 'TagEditor').props.onPendingChange('B');
  harness.render(Detail, props);
  button(harness, '保存修改').props.onClick();
  await settle();
  harness.render(Detail, props);
  harness.find(node => node.type === 'TagEditor').props.onPendingChange('C');
  finish();
  await settle();
  harness.render(Detail, props);
  const tagEditor = harness.find(node => node.type === 'TagEditor');
  assert.deepEqual(tagEditor.props.value, ['A','B']);
  assert.equal(tagEditor.props.pending, 'C');
});
