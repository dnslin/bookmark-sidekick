import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { BookOpen, Check, FileText } from 'lucide-react';
import { hostname, isWebUrl, type Bookmark, type Snapshot } from '../domain';
import { rpc } from '../messages';
import { createProgressSaver, highlightReaderMatches } from './reading';

type ReaderProps = {
  bookmark: Bookmark;
  snapshot: Snapshot;
  matchTerms?: string[];
  busy: boolean;
  run: (label: string, operation: () => Promise<void>) => Promise<boolean>;
  notify: (message: string) => void;
};

export default function Reader({ bookmark, snapshot, matchTerms = [], busy, run, notify }: ReaderProps) {
  const scroll = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const writer = useRef<ReturnType<typeof createProgressSaver> | null>(null);
  const ready = useRef(false);
  const changing = useRef(false);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const [progress, setProgress] = useState(snapshot.progress);
  const [progressError, setProgressError] = useState('');
  const safeHtml = useMemo(() => DOMPurify.sanitize(snapshot.html, {
    ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'strong', 'b', 'em', 'i', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'a'],
    ALLOWED_ATTR: ['href'],
  }), [snapshot.html]);
  const markup = useMemo(() => ({ __html: safeHtml }), [safeHtml]);
  const termsKey = matchTerms.join('\u0000');
  useEffect(() => {
    ready.current = false;
    const saver = createProgressSaver(async value => {
      const saved = await rpc<boolean>({ type: 'SAVE_PROGRESS', id: snapshot.bookmarkId, capturedAt: snapshot.capturedAt, progress: value });
      if (saved) setProgressError('');
      return saved;
    }, cause => {
      const message = cause instanceof Error ? cause.message : '阅读位置保存失败';
      setProgressError(message);
      notifyRef.current(message);
    }, snapshot.progress);
    writer.current = saver;
    const frame = requestAnimationFrame(() => {
      const element = scroll.current;
      if (!element || !content.current) return;
      const mark = highlightReaderMatches(content.current, matchTerms);
      if (matchTerms.length) {
        if (mark) element.scrollTop = Math.max(0, element.scrollTop + mark.getBoundingClientRect().top - element.getBoundingClientRect().top - 40);
        else { element.scrollTop = 0; notifyRef.current('已打开快照，未能定位命中段落'); }
      } else element.scrollTop = snapshot.progress * Math.max(0, element.scrollHeight - element.clientHeight);
      const maximum = element.scrollHeight - element.clientHeight;
      setProgress(maximum > 0 ? element.scrollTop / maximum : 0);
      ready.current = true;
    });
    const hide = () => { if (document.visibilityState === 'hidden') void saver.flush(); };
    const leave = () => { void saver.flush(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
      void saver.dispose();
      if (writer.current === saver) writer.current = null;
    };
    // Progress updates are deliberately excluded: persisting a scroll must not restore it again.
  }, [snapshot.bookmarkId, snapshot.capturedAt, safeHtml, termsKey]);

  async function finish() {
    if (busy || changing.current) return;
    changing.current = true;
    const reread = bookmark.readingState === 'read';
    try {
      await writer.current?.flush();
      if (await run('reading', async () => {
        await rpc({ type: 'SET_READING', id: bookmark.id, state: reread ? 'later' : 'read' });
        if (reread) {
          if (scroll.current) scroll.current.scrollTop = 0;
          setProgress(0);
          writer.current?.reset(0);
          await rpc({ type: 'SET_READING', id: bookmark.id, state: 'reading' });
        }
      })) {
        notify(reread ? '已开始重新阅读' : '已标记为已读，书签仍保留在全部收藏中');
      }
    } finally { changing.current = false; }
  }

  return <><main className="reader-main" ref={scroll} onScroll={event => {
    if (!ready.current || changing.current) return;
    const element = event.currentTarget;
    const maximum = element.scrollHeight - element.clientHeight;
    const value = maximum > 0 ? Math.min(1, Math.max(0, element.scrollTop / maximum)) : 0;
    setProgress(value);
    writer.current?.record(value);
  }}><article className="reader"><div className="reader-banner"><FileText size={15}/>这是保存的正文，不是实时网页</div><div className="reading-status"><BookOpen size={15}/>{({ none: '正文快照', later: '待读', reading: '阅读中', read: '已读' })[bookmark.readingState]}</div><h1>{bookmark.title}</h1><div className="reader-meta">{hostname(snapshot.url)} · {new Date(snapshot.capturedAt).toLocaleString('zh-CN')}</div><div ref={content} className="reader-content" dangerouslySetInnerHTML={markup} onClick={e => {
    const anchor = (e.target as HTMLElement).closest('a');
    if (anchor) { e.preventDefault(); if (isWebUrl(anchor.href)) void chrome.tabs.create({ url: anchor.href }); }
  }}/></article></main><footer className="reader-footer"><span>阅读位置 {Math.round(progress * 100)}%</span><button className="text-button" type="button" disabled={busy} onClick={() => void finish()}>{bookmark.readingState === 'read' ? '重新阅读' : '标记已读'}<Check size={15}/></button>{progressError && <p className="field-error" role="alert">{progressError}</p>}</footer></>;
}
