import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';

export default defineUnlistedScript(() => {
  const guard = '__bookmarkSidekickExtractor' as const;
  const global = globalThis as typeof globalThis & { [guard]?: boolean };
  if (global[guard]) return;
  global[guard] = true;
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type !== 'EXTRACT_CURRENT_PAGE') return;
    try {
      const article = new Readability(document.cloneNode(true) as Document, { maxElemsToParse: 50_000 }).parse();
      if (!article?.content || !article.textContent?.trim()) {
        reply({ ok: false, error: '此页面没有可提取的正文，仅保存书签' });
        return;
      }
      // MVP keeps readable text structure, not a full page clone; images are intentionally excluded.
      const html = DOMPurify.sanitize(article.content, {
        ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'strong', 'b', 'em', 'i', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'a'],
        ALLOWED_ATTR: ['href'],
      }).slice(0, 1_000_000);
      reply({ ok: true, url: location.href, title: article.title || document.title,
        html, text: article.textContent.slice(0, 500_000) });
    } catch {
      reply({ ok: false, error: '正文提取失败，书签仍可保存' });
    }
  });
});
