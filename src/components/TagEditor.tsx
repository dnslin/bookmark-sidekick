import type { KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { MAX_TAG_LENGTH, MAX_TAGS, normalizeTags } from '../domain';

type TagEditorProps = {
  value: string[];
  pending: string;
  onChange: (tags: string[]) => void;
  onPendingChange: (value: string) => void;
  availableTags: string[];
  disabled?: boolean;
  error?: string;
  onError: (message: string) => void;
  label?: string;
};

export function TagEditor({ value, pending, onChange, onPendingChange, availableTags, disabled = false, error = '', onError, label = '添加标签' }: TagEditorProps) {
  function add(input: string) {
    if (!input.trim()) return;
    try {
      const next = normalizeTags([...value, input]);
      if (next.length === value.length) { onError('这个标签已经添加'); return; }
      onChange(next);
      onPendingChange('');
      onError('');
    } catch (cause) { onError(cause instanceof Error ? cause.message : '标签无法添加'); }
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !['Enter', ',', '，'].includes(event.key)) return;
    event.preventDefault();
    add(pending);
  }

  const selected = new Set(value.map(tag => tag.toLowerCase()));
  const suggestions = [...new Set(availableTags)].filter(tag => !selected.has(tag.toLowerCase()) && tag.toLowerCase().includes(pending.trim().toLowerCase())).slice(0, 6);
  return <div className="tag-editor">
    <div className="row-between"><span>标签</span><small>{value.length}/{MAX_TAGS}</small></div>
    <div className="tag-editor-input">
      <div className="tag-list">{value.map(tag => <span key={tag}>{tag}<button type="button" aria-label={`移除标签 ${tag}`} disabled={disabled} onClick={() => { onChange(value.filter(current => current !== tag)); onError(''); }}><X size={13}/></button></span>)}</div>
      <input aria-label={label} aria-invalid={!!error} placeholder="输入标签，按回车添加" value={pending} disabled={disabled} onChange={event => { onPendingChange(event.target.value); onError(''); }} onKeyDown={handleKey}/>
    </div>
    <p className="help">每个标签最多 {MAX_TAG_LENGTH} 个字符，回车添加。</p>
    {!!suggestions.length && <div className="tag-suggestions"><span>已有标签</span>{suggestions.map(tag => <button type="button" key={tag} disabled={disabled} onClick={() => add(tag)}>{tag}</button>)}</div>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>;
}
