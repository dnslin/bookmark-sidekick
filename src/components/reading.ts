type TextPart = { text: string; block?: unknown };
type TextMatch = { nodeIndex: number; start: number; end: number };

function originalRange(text: string, start: number, end: number) {
  let offset = 0;
  let normalizedOffset = 0;
  let wasSpace = false;
  let from = -1;
  let to = 0;
  for (const character of text) {
    const space = /\s/u.test(character);
    if (!space || !wasSpace) {
      const length = space ? 1 : character.toLowerCase().length;
      if (normalizedOffset < end && normalizedOffset + length > start) {
        if (from < 0) from = offset;
        to = offset + character.length;
      }
      normalizedOffset += length;
    }
    offset += character.length;
    wasSpace = space;
    if (normalizedOffset >= end) break;
  }
  return { start: from, end: to };
}

export function findReaderMatches(parts: TextPart[], terms: string[]): TextMatch[] {
  const queries = [...new Set(terms.map(value => value.replace(/\s+/gu, ' ').trim().toLowerCase()).filter(Boolean))];
  if (!queries.length) return [];
  const chunks: string[] = [];
  const spans: { nodeIndex: number; start: number; end: number; skippedSpace: boolean }[] = [];
  let length = 0;
  let wasSpace = false;
  for (const [nodeIndex, part] of parts.entries()) {
    if (nodeIndex > 0 && part.block !== parts[nodeIndex - 1]?.block && length && !wasSpace) {
      chunks.push(' ');
      length++;
      wasSpace = true;
    }
    // Keep one string per node; only matched nodes need their original offsets scanned.
    let normalized = part.text.replace(/\s+/gu, ' ').replace(/./gsu, character => character.toLowerCase());
    const skippedSpace = wasSpace && normalized.startsWith(' ');
    if (skippedSpace) normalized = normalized.slice(1);
    spans.push({ nodeIndex, start: length, end: length + normalized.length, skippedSpace });
    chunks.push(normalized);
    length += normalized.length;
    if (normalized) wasSpace = normalized.endsWith(' ');
  }
  const text = chunks.join('');
  const matches: TextMatch[] = [];
  for (const term of queries) {
    const index = text.indexOf(term);
    if (index < 0) continue;
    const end = index + term.length;
    for (const span of spans) {
      if (span.start >= end) break;
      if (span.end <= index || span.start === span.end) continue;
      const skipped = span.skippedSpace ? 1 : 0;
      const range = originalRange(parts[span.nodeIndex]!.text, Math.max(index - span.start, 0) + skipped, Math.min(end, span.end) - span.start + skipped);
      matches.push({ nodeIndex: span.nodeIndex, ...range });
    }
  }
  const merged: TextMatch[] = [];
  for (const match of matches.sort((a, b) => a.nodeIndex - b.nodeIndex || a.start - b.start)) {
    const previous = merged.at(-1);
    if (previous?.nodeIndex === match.nodeIndex && match.start <= previous.end) previous.end = Math.max(previous.end, match.end);
    else merged.push({ ...match });
  }
  return merged;
}

export function highlightReaderMatches(content: HTMLElement, terms: string[]): HTMLElement | undefined {
  const document = content.ownerDocument;
  for (const mark of content.querySelectorAll('mark[data-reader-match]')) mark.replaceWith(document.createTextNode(mark.textContent || ''));
  if (!terms.length) return;
  content.normalize();
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const matches = findReaderMatches(nodes.map(node => ({ text: node.data, block: node.parentElement?.closest('p,h1,h2,h3,h4,li,blockquote,pre,td,th') })), terms);
  let first: HTMLElement | undefined;
  for (const match of matches.toReversed()) {
    const node = nodes[match.nodeIndex];
    if (!node) continue;
    const range = document.createRange();
    range.setStart(node, match.start);
    range.setEnd(node, match.end);
    const mark = document.createElement('mark');
    mark.dataset.readerMatch = '';
    range.surroundContents(mark);
    first = mark;
  }
  return first;
}

export function createProgressSaver(save: (progress: number) => Promise<boolean>, onError: (cause: unknown) => void, initial = 0) {
  let idle: ReturnType<typeof setTimeout> | undefined;
  let maximum: ReturnType<typeof setTimeout> | undefined;
  let pending: number | undefined;
  let latest = initial;
  let saved = initial;
  let queue = Promise.resolve();
  let closed = false;
  function clearTimers() { clearTimeout(idle); clearTimeout(maximum); idle = undefined; maximum = undefined; }
  function flush() {
    clearTimers();
    const progress = pending;
    pending = undefined;
    if (progress !== undefined) queue = queue.then(async () => {
      if (progress === saved) return;
      try { await save(progress); saved = progress; }
      catch (cause) { if (latest === progress && pending === undefined) pending = progress; onError(cause); }
    });
    return queue;
  }
  return {
    record(progress: number) {
      if (closed) return;
      latest = progress;
      pending = progress;
      clearTimeout(idle);
      idle = setTimeout(() => { void flush(); }, 500);
      maximum ??= setTimeout(() => { void flush(); }, 2000);
    },
    flush,
    reset(progress: number) { clearTimers(); pending = undefined; latest = progress; saved = progress; },
    dispose() { closed = true; return flush(); },
  };
}
