import { useState, type FormEvent } from 'react';
import { normalizeTags, type BulkEdits } from '../domain';
import { rpc } from '../messages';
import { Modal } from './Modal';
import { TagEditor } from './TagEditor';

type Result = { applied: number; skipped: number };
type BulkEditorProps = {
  ids: string[];
  categories: string[];
  availableTags: string[];
  busy: boolean;
  run: (label: string, operation: () => Promise<void>) => Promise<boolean>;
  notify: (message: string) => void;
  onClose: () => void;
  onApplied: (result: Result) => void;
};

export function BulkEditor({ ids, categories, availableTags, busy, run, notify, onClose, onApplied }: BulkEditorProps) {
  const [category, setCategory] = useState('');
  const [tagOperation, setTagOperation] = useState<'' | 'add' | 'remove'>('');
  const [tags, setTags] = useState<string[]>([]);
  const [pending, setPending] = useState('');
  const [readingState, setReadingState] = useState<'' | 'none' | 'later' | 'read'>('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const disabled = busy || submitting;
  const hasTags = tags.length > 0 || !!pending.trim();
  const changed = !!category || !!readingState || (!!tagOperation && hasTags);
  const preview = [
    category ? `分类改为「${category}」` : '',
    tagOperation && hasTags ? `${tagOperation === 'add' ? '添加' : '移除'}标签「${[...tags, ...(pending.trim() ? [pending.trim()] : [])].join('、')}」` : '',
    readingState ? ({ none: '移出阅读列表，保留书签', later: '加入稍后读', read: '标记已读' })[readingState] : '',
  ].filter(Boolean);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || !changed || !ids.length) return;
    const changes: BulkEdits = {};
    if (category) changes.category = category;
    if (readingState) changes.readingState = readingState;
    if (tagOperation) {
      try {
        const values = normalizeTags(pending.trim() ? [...tags, pending] : tags);
        if (!values.length) { setError('请输入需要操作的标签'); return; }
        if (pending.trim() && values.length === tags.length) { setError('这个标签已经添加'); return; }
        changes.tags = { operation: tagOperation, values };
      } catch (cause) { setError(cause instanceof Error ? cause.message : '请检查标签'); return; }
    }
    setSubmitting(true);
    setError('');
    let result: Result | undefined;
    try {
      const saved = await run('bulk-edit', async () => {
        try { result = await rpc<Result>({ type: 'BULK_EDIT', ids, changes }); }
        catch (cause) { setError(cause instanceof Error ? cause.message : '批量修改失败，请重试'); throw cause; }
      });
      if (saved && result) {
        notify(`已更新 ${result.applied} 个书签${result.skipped ? `，${result.skipped} 项已删除，已跳过` : ''}`);
        onApplied(result);
      }
    } finally { setSubmitting(false); }
  }

  return <Modal title="批量修改" busy={disabled} onClose={onClose}>
    <p className="modal-description">将应用到选中的 {ids.length} 个书签</p>
    <form onSubmit={event => void submit(event)}>
      <div className="bulk-fields">
        <label>分类<select aria-label="批量分类" value={category} disabled={disabled} onChange={event => setCategory(event.target.value)}><option value="">保持不变</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>标签操作<select aria-label="批量标签操作" value={tagOperation} disabled={disabled} onChange={event => setTagOperation(event.target.value as typeof tagOperation)}><option value="">保持不变</option><option value="add">添加标签，保留原有标签</option><option value="remove">移除指定标签</option></select></label>
        {tagOperation && <TagEditor value={tags} pending={pending} onChange={setTags} onPendingChange={setPending} availableTags={availableTags} disabled={disabled} onError={setError} label="批量操作的标签"/>}
        <label>阅读安排<select aria-label="批量阅读安排" value={readingState} disabled={disabled} onChange={event => setReadingState(event.target.value as typeof readingState)}><option value="">保持不变</option><option value="later">加入稍后读</option><option value="read">标记已读</option><option value="none">移出阅读列表，保留书签</option></select></label>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <p className="bulk-preview">{preview.length ? `${preview.join('；')}。其他字段保持原样。` : '未修改的字段会保持原样。'}</p>
      <div className="button-pair modal-actions"><button className="button secondary" type="button" disabled={disabled} onClick={onClose}>取消</button><button className="button" type="submit" disabled={disabled || !ids.length || !changed || (!!tagOperation && !hasTags)}>{disabled ? '正在修改…' : `应用到 ${ids.length} 项`}</button></div>
    </form>
  </Modal>;
}
