import { useState } from 'react';
import { ChevronRight, ExternalLink, FileText, RefreshCw, Trash2 } from 'lucide-react';
import { CategorySelect } from './CategorySelect';
import { SiteIcon } from './SiteIcon';
import { clearSavedEdits } from './editor';
import { hostname, isWebUrl, type Bookmark, type Snapshot } from '../domain';
import { originPattern } from '../settings';
import { rpc } from '../messages';

type Runner = (label: string, fn: () => Promise<void>) => Promise<boolean>;
const stateLabels = { unknown: '尚未确认可访问性', available: '原网页可访问', unavailable: '原网页可能已失效', restricted: '网站限制访问' };

export function Detail({ bookmark: b, snapshot, categories, busy, configured, run, notify, onReader, onOpen, onDeleted }: { bookmark: Bookmark; snapshot?: Snapshot; categories: string[]; busy: boolean; configured: boolean; run: Runner; notify: (s: string) => void; onReader: () => void; onOpen: () => void; onDeleted: () => void }) {
  const [edits, setEdits] = useState<Partial<Pick<Bookmark, 'title' | 'category'>>>({});
  const title = edits.title ?? b.title;
  const category = edits.category ?? (b.category || categories[0] || '其他');
  async function save() {
    if (await run('edit', async () => { await rpc({ type: 'EDIT', id: b.id, title, category }); notify('已保存，手动分类不会被后台任务覆盖'); })) setEdits(current => clearSavedEdits(current, edits));
  }
  async function check() {
    if (!isWebUrl(b.url)) { notify('只能检查普通网页'); return; }
    const permission = chrome.permissions.request({ origins: [originPattern(b.url)] });
    await run('check', async () => {
      if (!await permission) throw new Error('未授权检查该网站');
      await rpc({ type: 'CHECK', id: b.id }); notify('检查完成；受限或超时不会被当作失效链接');
    });
  }
  return <div className="detail"><div className="detail-hero"><SiteIcon url={b.url} size="large"/><h2>{b.title}</h2><p>{hostname(b.url)}</p></div>
    <label>标题<input value={title} onChange={e => setEdits({ ...edits, title: e.target.value })}/></label>
    <div className="detail-category"><span>分类</span><CategorySelect label="分类" value={category} onChange={category => setEdits({ ...edits, category })} categories={[...new Set([...categories, ...(b.category ? [b.category] : [])])]} disabled={busy}/></div>
    <button className="button secondary full" disabled={busy || !title.trim()} onClick={() => void save()}>保存修改</button>
    {!!b.tags.length && <section><h3>标签</h3><div className="tag-list">{b.tags.map(t => <span key={t}>{t}</span>)}</div></section>}
    {b.summary && <section><h3>一句摘要</h3><p>{b.summary}</p></section>}
    <section><div className="row-between"><h3>网页与快照</h3><button className="text-button" disabled={busy} onClick={() => void check()}>{busy ? '处理中' : '检查链接'}</button></div><p className={b.linkState === 'unavailable' ? 'danger-text' : ''}>{stateLabels[b.linkState]}</p>{b.checkDetail && <small>{b.checkDetail}</small>}<p className="snapshot-line"><FileText size={14}/>{snapshot ? `已保存正文 · ${new Date(snapshot.capturedAt).toLocaleDateString('zh-CN')}` : '尚未保存正文快照'}</p><div className="button-pair"><button className="button secondary" onClick={onOpen}><ExternalLink size={15}/>打开网页</button><button className="button" disabled={!snapshot} onClick={onReader}><FileText size={15}/>阅读快照</button></div></section>
    <div className="divider"/><button className="action-row" disabled={busy || !configured} onClick={() => void run('reanalyze', async () => { await rpc({ type: 'ANALYZE', ids: [b.id] }); notify('已重新分析，新结果仍需在「待确认」应用'); })}><RefreshCw size={17}/>重新生成分类建议<ChevronRight size={15}/></button><button className="action-row danger-text" disabled={busy} onClick={() => {
      if (!window.confirm(`删除「${b.title}」？这会同时删除 Chrome 原生书签及其本地快照。`)) return;
      void run('delete', async () => { await rpc({ type: 'DELETE', id: b.id }); onDeleted(); notify('已删除书签'); });
    }}><Trash2 size={17}/>删除书签<ChevronRight size={15}/></button>
    <small className="original-folder">原文件夹：{b.folder || '根目录'}</small>
  </div>;
}
