import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, Bookmark as BookmarkIcon, CheckCircle2, Clock3, FileSearch, FileText, MoreHorizontal, RefreshCw } from 'lucide-react';
import type { Bookmark } from '../domain';
import { hostname } from '../domain';
import { groupBookmarksByDate, groupBookmarksForReading, type LibraryScope, type ReadingFilter } from '../library';
import type { SearchHit } from '../search';
import { SiteIcon } from './SiteIcon';
import { BulkEditor } from './BulkEditor';
import { HighlightedText } from './HighlightedText';

interface LibraryPanelProps {
  bookmarks: Bookmark[];
  totalCount: number;
  pendingCount: number;
  readCount: number;
  query: string;
  category: string | null;
  tag: string;
  scope: LibraryScope;
  readingFilter: ReadingFilter;
  categories: string[];
  availableTags: string[];
  busy: boolean;
  ready: boolean;
  searchState: { hits: SearchHit[]; terms: string[]; snapshotCount: number; status: 'idle' | 'loading' | 'ready' | 'error'; error: string; retry: () => void };
  run: (label: string, action: () => Promise<void>) => Promise<boolean>;
  notify: (message: string) => void;
  onScopeChange: (scope: LibraryScope) => void;
  onReadingFilterChange: (filter: ReadingFilter) => void;
  onShowAll: () => void;
  onOpen: (bookmark: Bookmark) => void;
  onDetails: (bookmark: Bookmark) => void;
  onReadingMenu: (bookmark: Bookmark) => void;
  onReadMatch: (bookmark: Bookmark, terms: string[]) => void;
  onRefresh: () => void;
  children?: ReactNode;
}

export function LibraryPanel(props: LibraryPanelProps) {
  const { bookmarks, query, category, tag, scope, readingFilter, busy, ready, searchState } = props;
  const reducedMotion = useReducedMotion();
  const [organizing, setOrganizing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [showBulk, setShowBulk] = useState(false);
  const searching = !!query.trim();
  const searchPending = searching && searchState.status !== 'ready';
  const hits = useMemo(() => new Map(searchState.hits.map(hit => [hit.bookmarkId, hit])), [searchState.hits]);
  const groups = scope === 'later' ? groupBookmarksForReading(bookmarks) : groupBookmarksByDate(bookmarks);
  const title = searching ? '搜索结果' : tag ? `标签 · ${tag}` : category !== null ? category || '未分类' : scope === 'later' ? '稍后读' : '最近收藏';
  const allSelected = bookmarks.length > 0 && bookmarks.every(bookmark => selectedIds.has(bookmark.id));

  useEffect(() => {
    setOrganizing(false);
    setSelectedIds(new Set());
    setShowBulk(false);
  }, [query, category, tag, scope, readingFilter]);

  function toggle(id: string) {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function finish() { setOrganizing(false); setSelectedIds(new Set()); setShowBulk(false); }
  function row(bookmark: Bookmark) {
    return <BookmarkRow key={bookmark.id} bookmark={bookmark} selected={selectedIds.has(bookmark.id)} organizing={organizing} busy={busy}
      onSelect={() => toggle(bookmark.id)} onOpen={() => props.onOpen(bookmark)} onDetails={() => props.onDetails(bookmark)} onReadingMenu={() => props.onReadingMenu(bookmark)}/>;
  }

  return <>
    <motion.main className="page-stage library-main" initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
      {props.children}
      <div className="library-scopes" aria-label="收藏范围">
        <button className="scope-button" aria-pressed={scope === 'all'} onClick={() => props.onScopeChange('all')}>全部</button>
        <button className="scope-button" aria-pressed={scope === 'later'} onClick={() => props.onScopeChange('later')}>稍后读 {props.pendingCount}</button>
        {(category !== null || tag) && <button className="text-button clear-filter" onClick={props.onShowAll}>清除筛选</button>}
      </div>
      <div className="section-heading"><h1>{title}{searching && searchState.status === 'ready' && <small className="result-count">{bookmarks.length} 项</small>}</h1><button className="text-button" disabled={busy || !ready || searchPending} onClick={() => { if (organizing) finish(); else setOrganizing(true); }}>{organizing ? '取消整理' : '整理'}</button></div>
      {scope === 'later' && <div className="reading-filters" aria-label="阅读状态">
        <button className="scope-button" aria-pressed={readingFilter === 'pending'} onClick={() => props.onReadingFilterChange('pending')}>待阅读 {props.pendingCount}</button>
        <button className="scope-button" aria-pressed={readingFilter === 'read'} onClick={() => props.onReadingFilterChange('read')}>已读 {props.readCount}</button>
      </div>}
      {searching && searchState.status === 'ready' && <p className="search-coverage" role="status"><FileSearch size={14}/>已搜索标题、标签与 {searchState.snapshotCount} 份正文</p>}
      {!ready ? <div className="empty" role="status">正在读取 Chrome 书签…</div>
        : searching && searchState.status === 'error' ? <div className="warning-card" role="alert"><FileSearch size={18}/><div>搜索未完成<p>{searchState.error}</p><button className="text-button" onClick={searchState.retry}>重试搜索</button></div></div>
        : searchPending ? <div className="empty" role="status"><FileSearch size={28}/><p>正在搜索书签与正文…</p></div>
        : <>
          {organizing && <label className="select-current"><input type="checkbox" aria-label="选择当前结果" checked={allSelected} disabled={busy || !bookmarks.length} onChange={() => setSelectedIds(allSelected ? new Set() : new Set(bookmarks.map(bookmark => bookmark.id)))}/>选择当前结果<span>{bookmarks.length} 项</span></label>}
          {searching ? bookmarks.map(bookmark => {
            const hit = hits.get(bookmark.id);
            return <article className="search-result" key={bookmark.id}>
              {row(bookmark)}
              {!!bookmark.tags.length && <div className="search-tags">{bookmark.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
              {hit?.snippet && <button className="match-snippet" disabled={busy} onClick={() => organizing ? toggle(bookmark.id) : props.onReadMatch(bookmark, searchState.terms)} aria-label={`在快照中查看 ${bookmark.title} 的正文命中`}>
                <span className="match-label"><FileText size={14}/>正文命中<ArrowUpRight size={13}/></span><HighlightedText text={hit.snippet.text} ranges={hit.snippet.ranges}/>
              </button>}
            </article>;
          }) : groups.map(group => <section className="date-group" key={group.label}><h2>{group.label}</h2><div className="bookmark-list">{group.bookmarks.map(row)}</div></section>)}
          {!bookmarks.length && <div className="empty"><BookmarkIcon size={29}/><h3>{searching ? '没有找到匹配的书签' : scope === 'later' ? readingFilter === 'read' ? '还没有已读内容' : '这里还没有待读内容' : '这里还没有书签'}</h3><p>{searching ? '换个标题、正文关键词或域名试试。' : scope === 'later' ? '点击书签旁的时钟，安排稍后阅读。' : '打开网页，点击上方「收藏」。'}</p></div>}
        </>}
    </motion.main>
    <footer className={organizing ? 'library-footer is-organizing' : 'library-footer'}>
      {organizing ? <><span>已选择 <strong>{selectedIds.size}</strong> 项</span><button className="button" disabled={busy || !selectedIds.size} onClick={() => setShowBulk(true)}>批量修改</button></>
        : <><span>{props.totalCount} 个书签</span><button className="icon-button" aria-label="刷新书签" disabled={busy} onClick={props.onRefresh}><RefreshCw size={19}/></button></>}
    </footer>
    {showBulk && <BulkEditor ids={[...selectedIds]} categories={props.categories} availableTags={props.availableTags} busy={busy} run={props.run} notify={props.notify} onClose={() => setShowBulk(false)} onApplied={finish}/>}
  </>;
}

export function BookmarkRow({ bookmark: b, selected, organizing, busy, onOpen, onSelect, onDetails, onReadingMenu }: {
  bookmark: Bookmark; selected: boolean; organizing: boolean; busy: boolean; onOpen: () => void; onSelect: () => void; onDetails: () => void; onReadingMenu: () => void;
}) {
  const readingLabel = { none: '', later: '待读', reading: '阅读中', read: '已读' }[b.readingState];
  return <article className={`bookmark-row ${selected ? 'is-selected' : ''} ${b.linkState === 'unavailable' ? 'is-unavailable' : ''}`}>
    {organizing && <input className="row-check" type="checkbox" aria-label={`选择 ${b.title}`} checked={selected} disabled={busy} onChange={onSelect}/>}
    <button className="bookmark-main" onClick={organizing ? onSelect : onOpen} disabled={busy} title={b.url}>
      <SiteIcon url={b.url}/><span className="bookmark-copy"><strong>{b.title}</strong><span>{hostname(b.url)}</span>{readingLabel && <small className="reading-hint">{readingLabel}</small>}{b.linkState === 'unavailable' && <small className="danger-text">原网页可能已失效</small>}</span>
    </button>
    <span className="row-category" title={b.category}>{b.category}</span>
    {!organizing && <>
      <button className={`icon-button reading-action ${b.readingState !== 'none' ? 'is-active' : ''}`} aria-label={`${b.title} 的阅读安排`} disabled={busy} onClick={onReadingMenu}>{b.readingState === 'read' ? <CheckCircle2 size={16}/> : <Clock3 size={16}/>}</button>
      <button className="icon-button item-menu" aria-label={`查看 ${b.title} 的详情`} onClick={onDetails}><MoreHorizontal size={18}/></button>
    </>}
  </article>;
}
