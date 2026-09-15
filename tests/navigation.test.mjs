import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Compile the TSX with the project's existing compiler; no separate test runtime.
const source = readFileSync(new URL('../src/components/Navigation.tsx', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
const component = { exports: {} };
new Function('require', 'module', 'exports', outputText)(createRequire(import.meta.url), component, component.exports);
const { Navigation } = component.exports;
const render = (page, pendingCount = 0) => renderToStaticMarkup(React.createElement(Navigation, { page, pendingCount, onNavigate() {} }));

test('导航保留三个可访问按钮且仅标记当前页面', () => {
  for (const [page, label] of [['home', '最近'], ['categories', '分类'], ['review', '待确认']]) {
    const html = render(page);
    assert.equal((html.match(/<button/g) || []).length, 3);
    assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
    const current = html.match(/<button[^>]*aria-current="page"[^>]*>([\s\S]*?)<\/button>/)?.[1];
    assert.ok(current?.includes(label));
    assert.match(html, /aria-label="书签导航"/);
  }
});
test('待确认数量可见，零条建议不显示空徽标', () => {
  assert.match(render('home', 12), /待确认<span class="badge">12<\/span>/);
  assert.doesNotMatch(render('review'), /class="badge"/);
});
