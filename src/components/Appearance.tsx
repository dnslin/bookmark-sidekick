import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { applyTheme, readThemePreference, resolveTheme, THEME_KEY, type ThemePreference } from '../theme';

export function useTheme() {
  useEffect(() => {
    applyTheme();
    const timer = window.setInterval(applyTheme, 1000);
    window.addEventListener('storage', applyTheme);
    document.addEventListener('visibilitychange', applyTheme);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('storage', applyTheme);
      document.removeEventListener('visibilitychange', applyTheme);
    };
  }, []);
}

export function Appearance() {
  const [preference, setPreference] = useState(readThemePreference);
  const [theme, setTheme] = useState(() => resolveTheme(readThemePreference()));
  useEffect(() => {
    const sync = () => {
      const next = readThemePreference();
      setPreference(next);
      setTheme(resolveTheme(next));
    };
    const timer = window.setInterval(sync, 1000);
    window.addEventListener('storage', sync);
    return () => { window.clearInterval(timer); window.removeEventListener('storage', sync); };
  }, []);

  function change(next: ThemePreference) {
    localStorage.setItem(THEME_KEY, next);
    setPreference(next);
    setTheme(resolveTheme(next));
    applyTheme();
  }
  const action = theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式';
  return <section className="appearance" aria-labelledby="appearance-heading">
    <div className="row-between">
      <h3 id="appearance-heading">外观</h3>
      <button type="button" className="icon-button theme-toggle" aria-label={action} title={action} onClick={() => change(theme === 'dark' ? 'light' : 'dark')}>
        {theme === 'dark' ? <Sun size={20}/> : <Moon size={20}/>}
      </button>
    </div>
    <label className="theme-auto"><input type="checkbox" checked={preference === 'auto'} onChange={event => change(event.target.checked ? 'auto' : theme)}/>按当地时间自动切换</label>
    <p className="help">7:00–19:00 为亮色，其余时间为暗色。</p>
  </section>;
}
