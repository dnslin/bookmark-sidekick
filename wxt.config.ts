import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: '拾签 · Bookmark Sidekick',
    description: '在 Chrome 侧边栏收藏、搜索和整理书签。AI 先提建议，由你确认。',
    minimum_chrome_version: '120',
    permissions: ['bookmarks', 'storage', 'sidePanel', 'alarms', 'scripting', 'activeTab', 'tabs', 'unlimitedStorage'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    action: { default_title: '打开拾签' },
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'",
    },
  },
});
