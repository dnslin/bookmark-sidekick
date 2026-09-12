import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanUrl, isWebUrl, flattenBookmarks, mergeNative, canApply, applySuggestion, isClaimable, validateBatchIds, classifyStatus, safeError, hostname } from '../src/domain.ts';

const native = { id: '10', title: 'Go docs', url: 'https://go.dev/doc/', folder: 'Bookmarks / 开发', addedAt: 100 };
const bookmark = () => mergeNative(undefined, native);
const draft = () => ({ bookmarkId: '10', revision: 1, category: '开发', tags: ['go'], summary: 'Go 文档', confidence: .9 });

test('只移除明确的跟踪参数，保留业务参数与锚点', () => {
  assert.equal(cleanUrl('https://example.com/read?id=12&key=abc&utm_source=x&fbclid=xyz#example'), 'https://example.com/read?id=12&key=abc#example');
});
test('ref/source/signature 参数不能误删', () => {
  assert.equal(cleanUrl('https://example.com/a?ref=b&source=docs&signature=x'), 'https://example.com/a?ref=b&source=docs&signature=x');
});
test('跟踪参数清理大小写不敏感', () => {
  assert.equal(cleanUrl('https://example.com/?UTM_SOURCE=x&GCLID=y'), 'https://example.com/');
});
test('非 HTTP 页面不发送给网页分析器', () => {
  for (const url of ['javascript:alert(1)', 'chrome://extensions', 'file:///etc/passwd', 'not a url']) {
    assert.equal(isWebUrl(url), false); assert.throws(() => cleanUrl(url));
  }
});
test('允许本地模型使用 HTTP', () => assert.equal(isWebUrl('http://127.0.0.1:11434/v1'), true));
test('读取书签保留原始层级，不修改传入树', () => {
  const tree = [{ id: '0', title: '', children: [{ id: '1', title: '书签栏', children: [{ id: '2', title: '开发', children: [{ id: '10', title: 'Go', url: 'https://go.dev', dateAdded: 5 }] }] }] }];
  const before = structuredClone(tree);
  const result = flattenBookmarks(tree);
  assert.equal(result[0].folder, '书签栏 / 开发'); assert.deepEqual(tree, before);
});
test('同 URL 的多个原生书签仍保持独立 ID', () => {
  const result = flattenBookmarks([{ id: '1', title: 'A', url: 'https://example.com' }, { id: '2', title: 'B', url: 'https://example.com' }]);
  assert.equal(result.length, 2); assert.notEqual(result[0].id, result[1].id);
});
test('无标题书签回退为 URL', () => {
  assert.equal(flattenBookmarks([{ id: 'a', title: '', url: 'https://example.com' }])[0].title, 'https://example.com');
});
test('初次读取不赋予正式分类', () => {
  const b = bookmark(); assert.equal(b.category, ''); assert.deepEqual(b.tags, []); assert.equal(b.summary, '');
});
test('重复同步保留已经确认的分类', () => {
  const b = { ...bookmark(), category: '开发', manual: true };
  assert.deepEqual(mergeNative(b, native), b);
});
test('只移动文件夹不让正文版本失效', () => {
  const after = mergeNative(bookmark(), { ...native, folder: '新的位置' });
  assert.equal(after.revision, 1); assert.equal(after.folder, '新的位置');
});
test('URL 变化会清除旧的 AI 分类和访问状态', () => {
  const b = { ...bookmark(), category: '开发', summary: '旧内容', manual: true, linkState: 'unavailable' };
  const after = mergeNative(b, { ...native, url: 'https://example.com/new' });
  assert.equal(after.revision, 2); assert.equal(after.category, ''); assert.equal(after.summary, ''); assert.equal(after.linkState, 'unknown');
});
test('标题变化会使尚未应用的建议过期', () => {
  const after = mergeNative(bookmark(), { ...native, title: 'Changed' });
  assert.equal(canApply(after, draft()), false);
});
test('被删除的书签不能应用建议', () => assert.equal(canApply(undefined, draft()), false));
test('建议不能串到另一个书签', () => assert.equal(canApply({ ...bookmark(), id: '11' }, draft()), false));
test('未经调用确认逻辑，草稿不会修改书签', () => {
  const b = bookmark(); const d = draft(); const before = structuredClone(b);
  assert.equal(canApply(b, d), true); assert.deepEqual(b, before); assert.equal(b.category, '');
});
test('确认后生成正式分类，仍不修改输入对象', () => {
  const b = bookmark(); const applied = applySuggestion(b, draft());
  assert.equal(applied.category, '开发'); assert.equal(b.category, ''); assert.notEqual(applied, b);
});
test('过期建议必须拒绝，不能覆盖手动修改', () => {
  assert.throws(() => applySuggestion({ ...bookmark(), revision: 2, manual: true }, draft()), /重新分析/);
});
test('后台中断后，过期运行任务可重新领取', () => {
  const task = { bookmarkId: '10', revision: 1, mode: 'draft', status: 'running', leaseUntil: 1000, attempts: 1 };
  assert.equal(isClaimable(task, 999), false); assert.equal(isClaimable(task, 1000), true);
});
test('失败任务不会自动无限重试', () => {
  assert.equal(isClaimable({ bookmarkId: '10', revision: 1, mode: 'draft', status: 'failed', leaseUntil: 0, attempts: 1 }, 9000), false);
});
test('待处理任务可以领取', () => {
  assert.equal(isClaimable({ bookmarkId: '10', revision: 1, mode: 'draft', status: 'pending', leaseUntil: 0, attempts: 0 }, 0), true);
});
test('模型必须完整返回所有输入 ID', () => {
  assert.doesNotThrow(() => validateBatchIds(['a', 'b'], ['b', 'a']));
  assert.throws(() => validateBatchIds(['a', 'b'], ['a']), /不完整/);
  assert.throws(() => validateBatchIds(['a'], ['x']), /不匹配/);
});
test('模型的重复 ID 输出被拒绝', () => {
  assert.throws(() => validateBatchIds(['a', 'b'], ['a', 'a']), /重复/);
});
test('404 和 410 标记为可能失效', () => {
  assert.equal(classifyStatus(404).state, 'unavailable'); assert.equal(classifyStatus(410).state, 'unavailable');
});
test('登录、限流和反爬不是失效', () => {
  for (const status of [401, 403, 429]) assert.equal(classifyStatus(status).state, 'restricted');
});
test('5xx 或其他未知响应不误判失效', () => {
  for (const status of [400, 451, 500, 502, 503]) assert.equal(classifyStatus(status).state, 'unknown');
});
test('成功响应标记可访问', () => assert.equal(classifyStatus(200).state, 'available'));
test('模型错误不能泄漏原始请求密钥', () => {
  const error = { message: 'secret-key-value in request headers', statusCode: 500 };
  assert.equal(safeError(error).includes('secret-key-value'), false);
});
test('超时和鉴权错误提供可操作提示', () => {
  assert.match(safeError({ name: 'TimeoutError' }), /超时/); assert.match(safeError({ statusCode: 401 }), /API Key/);
});
test('域名展示不崩溃', () => {
  assert.equal(hostname('https://example.com/a'), 'example.com'); assert.equal(hostname('bad'), 'bad');
});
