import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const source = readFileSync(new URL('../src/components/CategoryEditor.tsx', import.meta.url), 'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}});
const component={exports:{}};
new Function('require','module','exports',outputText)(createRequire(import.meta.url),component,component.exports);
const {CategoryEditor}=component.exports;
const render=categories=>renderToStaticMarkup(React.createElement(CategoryEditor,{categories,onChange(){}}));
test('分类名称中的中英文逗号保留在独立输入框中',()=>{
 const html=render(['小说, 漫画','设计，开发']);
 assert.equal((html.match(/<input/g)||[]).length,2);
 assert.match(html,/value="小说, 漫画"/);
 assert.match(html,/value="设计，开发"/);
 assert.doesNotMatch(html,/<textarea/);
});
test('至少保留一个分类，最多添加二十项',()=>{
 assert.match(render(['开发']),/<button[^>]*aria-label="删除分类 开发"[^>]*disabled/);
 assert.match(render(Array.from({length:20},(_,i)=>`分类${i}`)),/<button[^>]*disabled=""[^>]*>[\s\S]*添加分类/);
});
