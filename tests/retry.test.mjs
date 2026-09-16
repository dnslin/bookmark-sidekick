import test from 'node:test';
import assert from 'node:assert/strict';
import { taskFailure, analysisTotal, isClaimable, withTimeoutRetries } from '../src/domain.ts';

test('超时后重试三次，第四次请求失败才停止', () => {
  const error = new DOMException('timed out', 'TimeoutError');
  for (let attempts = 1; attempts <= 3; attempts++) {
    const result = taskFailure(error, attempts);
    assert.equal(result.status, 'pending');
    assert.equal(isClaimable(result, Date.now()), true);
    assert.match(result.error, new RegExp(`${attempts}/3`));
  }
  const exhausted = taskFailure(error, 4);
  assert.equal(exhausted.status, 'failed');
  assert.equal(isClaimable(exhausted, Date.now()), false);
  assert.match(exhausted.error, /已自动重试 3 次/);
});

test('鉴权、限流、普通取消、输出错误不自动重试', () => {
  for (const error of [{ statusCode: 401 }, { statusCode: 429 }, { name: 'AbortError' }, new SyntaxError('invalid JSON')]) {
    assert.equal(taskFailure(error, 1).status, 'failed');
  }
});

test('进度总量在新一轮重置，追加任务增加，重新分析已有任务不重复累计', () => {
  assert.equal(analysisTotal(20, 0, 6), 6);
  assert.equal(analysisTotal(20, 10, 14), 24);
  assert.equal(analysisTotal(20, 10, 10), 20);
  assert.equal(analysisTotal(0, 10, 12), 12);
});

test('连接测试超时后最多执行四次并保留最终原始错误', async () => {
  const timeout = new DOMException('request timed out', 'TimeoutError');
  let calls = 0;
  await assert.rejects(withTimeoutRetries(async () => { calls++; throw timeout; }), error => error === timeout);
  assert.equal(calls, 4);
});

test('连接测试重试成功立即返回，不重试非超时错误', async () => {
  let calls = 0;
  assert.equal(await withTimeoutRetries(async () => {
    if (++calls < 3) throw new DOMException('timeout', 'TimeoutError');
    return 'connected';
  }), 'connected');
  assert.equal(calls, 3);
  const authError = { statusCode: 401 };
  calls = 0;
  await assert.rejects(withTimeoutRetries(async () => { calls++; throw authError; }), error => error === authError);
  assert.equal(calls, 1);
});
