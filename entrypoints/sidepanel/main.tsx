import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '../../src/App';
import './style.css';

let selectedBookmarkUrl = '';

function faviconUrl(pageUrl: string, size: number): string {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', String(size));
  return url.toString();
}

function applyFavicon(holder: HTMLElement, pageUrl: string, requestedSize: number, displayedSize: number): void {
  if (!pageUrl || holder.dataset.faviconUrl === pageUrl) return;

  holder.dataset.faviconUrl = pageUrl;
  const fallback = holder.dataset.faviconFallback || holder.textContent?.trim() || '?';
  holder.dataset.faviconFallback = fallback;

  const image = new Image();
  image.alt = '';
  image.decoding = 'async';
  image.loading = 'lazy';
  image.draggable = false;
  image.setAttribute('aria-hidden', 'true');
  image.style.width = `${displayedSize}px`;
  image.style.height = `${displayedSize}px`;
  image.style.objectFit = 'contain';
  image.style.borderRadius = '3px';

  image.addEventListener('load', () => {
    if (holder.dataset.faviconUrl === pageUrl) holder.replaceChildren(image);
  }, { once: true });

  image.addEventListener('error', () => {
    if (holder.dataset.faviconUrl === pageUrl) holder.textContent = fallback;
  }, { once: true });

  image.src = faviconUrl(pageUrl, requestedSize);
}

function hydrateFavicons(): void {
  document.querySelectorAll<HTMLElement>('.bookmark-main[title] .site-icon').forEach(holder => {
    const pageUrl = holder.closest<HTMLElement>('.bookmark-main')?.getAttribute('title') || '';
    applyFavicon(holder, pageUrl, 32, 21);
  });

  const detailIcon = document.querySelector<HTMLElement>('.detail-hero .large-site-icon');
  if (!detailIcon) return;

  const displayedHost = detailIcon.parentElement?.querySelector<HTMLParagraphElement>('p')?.textContent?.trim();
  const pageUrl = selectedBookmarkUrl || (displayedHost ? `https://${displayedHost}` : '');
  applyFavicon(detailIcon, pageUrl, 64, 32);
}

function FaviconHydrator() {
  React.useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;

    const rememberSelection = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const row = event.target.closest<HTMLElement>('.bookmark-row');
      const pageUrl = row?.querySelector<HTMLElement>('.bookmark-main')?.getAttribute('title');
      if (pageUrl) selectedBookmarkUrl = pageUrl;
    };

    root.addEventListener('click', rememberSelection, true);
    const observer = new MutationObserver(hydrateFavicons);
    observer.observe(root, { childList: true, subtree: true });
    hydrateFavicons();

    return () => {
      root.removeEventListener('click', rememberSelection, true);
      observer.disconnect();
    };
  }, []);

  return null;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() {
    if (this.state.failed) return <div style={{ padding: 24, fontFamily: 'system-ui' }}><h2>侧边栏暂时无法显示</h2><p>请重新打开侧边栏；若仍失败，在 Chrome 扩展管理页重新加载扩展。不要卸载，以免丢失本地快照。</p><button onClick={() => location.reload()}>重新加载</button></div>;
    return this.props.children;
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(<ErrorBoundary><><App/><FaviconHydrator/></></ErrorBoundary>);
