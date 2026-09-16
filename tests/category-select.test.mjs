import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = readFileSync(new URL('../src/components/CategorySelect.tsx', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
const component = { exports: {} };
const require = createRequire(import.meta.url);
new Function('require', 'module', 'exports', outputText)(name => name.endsWith('.css') ? {} : require(name), component, component.exports);
const render = (props = {}) => renderToStaticMarkup(React.createElement(component.exports.CategorySelect, { label: '建议分类', value: '开发', categories: ['开发', '设计'], onChange() {}, ...props }));

test('分类选择器提供可访问名称、当前值及折叠状态', () => {
  const html = render();
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-label="建议分类"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-haspopup="listbox"/);
  assert.match(html, /<span>开发<\/span>/);
  assert.doesNotMatch(html, /<select/);
});
test('忙碌与空分类状态禁用选择器', () => {
  assert.match(render({ disabled: true }), /disabled=""/);
  assert.match(render({ value: '', categories: [] }), /disabled=""/);
  assert.doesNotMatch(render(), /disabled=""/);
});
test('分类之外的当前值仍然可见且可选择', () => {
  const html = render({ value: '新分类', categories: [] });
  assert.match(html, /<span>新分类<\/span>/);
  assert.doesNotMatch(html, /disabled=""/);
});
