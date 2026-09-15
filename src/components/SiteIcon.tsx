import { useState } from 'react';
import { hostname } from '../domain';

export function SiteIcon({ url, size = 'small' }: { url: string; size?: 'small' | 'large' }) {
  const [failedUrl, setFailedUrl] = useState('');
  const source = new URL(chrome.runtime.getURL('/_favicon/'));
  source.searchParams.set('pageUrl', url);
  source.searchParams.set('size', size === 'large' ? '64' : '32');
  return <span className={size === 'large' ? 'large-site-icon' : 'site-icon'} aria-hidden="true">
    {failedUrl === url || !url ? hostname(url).replace(/^www\./, '').slice(0, 1).toUpperCase()
      : <img src={source.href} alt="" onError={() => setFailedUrl(url)}/>}
  </span>;
}
