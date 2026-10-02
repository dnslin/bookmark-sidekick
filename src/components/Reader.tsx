import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { FileText } from 'lucide-react';
import { hostname, isWebUrl, type Bookmark, type Snapshot } from '../domain';

export default function Reader({ bookmark, snapshot }: { bookmark: Bookmark; snapshot: Snapshot }) {
  const safeHtml = useMemo(() => DOMPurify.sanitize(snapshot.html, {
    ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'strong', 'b', 'em', 'i', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'a'],
    ALLOWED_ATTR: ['href'],
  }), [snapshot.html]);
  return <article className="reader"><div className="reader-banner"><FileText size={15}/>这是保存的正文，不是实时网页</div><h1>{bookmark.title}</h1><div className="reader-meta">{hostname(snapshot.url)} · {new Date(snapshot.capturedAt).toLocaleString('zh-CN')}</div><div className="reader-content" dangerouslySetInnerHTML={{ __html: safeHtml }} onClick={e => {
    const anchor = (e.target as HTMLElement).closest('a');
    if (anchor) { e.preventDefault(); if (isWebUrl(anchor.href)) void chrome.tabs.create({ url: anchor.href }); }
  }}/></article>;
}
