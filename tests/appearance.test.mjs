import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as theme from '../src/theme.ts';

const source = readFileSync(new URL('../src/components/Appearance.tsx', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
const component = { exports: {} };
const require = createRequire(import.meta.url);
new Function('require', 'module', 'exports', outputText)(id => id === '../theme' ? theme : require(id), component, component.exports);

test('明暗模式只展示一个切换按钮，图标和操作名称交替变化', () => {
  try {
    for (const [value, action, icon] of [['light', '暗色', 'moon'], ['dark', '亮色', 'sun']]) {
      globalThis.localStorage = { getItem: () => value };
      const html = renderToStaticMarkup(React.createElement(component.exports.Appearance));
      assert.equal((html.match(/<button/g) || []).length, 1);
      assert.match(html, new RegExp(`aria-label="切换到${action}模式"`));
      assert.match(html, new RegExp(`lucide-${icon}`));
      assert.doesNotMatch(html, /radiogroup|type="radio"/);
    }
  } finally { delete globalThis.localStorage; }
});
test('自动模式仍可通过独立复选框开启', () => {
  globalThis.localStorage = { getItem: () => null };
  try {
    const html = renderToStaticMarkup(React.createElement(component.exports.Appearance));
    assert.match(html, /type="checkbox" checked=""/);
    assert.match(html, /按当地时间自动切换/);
  } finally { delete globalThis.localStorage; }
});
