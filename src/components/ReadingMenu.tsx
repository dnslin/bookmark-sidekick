import { useState } from 'react';
import { BookOpen, Check, Clock3 } from 'lucide-react';
import type { Bookmark, ReadingState, Snapshot } from '../domain';
import { rpc } from '../messages';
import { Modal } from './Modal';

type ReadingMenuProps = {
  bookmark: Bookmark;
  snapshot?: Snapshot;
  busy: boolean;
  run: (label: string, operation: () => Promise<void>) => Promise<boolean>;
  notify: (message: string) => void;
  onClose: () => void;
  onReader: () => void;
};

export function ReadingMenu({ bookmark, snapshot, busy, run, notify, onClose, onReader }: ReadingMenuProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const disabled = busy || submitting;
  const queued = bookmark.readingState === 'later' || bookmark.readingState === 'reading';
  async function change(state: ReadingState) {
    if (disabled) return;
    setSubmitting(true);
    setError('');
    try {
      if (await run('reading', async () => {
        try { await rpc({ type: 'SET_READING', id: bookmark.id, state }); }
        catch (cause) { setError(cause instanceof Error ? cause.message : '阅读安排保存失败'); throw cause; }
      })) {
        notify(({ none: '已移出阅读列表，书签保留', later: '已加入稍后读', reading: '已开始阅读', read: '已标记为已读' })[state]);
        onClose();
      }
    } finally { setSubmitting(false); }
  }
  return <Modal title="阅读安排" busy={disabled} onClose={onClose}>
    <p className="modal-description">{bookmark.title}</p>
    {snapshot ? <button type="button" className="button full reading-primary" disabled={disabled} onClick={() => { onClose(); onReader(); }}><BookOpen size={16}/>{snapshot.progress > 0 && bookmark.readingState !== 'read' ? `继续阅读 · ${Math.round(snapshot.progress * 100)}%` : '阅读快照'}</button> : <p className="help">尚未保存正文快照，仍可打开原网页阅读。</p>}
    <div className="button-pair">
      <button type="button" className="button secondary" disabled={disabled || queued} onClick={() => void change('later')}><Clock3 size={15}/>{queued ? '已加入稍后读' : bookmark.readingState === 'read' ? '重新加入待读' : '加入稍后读'}</button>
      <button type="button" className="button secondary" disabled={disabled || bookmark.readingState === 'read'} onClick={() => void change('read')}><Check size={15}/>{bookmark.readingState === 'read' ? '已读' : '标记已读'}</button>
    </div>
    {bookmark.readingState !== 'none' && <button type="button" className="text-button full reading-remove" disabled={disabled} onClick={() => void change('none')}>移出阅读列表，保留书签</button>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </Modal>;
}
