import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '../../src/App';
import './style.css';
import './restore.css';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() {
    if (this.state.failed) return <div style={{ padding: 24, fontFamily: 'system-ui' }}><h2>侧边栏暂时无法显示</h2><p>请重新打开侧边栏；若仍失败，在 Chrome 扩展管理页重新加载扩展。不要卸载，以免丢失本地快照。</p><button onClick={() => location.reload()}>重新加载</button></div>;
    return this.props.children;
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(<ErrorBoundary><App/></ErrorBoundary>);
