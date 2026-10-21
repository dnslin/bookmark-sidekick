import { Fragment } from 'react';

export function HighlightedText({ text, ranges }: { text: string; ranges: [number, number][] }) {
  let cursor = 0;
  return <>{ranges.map(([start, end]) => {
    const prefix = text.slice(cursor, start);
    cursor = end;
    return <Fragment key={`${start}:${end}`}>{prefix}<mark>{text.slice(start, end)}</mark></Fragment>;
  })}{text.slice(cursor)}</>;
}
