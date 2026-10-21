import { sameSearchBookmarks, toSearchBookmarks } from './search';
import type { SearchBookmark, SearchHit, SearchRequest, SearchResponse } from './search';

export interface BookmarkSearchState {
  hits: SearchHit[];
  terms: string[];
  snapshotCount: number;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string;
}

export class BookmarkSearchClient {
  private worker?: Worker;
  private timer?: ReturnType<typeof setTimeout>;
  private requestId = 0;
  private query = '';
  private bookmarks: SearchBookmark[] = [];
  private listeners = new Set<(state: BookmarkSearchState) => void>();
  private state: BookmarkSearchState = { hits: [], terms: [], snapshotCount: 0, status: 'idle', error: '' };

  constructor(private createWorker: () => Worker) {}

  getState() { return this.state; }

  subscribe(listener: (state: BookmarkSearchState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }

  search(bookmarks: SearchBookmark[], query: string) {
    const text = query.trim();
    if (text === this.query && sameSearchBookmarks(this.bookmarks, bookmarks)) return;
    this.query = text;
    this.bookmarks = toSearchBookmarks(bookmarks);
    this.requestId++;
    clearTimeout(this.timer);
    if (!text) {
      this.update({ hits: [], terms: [], status: 'idle', error: '' });
      this.worker?.postMessage({ id: this.requestId, query: '', bookmarks: [] } satisfies SearchRequest);
      return;
    }
    this.schedule();
  }

  retry() {
    if (!this.query) return;
    this.worker?.terminate();
    this.worker = undefined;
    this.requestId++;
    clearTimeout(this.timer);
    this.update({ snapshotCount: 0 });
    this.schedule();
  }

  dispose() {
    clearTimeout(this.timer);
    this.worker?.terminate();
    this.worker = undefined;
    this.requestId++;
    this.query = '';
    this.bookmarks = [];
    this.listeners.clear();
    this.state = { hits: [], terms: [], snapshotCount: 0, status: 'idle', error: '' };
  }

  private update(value: Partial<BookmarkSearchState>) {
    this.state = { ...this.state, ...value };
    this.listeners.forEach(listener => listener(this.state));
  }

  private schedule() {
    this.update({ hits: [], terms: [], status: 'loading', error: '' });
    const id = this.requestId;
    this.timer = setTimeout(() => {
      try {
        if (!this.worker) {
          const worker = this.createWorker();
          this.worker = worker;
          worker.onmessage = (event: MessageEvent<SearchResponse>) => {
            const response = event.data;
            if (this.worker !== worker || response.id !== this.requestId || !this.query) return;
            if (response.type === 'result') this.update({ hits: response.hits, terms: response.terms, snapshotCount: response.snapshotCount, status: 'ready', error: '' });
            else if (response.type === 'loading') this.update({ hits: [], status: 'loading', error: '' });
            else this.update({ hits: [], status: 'error', error: response.error });
          };
          worker.onerror = event => {
            if (this.worker !== worker) return;
            worker.terminate();
            this.worker = undefined;
            if (this.query) this.update({ hits: [], status: 'error', error: `正文搜索线程失败：${event.message || '无法加载搜索程序'}` });
          };
        }
        const request: SearchRequest = { id, query: this.query, bookmarks: this.bookmarks };
        this.worker.postMessage(request);
      } catch (error) {
        this.update({ hits: [], status: 'error', error: `正文搜索无法启动：${error instanceof Error ? error.message : String(error)}` });
      }
    }, 150);
  }
}
