import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import '../../entrypoints/sidepanel/select.css';

type CategorySelectProps = {
  label: string;
  value: string;
  categories: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function CategorySelect({ label, value, categories, onChange, disabled = false }: CategorySelectProps) {
  const options = [...new Set([...categories, ...(value ? [value] : [])])];
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 280 });
  const expanded = open && !disabled;

  function show() {
    setActive(Math.max(0, options.indexOf(value)));
    setOpen(true);
  }

  useLayoutEffect(() => {
    if (!expanded || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const height = Math.min(280, Math.max(80, Math.max(below, above)));
    if (menu.current) menu.current.style.width = `${Math.min(rect.width, window.innerWidth - 16)}px`;
    const contentHeight = menu.current?.scrollHeight ?? options.length * 40 + 12;
    const upwards = below < Math.min(280, contentHeight) && above > below;
    setPosition({
      top: upwards ? Math.max(8, rect.top - 6 - Math.min(height, contentHeight)) : rect.bottom + 6,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
      width: Math.min(rect.width, window.innerWidth - 16),
      maxHeight: height,
    });
  }, [expanded, options.length]);

  useEffect(() => {
    if (!expanded) return;
    const close = (event: Event) => {
      if (event.target instanceof Node && (trigger.current?.contains(event.target) || menu.current?.contains(event.target))) return;
      setOpen(false);
    };
    const resize = () => setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', resize);
    };
  }, [expanded]);

  useEffect(() => {
    if (expanded) menu.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, expanded]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  function select(index: number) {
    if (options[index] !== undefined) onChange(options[index]);
    setOpen(false);
    trigger.current?.focus();
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!expanded) show();
      if (event.key === 'Home') setActive(0);
      else if (event.key === 'End') setActive(options.length - 1);
      else if (expanded) setActive(index => Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if ((event.key === 'Enter' || event.key === ' ') && expanded) {
      event.preventDefault();
      select(active);
    } else if (event.key === 'Tab') setOpen(false);
  }

  return <div className="category-select">
    <button ref={trigger} type="button" className="category-select-trigger" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? id : undefined} aria-activedescendant={expanded ? `${id}-${active}` : undefined} disabled={disabled || options.length === 0} onClick={() => expanded ? setOpen(false) : show()} onKeyDown={handleKey} onBlur={() => setOpen(false)}>
      <span>{value || '选择分类'}</span><ChevronDown size={16}/>
    </button>
    {expanded && createPortal(<div ref={menu} id={id} className="category-select-menu" role="listbox" aria-label={label} style={position} onMouseDown={event => event.preventDefault()}>
      {options.map((option, index) => <div key={option} id={`${id}-${index}`} role="option" aria-selected={option === value} className={`category-select-option${index === active ? ' is-active' : ''}`} onPointerMove={() => setActive(index)} onClick={() => select(index)}><span>{option}</span>{option === value && <Check size={16}/>}</div>)}
    </div>, document.body)}
  </div>;
}
