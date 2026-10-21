import test from 'node:test';
import assert from 'node:assert/strict';
import * as domain from '../src/domain.ts';
import { createComponentHarness } from './helpers/component-harness.mjs';
import { loadModule } from './helpers/load-module.mjs';

function setup(extra = {}) {
  const harness = createComponentHarness();
  const TagEditor = loadModule(new URL('../src/components/TagEditor.tsx', import.meta.url), { '../domain':domain }).TagEditor;
  const props = { value:['React'], pending:'', availableTags:['React','react','Vue'], onChange(value) { props.value=value; }, onPendingChange(value) { props.pending=value; }, onError(value) { props.error=value; }, ...extra };
  harness.render(TagEditor,props);
  return {harness,TagEditor,props, input:()=>harness.find(node=>node.type==='input')};
}

test('标签键盘添加会修剪空白，并忽略输入法确认阶段的回车', () => {
  const {harness,TagEditor,props,input} = setup({pending:' 前端 '});
  input().props.onKeyDown({key:'Enter',nativeEvent:{isComposing:true},preventDefault(){assert.fail('不应拦截输入法确认');}});
  assert.deepEqual(props.value,['React']);
  input().props.onKeyDown({key:'，',nativeEvent:{isComposing:false},preventDefault(){}});
  assert.deepEqual(props.value,['React','前端']);
  assert.equal(props.pending,'');
  harness.render(TagEditor,props);
  assert.equal(input().props.value,'');
});

test('重复标签和数量上限显示错误，并保留待输入文本', () => {
  const {harness,TagEditor,props,input} = setup({pending:' react '});
  input().props.onKeyDown({key:'Enter',nativeEvent:{isComposing:false},preventDefault(){}});
  assert.deepEqual(props.value,['React']);
  assert.equal(props.pending,' react ');
  assert.equal(props.error,'这个标签已经添加');
  props.value=Array.from({length:20},(_,i)=>`tag${i}`);
  props.pending='new';
  harness.render(TagEditor,props);
  input().props.onKeyDown({key:'Enter',nativeEvent:{isComposing:false},preventDefault(){}});
  assert.equal(props.value.length,20);
  assert.match(props.error,/20/);
  assert.equal(props.pending,'new');
});

test('移除最后一个标签得到空数组，建议不重复展示已有标签', () => {
  const {harness,props} = setup();
  assert.equal(harness.nodes(node=>node.type==='button' && ['React','react'].includes(node.props.children)).length,0);
  harness.find(node=>node.type==='button' && node.props['aria-label']==='移除标签 React').props.onClick();
  assert.deepEqual(props.value,[]);
});

test('粘贴 33 字符标签保留原文并明确报错，不由输入框静默截断', () => {
  const {harness,TagEditor,props,input} = setup();
  assert.equal(input().props.maxLength,undefined,'输入框应允许原始粘贴内容进入标签校验');
  input().props.onChange({target:{value:'长'.repeat(33)}});
  harness.render(TagEditor,props);
  assert.equal(input().props.value.length,33);
  input().props.onKeyDown({key:'Enter',nativeEvent:{isComposing:false},preventDefault(){}});
  harness.render(TagEditor,props);
  assert.equal(input().props.value.length,33);
  assert.match(harness.find(node=>node.props.role==='alert').props.children,/32/);
  assert.deepEqual(props.value,['React']);
});
