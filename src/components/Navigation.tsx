import { motion, useReducedMotion } from 'motion/react';

export type LibraryPage = 'home' | 'categories' | 'review';
const destinations: { page: LibraryPage; label: string }[] = [
  { page: 'home', label: '最近' },
  { page: 'categories', label: '分类' },
  { page: 'review', label: '待确认' },
];

export function Navigation({ page, pendingCount, onNavigate }: {
  page: LibraryPage;
  pendingCount: number;
  onNavigate: (page: LibraryPage) => void;
}) {
  const reducedMotion = useReducedMotion();
  return <nav className="tabs" aria-label="书签导航">
    {destinations.map(item => <button key={item.page}
      aria-current={page === item.page ? 'page' : undefined}
      className={page === item.page ? 'selected' : ''}
      onClick={() => onNavigate(item.page)}>
      {page === item.page && <motion.span className="tab-indicator" aria-hidden="true"
        layoutId="library-navigation" transition={reducedMotion ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.3 }}/>}
      <span className="navigation-label">{item.label}{item.page === 'review' && pendingCount > 0 && <span className="badge">{pendingCount}</span>}</span>
    </button>)}
  </nav>;
}
