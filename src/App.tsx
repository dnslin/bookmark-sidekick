import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTheme } from './components/Appearance';
import { Detail } from './components/Detail';
import { SiteIcon } from './components/SiteIcon';
import { Review } from './components/Review';
import { groupBookmarksByDate, filterBookmarks } from './library';
import { Navigation, type LibraryPage } from './components/Navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { createBookmarkSearch } from './search';
import { ArrowLeft, Bookmark as BookmarkIcon, BookmarkPlus, Check, ChevronRight, Folder, MoreHorizontal, Pause, Play, Plus, RefreshCw, Search, Settings as SettingsIcon, Sparkles, X, AlertCircle } from 'lucide-react';
import { db } from './db';
import { cleanUrl, hostname, isWebUrl } from './domain';
import type { Bookmark, Snapshot } from './domain';
import { defaultSettings, getSettings, isConfigured, originPattern, setSettings, settingsSchema } from './settings';
import type { Settings } from './settings';
import { rpc } from './messages';

const SettingsForm = lazy(() => import('./components/SettingsForm'));
const Reader = lazy(() => import('./components/Reader'));

type Page = 'home' | 'categories' | 'review' | 'detail' | 'reader' | 'settings';

export function App() {
  useTheme();
  const reducedMotion = useReducedMotion();
  const bookmarks = useLiveQuery(() => db.bookmarks.orderBy('addedAt').reverse().toArray(), [], []);
  const drafts = useLiveQuery(() => db.drafts.toArray(), [], []);
  const tasks = useLiveQuery(() => db.tasks.toArray(), [], []);
  const [settings, updateSettings] = useState<Settings>(defaultSettings);
  const [page, setPage] = useState<Page>('home');
  const [selectedId, selectId] = useState('');
  const [category, filterCategory] = useState<string | null>(null);
  const [tag, filterTag] = useState('');
  const [showCategoryCreate, setShowCategoryCreate] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [query, search] = useState('');
  const [currentTab, setCurrentTab] = useState<chrome.tabs.Tab>();
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const [analysisTotal, setAnalysisTotal] = useState(0);
  const selected = bookmarks.find(b => b.id === selectedId);
  const snapshot = useLiveQuery(() => selectedId ? db.snapshots.get(selectedId) : undefined, [selectedId]);
  const configured = isConfigured(settings);
  const failed = tasks.filter(t => t.status === 'failed');
  const remaining = tasks.filter(t => t.status !== 'failed');
  const unclassified = bookmarks.filter(b => !b.category && isWebUrl(b.url));
  const existing = currentTab?.url && isWebUrl(currentTab.url)
    ? bookmarks.find(b => isWebUrl(b.url) && cleanUrl(b.url) === cleanUrl(currentTab.url!)) : undefined;

  useEffect(() => {
    const load = (changes?: Record<string, chrome.storage.StorageChange>) => {
      if (!changes || changes.settings) void getSettings().then(updateSettings);
      if (!changes || changes.analysisProgress) void chrome.storage.local.get('analysisProgress').then(result => setAnalysisTotal(result.analysisProgress?.total ?? 0));
    };
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

  async function run(label: string, fn: () => Promise<void>): Promise<boolean> {
    if (busy) return false;
    setBusy(label);
    try { await fn(); return true; }
    catch (e) { setNotice(e instanceof Error ? e.message : '操作失败，请重试'); return false; }
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
  const scoped = useMemo(() => filterBookmarks(bookmarks, category, tag), [bookmarks, category, tag]);
  const searchBookmarks = useMemo(() => createBookmarkSearch(scoped), [scoped]);
  const filtered = useMemo(() => searchBookmarks(query), [searchBookmarks, query]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of bookmarks) if (b.category) map.set(b.category, (map.get(b.category) ?? 0) + 1);
    return [...new Set([...settings.categories, ...map.keys()])].map(name => [name, map.get(name) ?? 0] as const);
  }, [bookmarks, settings.categories]);

  const nav = (p: Page) => { setPage(p); filterCategory(null); filterTag(''); search(''); };
  const tags = [...new Set(bookmarks.flatMap(b => b.tags))];
  async function createCategory() {
    const value = settingsSchema.safeParse({ ...settings, categories: [...settings.categories, newCategory.trim()] });
    if (!value.success) { setNotice(value.error.issues[0]?.message || '请检查分类名称'); return; }
    await run('category', async () => { await setSettings(value.data); updateSettings(value.data); setNewCategory(''); setShowCategoryCreate(false); });
  }
  const tabPages = ['home', 'categories', 'review'].includes(page);
  return <div className="app" data-page={page}>
    <header className="app-header">
      {tabPages ? <span className="brand-icon"><BookmarkIcon size={27} strokeWidth={1.6} /></span>
        : <button className="icon-button" aria-label="返回" onClick={() => setPage(page === 'reader' ? 'detail' : 'home')}><ArrowLeft size={20}/></button>}
      <div className="brand-text"><strong>拾签</strong></div>
      {tabPages && <button className="icon-button" aria-label="收藏当前网页" disabled={!!busy || !currentTab?.url || !isWebUrl(currentTab.url)} onClick={() => void saveCurrent()}><Plus size={25}/></button>}
      <button className={`icon-button ${page === 'settings' ? 'active-icon' : ''}`} aria-label="设置" onClick={() => setPage('settings')}><SettingsIcon size={19}/></button>
    </header>

    <AnimatePresence>{notice && <motion.div className="toast" role="status" initial={{ opacity: 0, y: reducedMotion ? 0 : -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}><span>{notice}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15}/></button></motion.div>}</AnimatePresence>

    {tabPages && <>
      <div className="search-box"><Search size={17}/><input aria-label="搜索书签" placeholder="搜索书签" value={query} onChange={e => { search(e.target.value); if (page !== 'home') setPage('home'); }}/>{query && <button className="icon-button" aria-label="清空搜索" onClick={() => search('')}><X size={14}/></button>}</div>
      <div className="current-page"><div className="current-content">
        <SiteIcon url={currentTab?.url || ''}/><div className="current-text"><span className="eyebrow">当前网页</span><strong title={currentTab?.title}>{currentTab?.title || '打开网页，开始收藏'}</strong></div>
        <button className="save-current" disabled={!!busy || !currentTab?.url || !isWebUrl(currentTab.url)} onClick={() => existing ? details(existing) : void saveCurrent()}>{existing ? <Check size={22}/> : <BookmarkPlus size={22}/>} {busy === 'save' ? '保存中' : existing ? '已收藏' : '收藏'}</button>
      </div></div>
      <Navigation page={page as LibraryPage} pendingCount={drafts.length} onNavigate={nav}/>
    </>}

    <motion.main key={page} className="page-stage" initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
      {configured && tasks.length > 0 && <div className="job-card" role="status">
        <div className="row-between"><span><span className={settings.paused ? '' : 'pulse-dot'}/>{settings.paused ? '分析已暂停' : '正在生成分类建议'}</span><button className="icon-button" aria-label={settings.paused ? '继续分析' : '暂停分析'} disabled={!!busy} onClick={() => void run('pause', async () => { await rpc({ type: 'PAUSE', paused: !settings.paused }); })}>{settings.paused ? <Play size={15}/> : <Pause size={15}/>}</button></div>
        <progress className="analysis-progress" aria-label="书签分析进度" max={Math.max(analysisTotal, tasks.length)} value={Math.max(0, analysisTotal - tasks.length)}/>
        <p>已完成 {Math.max(0, analysisTotal - tasks.length)} / {Math.max(analysisTotal, tasks.length)} 项{failed.length ? ` · 失败 ${failed.length} 项` : ''}</p>
        {!settings.paused && tasks.some(t => t.status === 'running' && t.attempts > 1) && <p>响应超时，正在进行第 {Math.max(...tasks.filter(t => t.status === 'running').map(t => t.attempts)) - 1} / 3 次重试</p>}
        <small>每完成一批更新进度；关闭侧边栏后仍可继续。</small>
      </div>}
      {failed.length > 0 && <div className="warning-card"><AlertCircle size={17}/><div>{failed.length} 项分析失败<p>{failed[0]?.error}</p><button className="text-button" onClick={() => void run('retry', async () => { await rpc({ type: 'RETRY' }); })}>重试失败项</button></div></div>}
      {page === 'home' && <>
        <div className="section-heading"><h1>{query ? '搜索结果' : tag ? `标签 · ${tag}` : category !== null ? category || '未分类' : '最近收藏'}</h1><button className="text-button" onClick={() => nav('home')}>全部</button></div>
        {!ready && <div className="empty" role="status">正在读取 Chrome 书签…</div>}


        {configured && unclassified.length > 0 && !remaining.length && !drafts.length && !failed.length && <button className="suggestion-banner" disabled={!!busy} onClick={() => void run('analyze', async () => { await rpc({ type: 'ANALYZE' }); setNotice('已开始生成建议，完成后在「待确认」检查'); })}><Sparkles size={17}/><span>为未分类书签生成建议</span><ChevronRight size={16}/></button>}
        {groupBookmarksByDate(filtered).map(group => <section className="date-group" key={group.label}><h2>{group.label}</h2><div className="bookmark-list">{group.bookmarks.map(b => <BookmarkRow key={b.id} bookmark={b} onOpen={() => void run('open', async () => { await open(b); })} onDetails={() => details(b)}/>)}</div></section>)}
        {ready && !filtered.length && <div className="empty"><BookmarkIcon size={29}/><h3>{query ? '没有找到匹配的书签' : '这里还没有书签'}</h3><p>{query ? '换个标题、域名或分类试试。' : '打开网页，点击上方「收藏」。'}</p></div>}
      </>}
      {page === 'categories' && <>
        <div className="section-heading"><h1>我的分类</h1><button className="text-button" onClick={() => setPage('settings')}>编辑</button></div>
        <div className="category-list">{counts.map(([name, count]) => <button key={name} onClick={() => { filterCategory(name); setPage('home'); }}><Folder size={26} strokeWidth={1.5}/><strong>{name}</strong><span>{count}</span><ChevronRight size={16}/></button>)}</div>
        <div className="category-list category-secondary"><button onClick={() => { filterCategory(''); setPage('home'); }}><Folder size={26} strokeWidth={1.5}/><strong>未分类</strong><span>{bookmarks.filter(b => !b.category).length}</span><ChevronRight size={16}/></button><button className="new-category" onClick={() => setShowCategoryCreate(!showCategoryCreate)} aria-expanded={showCategoryCreate}><Plus size={26}/><strong>新建分类</strong></button></div>
        {showCategoryCreate && <form className="category-create" onSubmit={e => { e.preventDefault(); void createCategory(); }}><label>分类名称<input autoFocus value={newCategory} maxLength={24} onChange={e => setNewCategory(e.target.value)}/></label><div className="button-pair"><button type="button" className="button secondary" onClick={() => setShowCategoryCreate(false)}>取消</button><button className="button" disabled={!!busy || !newCategory.trim()}>创建</button></div></form>}
        <section className="category-tags"><h2>标签</h2><div className="tag-list">{tags.map(value => <button key={value} onClick={() => { filterTag(value); setPage('home'); }}>{value}</button>)}</div>{!tags.length && <p className="help">确认分类建议后，标签会显示在这里。</p>}</section>
      </>}
      {page === 'review' && <Review drafts={drafts} bookmarks={bookmarks} categories={settings.categories} busy={!!busy} working={remaining.length} run={run} notify={setNotice}/>}
      {page === 'settings' && <Suspense fallback={<div className="empty" role="status">正在加载设置…</div>}><SettingsForm value={settings} busy={!!busy} unclassifiedCount={unclassified.length} onSave={async (value, test) => {
        return run('settings', async () => {
          await setSettings(value); updateSettings(value);
          if (test) { await rpc({ type: 'TEST_MODEL' }); setNotice('模型连接正常，输出校验通过'); }
          else if (isConfigured(value) && unclassified.length) {
            await rpc({ type: 'ANALYZE' }); setNotice('已保存设置，开始生成未分类书签的建议');
          } else { setNotice('设置已保存'); }
        });
      }} onSaved={() => setPage('home')} notify={setNotice} onBackup={() => void run('backup', async () => {
        const { exportBackup } = await import('./backup');
        const blob = new Blob([JSON.stringify(await exportBackup(), null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `bookmark-sidekick-${new Date().toISOString().slice(0, 10)}.json`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000); setNotice('已导出模型配置、分类、书签数据与快照');
      })} onRestore={(input, permission) => run('restore', async () => {
        if (!await permission) throw new Error('未授权模型接口，未执行恢复');
        await rpc({ type: 'SYNC' });
        const { importBackup } = await import('./backup');
        const result = await importBackup(input);
        updateSettings(result.settings);
        setNotice(result.settingsRestored
          ? `已恢复 ${result.restored} 项，跳过 ${result.skipped} 项；模型配置和 ${result.categoryCount} 个分类已恢复`
          : `已恢复 ${result.restored} 项，跳过 ${result.skipped} 项；旧版备份已补回 ${result.categoryCount} 个分类`);
      })}/></Suspense>}
      {page === 'detail' && selected && <Detail key={selected.id} bookmark={selected} snapshot={snapshot} categories={settings.categories} busy={!!busy} configured={configured} run={run} notify={setNotice} onReader={() => setPage('reader')} onOpen={() => void run('open', () => open(selected))} onDeleted={() => setPage('home')}/>}
      {page === 'reader' && selected && snapshot && <Suspense fallback={<div className="empty" role="status">正在加载正文…</div>}><Reader bookmark={selected} snapshot={snapshot}/></Suspense>}
      {['detail', 'reader'].includes(page) && !selected && <div className="empty">该书签已被删除<button className="text-button" onClick={() => setPage('home')}>返回收藏</button></div>}
    </motion.main>
    {tabPages && <footer>{page === 'home' ? <><span>{bookmarks.length} 个书签</span><button className="icon-button" aria-label="刷新书签" disabled={!!busy} onClick={() => void run('sync', async () => { await rpc({ type: 'SYNC' }); setNotice('书签已刷新'); })}><RefreshCw size={19}/></button></> : page === 'categories' ? <><Folder size={18}/><span>{counts.length} 个分类</span></> : <span>{drafts.length > 1 ? `还有 ${drafts.length - 1} 条建议` : drafts.length ? '1 条建议待确认' : '所有建议已处理'}</span>}</footer>}
  </div>;
}

function BookmarkRow({ bookmark: b, onOpen, onDetails }: { bookmark: Bookmark; onOpen: () => void; onDetails: () => void }) {
  return <article className={`bookmark-row ${b.linkState === 'unavailable' ? 'is-unavailable' : ''}`}><button className="bookmark-main" onClick={onOpen} title={b.url}><SiteIcon url={b.url}/><span className="bookmark-copy"><strong>{b.title}</strong><span>{hostname(b.url)}</span>{b.linkState === 'unavailable' && <small className="danger-text">原网页可能已失效</small>}</span></button><span className="row-category">{b.category}</span><button className="icon-button item-menu" onClick={onDetails} aria-label={`查看 ${b.title} 的详情`}><MoreHorizontal size={18}/></button></article>;
}
