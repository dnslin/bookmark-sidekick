import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme, readThemePreference, THEME_KEY } from '../src/theme.ts';

test('自动主题使用当地时间且在 7 点和 19 点切换', () => {
  for (const [hour, minute, expected] of [[0,0,'dark'],[6,59,'dark'],[7,0,'light'],[18,59,'light'],[19,0,'dark'],[23,59,'dark']]) {
    assert.equal(resolveTheme('auto', new Date(2026, 8, 15, hour, minute)), expected);
  }
});
test('手动选择覆盖时间规则', () => {
  assert.equal(resolveTheme('dark', new Date(2026, 8, 15, 12)), 'dark');
  assert.equal(resolveTheme('light', new Date(2026, 8, 15, 23)), 'light');
});
test('保存的主题被读取，首次使用默认自动', () => {
  for (const value of [null, 'auto', 'light', 'dark', 'invalid']) {
    globalThis.localStorage = { getItem(key) { assert.equal(key, THEME_KEY); return value; } };
    assert.equal(readThemePreference(), value === 'light' || value === 'dark' ? value : 'auto');
  }
  delete globalThis.localStorage;
});
