type TextPart = { text: string; block?: unknown };
type TextMatch = { nodeIndex: number; start: number; end: number };

export function findReaderMatches(parts: TextPart[], terms: string[]): TextMatch[] {
  let text = '';
  const positions: (TextMatch | undefined)[] = [];
  for (const [nodeIndex, part] of parts.entries()) {
    if (nodeIndex > 0 && part.block !== parts[nodeIndex - 1]?.block && text && !text.endsWith(' ')) { text += ' '; positions.push(undefined); }
    let offset = 0;
    for (const character of part.text) {
      const normalized = /\s/u.test(character) ? ' ' : character.toLowerCase();
      if (!(normalized === ' ' && text.endsWith(' '))) {
        text += normalized;
        for (let i = 0; i < normalized.length; i++) positions.push({ nodeIndex, start: offset, end: offset + character.length });
      }
      offset += character.length;
    }
  }
  const matches: TextMatch[] = [];
  for (const term of new Set(terms.map(value => value.replace(/\s+/gu, ' ').trim().toLowerCase()).filter(Boolean))) {
    const index = text.indexOf(term);
    if (index < 0) continue;
    const perNode = new Map<number, TextMatch>();
    for (const position of positions.slice(index, index + term.length)) {
      if (!position) continue;
      const match = perNode.get(position.nodeIndex);
      if (match) match.end = position.end;
      else perNode.set(position.nodeIndex, { ...position });
    }
    matches.push(...perNode.values());
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
