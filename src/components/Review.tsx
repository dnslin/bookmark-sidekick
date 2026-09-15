import { useState } from 'react';
import { Check, ChevronRight, Folder } from 'lucide-react';
import { db } from '../db';
import { hostname, type Bookmark, type Suggestion } from '../domain';
import { rpc } from '../messages';
import { SiteIcon } from './SiteIcon';

type ReviewProps = {
  drafts: Suggestion[];
  bookmarks: Bookmark[];
  categories: string[];
  busy: boolean;
  working: number;
  run: (label: string, fn: () => Promise<void>) => Promise<boolean>;
  notify: (message: string) => void;
};

export function Review({ drafts, bookmarks, categories, busy, working, run, notify }: ReviewProps) {
  const [selectedId, setSelectedId] = useState('');
  const pending = drafts.flatMap(draft => {
    const bookmark = bookmarks.find(item => item.id === draft.bookmarkId);
    return bookmark ? [{ draft, bookmark }] : [];
  });
  const current = pending.find(item => item.draft.bookmarkId === selectedId) ?? pending[0];

  async function apply(ids: string[]) {
    await run('apply', async () => {
      const result = await rpc<{ applied: number; skipped: number }>({ type: 'APPLY', ids });
      notify(`已应用 ${result.applied} 项分类${result.skipped ? `，${result.skipped} 项内容已变化或分类失效，未应用` : ''}`);
    });
  }

  return <div className="review">
    <div className="page-heading"><h1>待确认</h1><p>确认后，应用到你的书签</p></div>
    {current ? <>
      <article className="review-card" aria-label={`${current.bookmark.title} 的分类建议`}>
        <div className="review-bookmark"><SiteIcon url={current.bookmark.url} size="large"/><div><strong>{current.bookmark.title}</strong><small>{hostname(current.bookmark.url)}</small></div></div>
        <div className="review-fields">
          {current.draft.confidence < 0.65 && <span className="uncertain-label">信息不足，建议检查</span>}
          <label><span>建议分类</span><div className="review-category"><Folder size={26} strokeWidth={1.5}/><select aria-label={`${current.bookmark.title} 的建议分类`} value={current.draft.category} disabled={busy} onChange={event => {
            const category = event.target.value;
            void run('draft', async () => { await rpc({ type: 'EDIT_DRAFT', id: current.bookmark.id, category }); });
          }}>{[...new Set([...categories, current.draft.category])].map(category => <option key={category}>{category}</option>)}</select><ChevronRight size={16}/></div></label>
          {!!current.draft.tags.length && <section><h2>建议标签</h2><div className="tag-list">{current.draft.tags.map(tag => <span key={tag}>{tag}</span>)}</div></section>}
          {current.draft.summary && <section><h2>摘要</h2><p>{current.draft.summary}</p></section>}
        </div>
        <div className="review-actions"><button className="text-button" disabled={busy} onClick={() => void run('ignore', async () => { await db.drafts.delete(current.draft.bookmarkId); notify('已忽略这条建议，书签保留'); })}>忽略</button><button className="button" disabled={busy} onClick={() => void apply([current.draft.bookmarkId])}>确认</button></div>
      </article>
      {pending.length > 1 && <>
        <div className="review-queue" aria-label="其他待确认建议">{pending.filter(item => item.draft.bookmarkId !== current.draft.bookmarkId).map(({ draft, bookmark }) => <button key={draft.bookmarkId} disabled={busy} onClick={() => setSelectedId(draft.bookmarkId)} aria-label={`查看 ${bookmark.title} 的分类建议`}><SiteIcon url={bookmark.url}/><span className="review-queue-copy"><strong>{bookmark.title}</strong><small>分类与标签建议</small></span><ChevronRight size={16}/></button>)}</div>
        <button className="text-button review-batch" disabled={busy} onClick={() => void apply(pending.map(item => item.draft.bookmarkId))}>确认并应用全部 {pending.length} 项</button>
      </>}
    </> : <div className="empty"><Check size={30}/><h3>{working ? '建议正在生成' : '目前没有待确认的建议'}</h3><p>{working ? '每完成一批，结果就会出现在这里。' : '新建议生成后会显示在这里。'}</p></div>}
  </div>;
}
