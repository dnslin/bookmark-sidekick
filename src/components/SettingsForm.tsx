import { useRef, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Appearance } from './Appearance';
import { CategoryEditor } from './CategoryEditor';
import { clearSavedEdits } from './editor';
import { originPattern, settingsSchema, type Settings } from '../settings';
import type { BackupPreview } from '../backup';

type RestoreCandidate = { fileName: string; input: unknown; preview: BackupPreview };
export default function SettingsForm({ value, busy, unclassifiedCount, onSave, onSaved, notify, onBackup, onRestore }: { value: Settings; busy: boolean; unclassifiedCount: number; onSave: (s: Settings, test: boolean) => Promise<boolean>; onSaved: () => void; notify: (s: string) => void; onBackup: () => void; onRestore: (input: unknown, permission: Promise<boolean>) => Promise<boolean> }) {
  const [edits, setEdits] = useState<Partial<Settings>>({});
  const editVersion = useRef(0);
  const form = { ...value, ...edits };
  const [saving, setSaving] = useState(false);
  const [restoreCandidate, setRestoreCandidate] = useState<RestoreCandidate>();

  function edit(values: Partial<Settings>) {
    editVersion.current++;
    setEdits(current => ({ ...current, ...values }));
  }

  async function submit(test: boolean) {
    if (saving || busy) return;
    const submittedVersion = editVersion.current;
    const parsed = settingsSchema.safeParse({ ...form, baseUrl: form.baseUrl.trim().replace(/\/+$/, '') });
    if (!parsed.success) { notify(parsed.error.issues[0]?.message || '请检查设置'); return; }
    if (parsed.data.consent && (!parsed.data.baseUrl || !parsed.data.model)) { notify('请填写 API 地址和模型名称'); return; }
    if (test && !parsed.data.consent) { notify('请先勾选发送书签信息的授权'); return; }
    setSaving(true);
    try {
      if (parsed.data.consent && !await chrome.permissions.request({ origins: [originPattern(parsed.data.baseUrl)] })) { notify('未获得模型接口的访问权限，设置未保存'); return; }
      if (await onSave({ ...parsed.data, paused: false }, test)) {
        setEdits(current => clearSavedEdits(current, edits));
        if (!test && editVersion.current === submittedVersion) onSaved();
      }
    } catch { notify('保存失败，请检查模型地址和访问权限'); }
    finally { setSaving(false); }
  }

  async function chooseBackup(file: File) {
    if (file.size > 100 * 1024 * 1024) { notify('MVP 暂支持 100 MB 以内的备份文件'); return; }
    try {
      const input = JSON.parse(await file.text()) as unknown;
      const { inspectBackup } = await import('../backup');
      setRestoreCandidate({ fileName: file.name, input, preview: inspectBackup(input) });
    } catch {
      setRestoreCandidate(undefined);
      notify('备份文件无法读取或格式不正确');
    }
  }

  async function confirmRestore() {
    const candidate = restoreCandidate;
    if (!candidate || busy) return;
    const model = candidate.preview.model;
    const permission = model?.consent && model.baseUrl
      ? chrome.permissions.request({ origins: [originPattern(model.baseUrl)] })
      : Promise.resolve(true);
    if (await onRestore(candidate.input, permission)) {
      setEdits(current => clearSavedEdits(current, edits));
      setRestoreCandidate(undefined);
    }
  }

  return <div className="settings-form"><Appearance/><div className="divider"/><div className="page-heading"><h2>模型与数据</h2><p>使用你自己的 OpenAI-compatible 接口。不需要账号或服务器。</p></div>
    <label>API 地址<input type="url" placeholder="https://你的接口地址/v1" value={form.baseUrl} autoComplete="off" onChange={e => edit({ baseUrl: e.target.value })}/><small>填写接口基础地址，通常以 /v1 结尾，不要包含 /chat/completions。</small></label>
    <label>API Key<input type="password" placeholder="本地模型可留空" value={form.apiKey} autoComplete="off" spellCheck={false} onChange={e => edit({ apiKey: e.target.value })}/><small>保存在当前浏览器；导出完整备份时会以明文写入 JSON 文件。</small></label>
    <label>模型名称<input placeholder="填写接口提供的准确模型 ID" value={form.model} autoComplete="off" onChange={e => edit({ model: e.target.value })}/></label>
    <CategoryEditor categories={form.categories} onChange={categories => edit({ categories })}/>
    <label className="consent"><input type="checkbox" checked={form.consent} onChange={e => edit({ consent: e.target.checked })}/><span>允许向以上模型发送书签标题、网址、原文件夹，以及已保存的正文，用于分类和摘要。</span></label>
    {(saving || busy) && <div role="status"><progress className="analysis-progress" aria-label="正在保存设置或测试模型"/><p className="help">正在处理；模型响应超时后会自动重试，最多 3 次。</p></div>}
    <div className="button-pair"><button className="button secondary" disabled={saving || busy} onClick={() => void submit(true)}>测试连接</button><button className="button" disabled={saving || busy} onClick={() => void submit(false)}>{saving || busy ? '处理中…' : unclassifiedCount && form.consent ? '保存并分析' : '保存设置'}</button></div>
    <div className="divider"/><h3>完整备份</h3><p className="help">包含模型地址、API Key、自定义分类、书签分类/标签/摘要和阅读快照。恢复只匹配现有 Chrome 书签，不会新增、删除或移动原生书签。</p>
    <div className="button-pair"><button className="button secondary" onClick={onBackup} disabled={busy}>导出备份</button><label className="button secondary file-button">选择备份文件<input type="file" accept=".json,application/json" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void chooseBackup(file); e.target.value = ''; }}/></label></div>
    {restoreCandidate && <section className="restore-preview" aria-label="恢复预览">
      <div className="restore-preview-head"><div><strong>{restoreCandidate.fileName}</strong><span>{restoreCandidate.preview.exportedAt ? new Date(restoreCandidate.preview.exportedAt).toLocaleString('zh-CN') : `备份格式 v${restoreCandidate.preview.version}`}</span></div><button className="icon-button" aria-label="取消选择备份" onClick={() => setRestoreCandidate(undefined)}><X size={15}/></button></div>
      <div className="restore-preview-stats"><span><strong>{restoreCandidate.preview.entryCount}</strong>书签</span><span><strong>{restoreCandidate.preview.snapshotCount}</strong>快照</span><span><strong>{restoreCandidate.preview.categories.length}</strong>分类</span></div>
      {restoreCandidate.preview.model
        ? <p>模型：{restoreCandidate.preview.model.model || '未配置'} · {restoreCandidate.preview.model.hasApiKey ? '包含 API Key' : 'API Key 为空'}</p>
        : <p>旧版备份不含模型配置；将保留当前模型配置，并从书签数据补回分类。</p>}
      <p className="restore-warning">{restoreCandidate.preview.model ? '确认后将覆盖当前模型配置、自定义分类，以及匹配书签的分类与快照。' : '确认后将覆盖匹配书签的分类与快照；当前模型配置不会改变。'}</p>
      <div className="button-pair"><button className="button secondary" disabled={busy} onClick={() => setRestoreCandidate(undefined)}>取消</button><button className="button" disabled={busy} onClick={() => void confirmRestore()}>{busy ? '恢复中…' : '确认恢复'}</button></div>
    </section>}
    <p className="privacy-note"><AlertCircle size={15}/>备份文件包含明文 API Key，请只保存在可信位置。扩展卸载后，本地分类和快照仍会被清除。</p>
  </div>;
}
