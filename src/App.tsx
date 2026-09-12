import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Fuse from 'fuse.js';
import DOMPurify from 'dompurify';
import { ArrowLeft, Bookmark as BookmarkIcon, Check, ChevronRight, ExternalLink, FileText, Folder, MoreHorizontal, Pause, Play, Plus, RefreshCw, Search, Settings as SettingsIcon, Sparkles, Trash2, X, AlertCircle } from 'lucide-react';
import { db } from './db';
import { cleanUrl, hostname, isWebUrl } from './domain';
import type { Bookmark, Snapshot, Suggestion } from './domain';
import { defaultSettings, getSettings, isConfigured, originPattern, setSettings, settingsSchema } from './settings';
import type { Settings } from './settings';
import { rpc } from './messages';
import { exportBackup, importBackup } from './backup';

type Page = 'home' | 'categories' | 'review' | 'detail' | 'reader' | 'settings';
const stateLabels = { unknown: '尚未确认可访问性', available: '原网页可访问', unavailable: '原网页可能已失效', restricted: '网站限制访问' };

export function App() {
  const bookmarks = useLiveQuery(() => db.bookmarks.orderBy('addedAt').reverse().toArray(), [], []);
  const drafts = useLiveQuery(() => db.drafts.toArray(), [], []);
  const tasks = useLiveQuery(() => db.tasks.toArray(), [], []);
  const [settings, updateSettings] = useState<Settings>(defaultSettings);
  const [page, setPage] = useState<Page>('home');
  const [selectedId, selectId] = useState('');
  const [category, filterCategory] = useState('');
  const [query, search] = useState('');
  const [currentTab, setCurrentTab] = useState<chrome.tabs.Tab>();
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const selected = bookmarks.find(b => b.id === selectedId);
  const snapshot = useLiveQuery(() => selectedId ? db.snapshots.get(selectedId) : undefined, [selectedId]);
  const configured = isConfigured(settings);
  const failed = tasks.filter(t => t.status === 'failed');
  const remaining = tasks.filter(t => t.status !== 'failed');
  const unclassified = bookmarks.filter(b => !b.category && isWebUrl(b.url));
  const existing = currentTab?.url && isWebUrl(currentTab.url)
    ? bookmarks.find(b => isWebUrl(b.url) && cleanUrl(b.url) === cleanUrl(currentTab.url!)) : undefined;

  useEffect(() => {
    const load = () => { void getSettings().then(updateSettings); };
    const tab = () => { void chrome.tabs.query({ active: true, currentWindow: true }).then(([value]) => setCurrentTab(value)); };
    const changed = (_id: number, info: chrome.tabs.TabChangeInfo) => { if (info.url || info.title || info.status === 'complete') tab(); };
    load(); tab();
    chrome.tabs.onActivated.addListener(tab);
    chrome.tabs.onUpdated.addListener(changed);
    chrome.storage.onChanged.addListener(load);
    void rpc({ type: 'SYNC' }).catch(e => setNotice(e.message)).finally(() => setReady(true));
    return () => {
      chrome.tabs.onActivated.removeListener(tab);
      chrome.tabs.onUpdated.removeListener(changed);
      chrome.storage.onChanged.removeListener(load);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    try { await fn(); } catch (e) { setNotice(e instanceof Error ? e.message : '操作失败，请重试'); }
    finally { setBusy(''); }
  }
  function details(b: Bookmark) { selectId(b.id); setPage('detail'); }
  async function open(b: Bookmark) {
    if (!isWebUrl(b.url)) { setNotice('此类链接请从 Chrome 原生书签打开'); return; }
    const saved = await db.snapshots.get(b.id);
    if (b.linkState === 'unavailable' && saved) {
      selectId(b.id); setPage('reader'); setNotice('上次检查该页面不可访问，显示已保存的正文'); return;
    }
    await chrome.tabs.create({ url: b.url });
  }
  async function saveCurrent() {
    const tab = currentTab;
    if (!tab?.id || !tab.url || !isWebUrl(tab.url)) { setNotice('请打开一个普通网页后再收藏'); return; }
    // Permission request is called directly from the click, before awaiting unrelated work.
    const permission = chrome.permissions.request({ origins: [originPattern(tab.url)] });
    await run('save', async () => {
      let captured: Omit<Snapshot, 'bookmarkId' | 'capturedAt'> | undefined;
      let warning = '';
      if (await permission) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ['extract.js'] });
          const result = await chrome.tabs.sendMessage(tab.id!, { type: 'EXTRACT_CURRENT_PAGE' });
          if (result?.ok && cleanUrl(result.url) !== cleanUrl(tab.url!)) throw new Error('页面已切换，请重新收藏');
          if (result?.ok) captured = { url: result.url, html: result.html, text: result.text };
          else warning = '未提取到正文，仅保存书签';
        } catch (error) {
          if (error instanceof Error && error.message === '页面已切换，请重新收藏') throw error;
          warning = '当前页不能提取正文，仅保存书签';
        }
      } else warning = '未授权读取网页，仅保存书签';
      const result = await rpc<{ id: string; existed: boolean }>({ type: 'SAVE', url: tab.url!, title: tab.title || tab.url!, snapshot: captured });
      setNotice(warning || (result.existed ? '书签已存在，阅读快照已更新' : configured ? '已收藏，正在自动分类' : '已收藏，可稍后配置 AI 分类'));
    });
  }
  const filtered = useMemo(() => {
    const scoped = category ? bookmarks.filter(b => b.category === category) : bookmarks;
    if (!query.trim()) return scoped;
    return new Fuse(scoped, { keys: [{ name: 'title', weight: 3 }, 'url', 'category', 'tags', 'summary'], threshold: 0.36, ignoreLocation: true })
      .search(query.trim()).map(r => r.item);
  }, [bookmarks, query, category]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of bookmarks) if (b.category) map.set(b.category, (map.get(b.category) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [bookmarks]);

  const nav = (p: Page) => { setPage(p); filterCategory(''); search(''); };
  const tabPages = ['home', 'categories', 'review'].includes(page);
  return <div className="app" data-page={page}>
    <header className="app-header">
      {tabPages ? <span className="brand-icon"><BookmarkIcon size={19} strokeWidth={2.4} /></span>
        : <button className="icon-button" aria-label="返回" onClick={() => setPage(page === 'reader' ? 'detail' : 'home')}><ArrowLeft size={20}/></button>}
      <div className="brand-text"><strong>拾签<span className="version">0.1</span></strong><span>收藏之后，轻松找回</span></div>
      <button className={`icon-button ${page === 'settings' ? 'active-icon' : ''}`} aria-label="设置" onClick={() => setPage('settings')}><SettingsIcon size={19}/></button>
    </header>

    {notice && <div className="toast" role="status"><span>{notice}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15}/></button></div>}

    {tabPages && <>
      <div className="search-box"><Search size={17}/><input aria-label="搜索书签" placeholder="搜索书签、分类、域名…" value={query} onChange={e => { search(e.target.value); if (page !== 'home') setPage('home'); }}/>{query && <button className="icon-button" aria-label="清空搜索" onClick={() => search('')}><X size={14}/></button>}</div>
      <div className="current-page">
        <div className="eyebrow">当前页面</div>
        <div className="current-content"><div className="current-text"><strong title={currentTab?.title}>{currentTab?.title || '打开网页，开始收藏'}</strong><span>{currentTab?.url ? hostname(currentTab.url) : '支持 HTTP / HTTPS 网页'}</span></div>
          <button className={`button small ${existing ? 'secondary' : ''}`} disabled={!!busy || !currentTab?.url || !isWebUrl(currentTab.url)} onClick={() => existing ? details(existing) : void saveCurrent()}>{existing ? <Check size={15}/> : <Plus size={15}/>} {busy === 'save' ? '保存中' : existing ? '已收藏' : '收藏'}</button>
        </div>
      </div>
      <nav className="tabs" aria-label="书签导航">
        <button className={page === 'home' ? 'selected' : ''} onClick={() => nav('home')}>最近</button>
        <button className={page === 'categories' ? 'selected' : ''} onClick={() => nav('categories')}>分类</button>
        <button className={page === 'review' ? 'selected' : ''} onClick={() => nav('review')}>待确认{drafts.length > 0 && <span className="badge">{drafts.length}</span>}</button>
      </nav>
    </>}

    <main key={page} className="page-stage">
      {page === 'home' && <>
        {!ready && <div className="empty">正在读取 Chrome 书签…</div>}
        {ready && !configured && <div className="intro-card"><Sparkles size={21}/><h2>让书签自己找到位置</h2><p>已加载 {bookmarks.length} 个书签。配置模型后生成分类建议，确认前不应用分类。</p><button className="button full" onClick={() => setPage('settings')}>配置 AI 分类 <ChevronRight size={16}/></button></div>}
        {configured && remaining.length > 0 && <div className="job-card"><div className="row-between"><span><span className={settings.paused ? '' : 'pulse-dot'}/>{settings.paused ? '分析已暂停' : '正在生成分类建议'}</span><button className="icon-button" aria-label={settings.paused ? '继续分析' : '暂停分析'} onClick={() => void run('pause', async () => { await rpc({ type: 'PAUSE', paused: !settings.paused }); })}>{settings.paused ? <Play size={15}/> : <Pause size={15}/>}</button></div><p>待处理 {remaining.length} 项 · 已有 {drafts.length} 项建议</p><small>关闭侧边栏不会清空进度；浏览器重启后可继续。</small></div>}
        {failed.length > 0 && <div className="warning-card"><AlertCircle size={17}/><div>{failed.length} 项分析失败<p>{failed[0]?.error}</p><button className="text-button" onClick={() => void run('retry', async () => { await rpc({ type: 'RETRY' }); })}>重试失败项</button></div></div>}
        {configured && unclassified.length > 0 && !remaining.length && !drafts.length && !failed.length && <button className="suggestion-banner" disabled={!!busy} onClick={() => void run('analyze', async () => { await rpc({ type: 'ANALYZE' }); setNotice('已开始生成建议，完成后在「待确认」检查'); })}><Sparkles size={17}/><span>为未分类书签生成建议</span><ChevronRight size={16}/></button>}
        {drafts.length > 0 && <button className="suggestion-banner" onClick={() => setPage('review')}><Sparkles size={17}/><span>{drafts.length} 个分类建议等你确认</span><ChevronRight size={16}/></button>}
        <div className="section-label"><span>{category || (query ? '搜索结果' : '你的收藏')}<span className="muted-count">{filtered.length}</span></span>{category && <button className="text-button" onClick={() => filterCategory('')}>清除筛选</button>}</div>
        {filtered.map(b => <BookmarkRow key={b.id} bookmark={b} onOpen={() => void run('open', async () => { await open(b); })} onDetails={() => details(b)}/>)}
        {ready && !filtered.length && <div className="empty"><BookmarkIcon size={29}/><h3>{query ? '没有找到匹配的书签' : '这里还没有书签'}</h3><p>{query ? '换个标题、域名或分类试试。' : '打开网页，点击上方「收藏」。'}</p></div>}
      </>}
      {page === 'categories' && <><div className="section-label">已确认分类<span className="muted-count">{counts.length}</span></div><div className="category-list">{counts.map(([name, count], index) => <button key={name} onClick={() => { filterCategory(name); setPage('home'); }}><span className={`folder-icon tone-${index % 4}`}><Folder size={18}/></span><strong>{name}</strong><span>{count}</span><ChevronRight size={16}/></button>)}</div>{!counts.length && <div className="empty"><Folder size={29}/><h3>还没有已确认的分类</h3><p>AI 建议会先出现在「待确认」，不会直接改变这里。</p></div>}</>}
      {page === 'review' && <Review drafts={drafts} bookmarks={bookmarks} categories={settings.categories} busy={!!busy} working={remaining.length} run={run} notify={setNotice}/>}
      {page === 'settings' && <SettingsForm value={settings} busy={!!busy} unclassifiedCount={unclassified.length} onSave={async (value, test) => {
        await run('settings', async () => {
          await setSettings(value); updateSettings(value);
          if (test) { await rpc({ type: 'TEST_MODEL' }); setNotice('模型连接正常，输出校验通过'); }
          else if (isConfigured(value) && unclassified.length) {
            await rpc({ type: 'ANALYZE' }); setPage('home'); setNotice('已保存设置，开始生成未分类书签的建议');
          } else { setNotice('设置已保存'); setPage('home'); }
        });
      }} notify={setNotice} onBackup={() => void run('backup', async () => {
        const blob = new Blob([JSON.stringify(await exportBackup(), null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `bookmark-sidekick-${new Date().toISOString().slice(0, 10)}.json`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000); setNotice('已导出分类与快照；不包含 API Key');
      })} onRestore={file => void run('restore', async () => {
        if (file.size > 100 * 1024 * 1024) throw new Error('MVP 暂支持 100 MB 以内的备份文件');
        if (!window.confirm('将恢复匹配网址的分类与快照，覆盖插件内现有分类。不会改动 Chrome 文件夹。继续？')) return;
        await rpc({ type: 'SYNC' });
        const result = await importBackup(JSON.parse(await file.text()));
        setNotice(`已恢复 ${result.restored} 项，跳过 ${result.skipped} 项。未匹配的 Chrome 书签不会创建`);
      })}/>}
      {page === 'detail' && selected && <Detail key={selected.id} bookmark={selected} snapshot={snapshot} categories={settings.categories} busy={!!busy} configured={configured} run={run} notify={setNotice} onReader={() => setPage('reader')} onOpen={() => void run('open', () => open(selected))} onDeleted={() => setPage('home')}/>}
      {page === 'reader' && selected && snapshot && <Reader bookmark={selected} snapshot={snapshot}/>}
      {['detail', 'reader'].includes(page) && !selected && <div className="empty">该书签已被删除<button className="text-button" onClick={() => setPage('home')}>返回收藏</button></div>}
    </main>
    {page === 'home' && <footer><span className="local-dot"/>数据保存在当前浏览器<span>v0.1.0</span></footer>}
  </div>;
}

function BookmarkRow({ bookmark: b, onOpen, onDetails }: { bookmark: Bookmark; onOpen: () => void; onDetails: () => void }) {
  return <article className={`bookmark-row ${b.linkState === 'unavailable' ? 'is-unavailable' : ''}`}><button className="bookmark-main" onClick={onOpen} title={b.url}><span className="site-icon">{hostname(b.url).replace(/^www\./, '').slice(0, 1).toUpperCase()}</span><span className="bookmark-copy"><strong>{b.title}</strong><span>{hostname(b.url)}{b.category && <> · <em>{b.category}</em></>}</span>{b.summary && <small>{b.summary}</small>}{b.linkState === 'unavailable' && <small className="danger-text">原网页可能已失效</small>}</span></button><button className="icon-button item-menu" onClick={onDetails} aria-label={`查看 ${b.title} 的详情`}><MoreHorizontal size={18}/></button></article>;
}

type Runner = (label: string, fn: () => Promise<void>) => Promise<void>;
function Review({ drafts, bookmarks, categories, busy, working, run, notify }: { drafts: Suggestion[]; bookmarks: Bookmark[]; categories: string[]; busy: boolean; working: number; run: Runner; notify: (s: string) => void }) {
  const [filter, setFilter] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const groups = new Map<string, number>();
  drafts.forEach(d => groups.set(d.category, (groups.get(d.category) ?? 0) + 1));
  const pending = drafts.filter(d => (!filter || d.category === filter) && (!uncertain || d.confidence < 0.65));
  return <div className="review"><div className="page-heading"><h2>先看建议，再确认</h2><p>{drafts.length} 项建议尚未应用{working > 0 ? `，还有 ${working} 项正在处理` : ''}。Chrome 原有文件夹保持不变。</p></div>
    <div className="filter-chips"><button className={!filter && !uncertain ? 'active' : ''} onClick={() => { setFilter(''); setUncertain(false); }}>全部 {drafts.length}</button>{[...groups].map(([name, count]) => <button key={name} className={filter === name ? 'active' : ''} onClick={() => { setFilter(name); setUncertain(false); }}>{name} {count}</button>)}<button className={uncertain ? 'active' : ''} onClick={() => { setUncertain(!uncertain); setFilter(''); }}>需检查 {drafts.filter(d => d.confidence < 0.65).length}</button></div>
    {pending.map(d => {
      const b = bookmarks.find(b => b.id === d.bookmarkId);
      if (!b) return null;
      return <div className="review-row" key={d.bookmarkId}><strong>{b.title}</strong><small>{hostname(b.url)}</small>{d.confidence < 0.65 && <span className="uncertain-label">信息不足，建议检查</span>}<div className="row-between"><span className="subtle">建议分类</span><select aria-label={`${b.title} 的建议分类`} value={d.category} disabled={busy} onChange={e => void run('draft', async () => { await rpc({ type: 'EDIT_DRAFT', id: b.id, category: e.target.value }); })}>{[...new Set([...categories, d.category])].map(c => <option key={c}>{c}</option>)}</select></div>{d.summary && <p>{d.summary}</p>}</div>;
    })}
    {!drafts.length && <div className="empty"><Check size={30}/><h3>{working ? '建议正在生成' : '目前没有待确认的建议'}</h3><p>{working ? '每完成一批，结果就会出现在这里。' : '新建议生成后会显示在这里。'}</p></div>}
    {pending.length > 0 && <div className="sticky-actions"><small>仅应用当前列表中的 {pending.length} 项，其他建议保留。</small><button className="button full" disabled={busy} onClick={() => void run('apply', async () => {
      const r = await rpc<{ applied: number; skipped: number }>({ type: 'APPLY', ids: pending.map(d => d.bookmarkId) });
      notify(`已应用 ${r.applied} 项分类${r.skipped ? `，${r.skipped} 项内容已变化或分类失效，未应用` : ''}`);
    })}><Check size={17}/>确认并应用 {pending.length} 项</button></div>}
  </div>;
}

function SettingsForm({ value, busy, unclassifiedCount, onSave, notify, onBackup, onRestore }: { value: Settings; busy: boolean; unclassifiedCount: number; onSave: (s: Settings, test: boolean) => Promise<void>; notify: (s: string) => void; onBackup: () => void; onRestore: (file: File) => void }) {
  const [form, setForm] = useState(value);
  const [categoryText, setCategoryText] = useState(value.categories.join('，'));
  const [saving, setSaving] = useState(false);
  async function submit(test: boolean) {
    if (saving || busy) return;
    const parsed = settingsSchema.safeParse({ ...form, baseUrl: form.baseUrl.trim().replace(/\/+$/, ''), categories: categoryText.split(/[,，\n]/).map(s => s.trim()).filter(Boolean) });
    if (!parsed.success) { notify(parsed.error.issues[0]?.message || '请检查设置'); return; }
    if (parsed.data.consent && (!parsed.data.baseUrl || !parsed.data.model)) { notify('请填写 API 地址和模型名称'); return; }
    if (test && !parsed.data.consent) { notify('请先勾选发送书签信息的授权'); return; }
    setSaving(true);
    try {
      if (parsed.data.consent && !await chrome.permissions.request({ origins: [originPattern(parsed.data.baseUrl)] })) { notify('未获得模型接口的访问权限，设置未保存'); return; }
      await onSave({ ...parsed.data, paused: false }, test);
    } catch { notify('保存失败，请检查模型地址和访问权限'); }
    finally { setSaving(false); }
  }
  return <div className="settings-form"><div className="page-heading"><h2>模型与数据</h2><p>使用你自己的 OpenAI-compatible 接口。不需要账号或服务器。</p></div>
    <label>API 地址<input type="url" placeholder="https://你的接口地址/v1" value={form.baseUrl} autoComplete="off" onChange={e => setForm({ ...form, baseUrl: e.target.value })}/><small>填写接口基础地址，通常以 /v1 结尾，不要包含 /chat/completions。</small></label>
    <label>API Key<input type="password" placeholder="本地模型可留空" value={form.apiKey} autoComplete="off" spellCheck={false} onChange={e => setForm({ ...form, apiKey: e.target.value })}/><small>仅保存在当前浏览器，不参与备份或 Chrome 同步。</small></label>
    <label>模型名称<input placeholder="填写接口提供的准确模型 ID" value={form.model} autoComplete="off" onChange={e => setForm({ ...form, model: e.target.value })}/></label>
    <label>分类<textarea rows={3} value={categoryText} onChange={e => setCategoryText(e.target.value)} /><small>用逗号分隔。模型只能从这些分类中选择；不会改名或合并已有分类。</small></label>
    <label className="consent"><input type="checkbox" checked={form.consent} onChange={e => setForm({ ...form, consent: e.target.checked })}/><span>允许向以上模型发送书签标题、网址、原文件夹，以及已保存的正文，用于分类和摘要。</span></label>
    <div className="button-pair"><button className="button secondary" disabled={saving || busy} onClick={() => void submit(true)}>测试连接</button><button className="button" disabled={saving || busy} onClick={() => void submit(false)}>{saving || busy ? '处理中…' : unclassifiedCount && form.consent ? '保存并分析' : '保存设置'}</button></div>
    <div className="divider"/><h3>数据备份</h3><p className="help">备份分类与阅读快照，不包含 API Key。恢复时只匹配现有 Chrome 书签；原生书签请通过 Chrome 自带功能备份。</p><div className="button-pair"><button className="button secondary" onClick={onBackup} disabled={busy}>导出备份</button><label className="button secondary file-button">恢复备份<input type="file" accept=".json,application/json" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) onRestore(file); e.target.value = ''; }}/></label></div>
    <p className="privacy-note"><AlertCircle size={15}/>扩展卸载后，AI 分类和快照会被清除，Chrome 原书签仍在。API Key 保存在本地，并非加密保险箱。</p>
  </div>;
}

function Detail({ bookmark: b, snapshot, categories, busy, configured, run, notify, onReader, onOpen, onDeleted }: { bookmark: Bookmark; snapshot?: Snapshot; categories: string[]; busy: boolean; configured: boolean; run: Runner; notify: (s: string) => void; onReader: () => void; onOpen: () => void; onDeleted: () => void }) {
  const [title, setTitle] = useState(b.title);
  const [category, setCategory] = useState(b.category || categories[0] || '其他');
  async function check() {
    if (!isWebUrl(b.url)) { notify('只能检查普通网页'); return; }
    const permission = chrome.permissions.request({ origins: [originPattern(b.url)] });
    await run('check', async () => {
      if (!await permission) throw new Error('未授权检查该网站');
      await rpc({ type: 'CHECK', id: b.id }); notify('检查完成；受限或超时不会被当作失效链接');
    });
  }
  return <div className="detail"><div className="detail-hero"><span className="large-site-icon">{hostname(b.url).replace(/^www\./, '').slice(0, 1).toUpperCase()}</span><h2>{b.title}</h2><p>{hostname(b.url)}</p></div>
    <label>标题<input value={title} onChange={e => setTitle(e.target.value)}/></label>
    <label>分类<select value={category} onChange={e => setCategory(e.target.value)}>{[...new Set([...categories, ...(b.category ? [b.category] : [])])].map(c => <option key={c}>{c}</option>)}</select></label>
    <button className="button secondary full" disabled={busy || !title.trim()} onClick={() => void run('edit', async () => { await rpc({ type: 'EDIT', id: b.id, title, category }); notify('已保存，手动分类不会被后台任务覆盖'); })}>保存修改</button>
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

function Reader({ bookmark, snapshot }: { bookmark: Bookmark; snapshot: Snapshot }) {
  const safeHtml = useMemo(() => DOMPurify.sanitize(snapshot.html, {
    ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'strong', 'b', 'em', 'i', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'a'],
    ALLOWED_ATTR: ['href'],
  }), [snapshot.html]);
  return <article className="reader"><div className="reader-banner"><FileText size={15}/>这是保存的正文，不是实时网页</div><h1>{bookmark.title}</h1><div className="reader-meta">{hostname(snapshot.url)} · {new Date(snapshot.capturedAt).toLocaleString('zh-CN')}</div><div className="reader-content" dangerouslySetInnerHTML={{ __html: safeHtml }} onClick={e => {
    const anchor = (e.target as HTMLElement).closest('a');
    if (anchor) { e.preventDefault(); if (isWebUrl(anchor.href)) void chrome.tabs.create({ url: anchor.href }); }
  }}/></article>;
}
