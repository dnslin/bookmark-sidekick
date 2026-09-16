export type ThemePreference = 'auto' | 'light' | 'dark';
export const THEME_KEY = 'bookmark-sidekick-theme';

export function resolveTheme(preference: ThemePreference, date = new Date()): 'light' | 'dark' {
  if (preference !== 'auto') return preference;
  return date.getHours() >= 7 && date.getHours() < 19 ? 'light' : 'dark';
}

export function readThemePreference(): ThemePreference {
  const value = localStorage.getItem(THEME_KEY);
  return value === 'light' || value === 'dark' ? value : 'auto';
}

export function applyTheme() {
  document.documentElement.dataset.theme = resolveTheme(readThemePreference());
}
