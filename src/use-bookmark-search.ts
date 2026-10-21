import { useCallback, useEffect, useState } from 'react';
import type { Bookmark } from './domain';
import { BookmarkSearchClient } from './search-client';

export function useBookmarkSearch(bookmarks: Bookmark[], query: string) {
  const [client] = useState(() => new BookmarkSearchClient(() => new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' })));
  const [state, setState] = useState(() => client.getState());
  useEffect(() => {
    const unsubscribe = client.subscribe(setState);
    return () => { unsubscribe(); client.dispose(); };
  }, [client]);
  useEffect(() => { client.search(bookmarks, query); }, [client, bookmarks, query]);
  const retry = useCallback(() => client.retry(), [client]);
  return { ...state, retry };
}
