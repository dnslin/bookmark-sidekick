# 拾签 · Bookmark Sidekick

个人使用的 Chrome 侧边栏书签助手。先生成 AI 分类建议，再由用户确认；不移动 Chrome 原有文件夹。

> 本压缩包是完整项目源码，新版界面与轻量动画已经直接写入项目，不需要再应用补丁或执行改造脚本。

> **交付状态：MVP 源码，尚未完成完整构建与 Chrome 实机验证。**
> 当前生成环境无法解析 `registry.npmjs.org`，因此没有安装 npm 依赖、生成 lockfile 或打包安装版。
> 已运行 30 项无外部依赖的核心测试、12 个 TS/TSX 文件的语法检查及核心模块严格类型检查。详见 [验证记录](docs/VALIDATION.md)。
> GitHub 仓库尚未创建；当前连接没有创建仓库操作。下方提供本地创建私有仓库并推送的脚本。

## 第一版包含什么

- 点击扩展图标打开 Chrome Side Panel；没有 Popup、后台网站或新标签页替换。
- 自动读取并同步现有 Chrome 书签；搜索标题、网址、分类、标签、摘要。
- 配置自己的 OpenAI-compatible 模型地址、API Key 和模型名称。
- 首次配置并授权后，为未分类书签分批生成建议；建议在独立表中保存。
- 在「待确认」按类别筛选、修改建议分类，确认后只应用当前列表中的建议。
- 通过扩展收藏当前页时，较确定的分类自动应用；不确定结果进入「待确认」。
- 基于当前浏览器中的已加载网页提取正文，保存精简阅读 HTML 和纯文本。
- 按需检查链接；404/410 标记为可能失效，401/403/429 与网络错误不误判为失效。
- 有快照且上次检查为失效时，点击书签优先打开本地阅读快照。
- 修改标题、手动分类、删除书签、导出与恢复分类/快照备份。
- 中文界面、紧凑列表、系统深色模式。

## 运行

需要 Node.js 22.16+、npm，以及能够安装 npm 依赖的网络环境。仅以 Chrome 为目标。

```bash
npm install
npm run typecheck
npm test
npm run build
```

构建成功后：

1. 在 Chrome 打开 `chrome://extensions`。
2. 开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择本项目的 `.output/chrome-mv3`。
4. 固定工具栏中的「拾签」，点击图标打开侧边栏。
5. 进入设置，填模型地址、API Key、模型名称，勾选数据发送授权。
6. 可以先「测试连接」，再「保存并分析」。
7. 前往「待确认」检查建议，点击「确认并应用」。

开发模式：`npm run dev`。压缩构建：`npm run zip`。

首次 `npm install` 成功后应提交 `package-lock.json`，然后将 CI 的 `npm install` 改为 `npm ci`。此源码包没有虚构 lockfile。

## 创建 GitHub 私有仓库

脚本会检查你本机 `gh` 登录账号是否为 `dnslin`；其他账号会停止，避免误建到别的账号。

macOS 可以先安装并登录 GitHub CLI：

```bash
brew install gh
gh auth login --hostname github.com --scopes workflow
```

`workflow` 权限用于推送随附的 GitHub Actions 检查配置。在项目目录执行：

```bash
bash scripts/create-repo.sh
```

脚本默认创建私有仓库 `bookmark-sidekick` 并推送当前源码。也可以指定名称：

```bash
bash scripts/create-repo.sh my-bookmark-tool
```

仓库已存在或目录已有 `origin` 时，脚本停止，不会覆盖仓库或替换远程地址。没有自动设置 Git 作者信息，也不会把 API Key 写入项目文件。执行脚本前可以先运行 `npm run check`。

## 数据与确认规则

原始标题、URL 和文件夹以 Chrome 为准；IndexedDB 只保存镜像、增强数据与任务进度。

```text
Chrome 原生书签
  ↓ 自动读取
本地书签镜像
  ↓ 模型分析
分类建议 drafts（尚未应用）
  ↓ 用户点击确认
正式分类 category / tags / summary
```

初次导入及主动重新分析都使用 `draft` 模式。只有通过扩展主动收藏的新书签采用 `auto` 模式，且 confidence < 0.65 时仍保留为建议。

确认前会刷新书签数据，校验书签 ID 和版本。标题/URL 已变化或书签已删除时，不应用旧建议。手动修改会递增版本并取消对应后台任务，避免被正在返回的模型请求覆盖。

**分类只影响插件视图。** 这个版本没有整理 Chrome 原生文件夹的开关，不会创建分类目录或移动原书签。删除按钮则会删除 Chrome 原书签，操作前有明确确认。

## 首次分类和网页内容的边界

- 模型调用前需要配置接口并授权发送信息；没有配置时只读取本地书签。
- 第一版采用预设主分类，用户可以在设置中调整。不会自动创建大量自由标签或新主分类。
- 初次加载的旧书签只使用已有标题、URL、原文件夹；已有阅读快照时附带截断正文。
- 不会为了首次分类批量打开几百个网页，也不会自动爬取所有旧书签正文。
- 从 Chrome 原生界面新增的书签会自动出现在侧边栏；使用「为未分类书签生成建议」处理它们。
- 通过扩展收藏当前页时可提取当前已加载的正文，因此可以处理部分登录后文章；不上传 Cookie。
- 阅读快照仅保存精简文字结构，不保存图片、视频、完整页面样式或交互。
- 网页从未保存过且已经失效时，不能恢复正文；没有 Wayback 自动恢复。
- 访问检查是按需触发的；没有拦截每次浏览器导航，也不承诺实时判断所有失败页面。
- 搜索覆盖书签元数据和摘要，不包含全文索引或语义搜索。
- 没有账号、服务器、跨设备同步、团队功能、RSS 或 AI 聊天。

## 后台任务

任务保存在 IndexedDB，分批执行。每个任务带有租约与书签版本，Chrome 终止后台 Worker 后，过期租约可被重新领取。

- 单次模型请求最多 25 秒；建议使用响应较快、支持普通 Chat Completions 的非长推理模型。
- 模型响应必须是 JSON；Zod 校验字段，并检查输入输出 ID 一一对应及分类名称。
- 模型失败或输出不合法时保留失败记录并暂停；由用户点击重试，不无限消耗额度。
- 暂停不强行中断已发出的当前批次；当前批次可以完成，后续批次不启动。
- 浏览器关闭、设备休眠时不继续运行。重新启动后恢复进度，不保证立即唤醒。
- 崩溃发生在请求返回和落库之间时，某批次可能再次调用模型，无法保证零重复计费。

## 权限与隐私

| 权限 | 用途 |
|---|---|
| bookmarks | 读取原生书签；明确操作时创建、改名、删除 |
| sidePanel | 常驻侧边栏 |
| storage | 本地配置；API Key 不使用 Chrome Sync |
| alarms | 唤醒未完成的本地任务 |
| tabs / activeTab | 显示当前页标题和 URL、定位收藏目标 |
| scripting | 用户授权目标站点后注入正文提取脚本 |
| unlimitedStorage | 为本地正文快照提供存储空间 |
| 可选 HTTP/HTTPS host 权限 | 保存设置时授权模型主机；收藏/检查时授权具体网站 |

没有统计、遥测或第三方账号服务。调用远程模型时，输入内容会发送给你配置的服务，可能产生该服务的费用。

API Key 存在 `chrome.storage.local`，访问级别设为可信扩展上下文；不传给内容脚本，不进入导出文件。它不是加密密码保险箱。使用 HTTP 的远程接口时，传输不加密，建议只给本机模型使用 HTTP。

阅读 HTML 在提取和显示时均经 DOMPurify 限制标签与属性；不执行保存页面的脚本。

卸载扩展会丢失增强数据和快照，原生 Chrome 书签仍然保留。请提前导出备份。备份中包含网址和正文，属于个人数据。

## 技术栈与目录

WXT / Manifest V3、React、TypeScript、Tailwind CSS、Lucide、Dexie、AI SDK Core、Zod、Readability、DOMPurify、Fuse.js。基础控件直接按原型实现，没有引入整套 shadcn 组件或额外状态管理库。

```text
entrypoints/
  background.ts          后台入口
  extract.ts             按需注入的正文提取脚本
  sidepanel/             React 侧边栏入口与样式
src/
  App.tsx                主列表、分类确认、详情、阅读、设置
  domain.ts              可独立测试的规则
  service.ts             原生书签同步、任务队列、确认应用
  llm.ts                 模型调用、输出校验
  db.ts                  IndexedDB 表
  settings.ts            模型与分类配置
  backup.ts              不含密钥的导出/恢复
  messages.ts            侧边栏与后台消息
scripts/create-repo.sh    本地创建私有仓库并推送
```

## 后续验证

先执行完整 `npm run check`，再按 [验收清单](docs/ACCEPTANCE.md) 在新的 Chrome 测试配置文件中验收。不要未经验证就对主浏览器的大量书签批量删除或整理。

## 实现参考

- WXT Entrypoints: https://wxt.dev/guide/essentials/entrypoints.html
- Chrome Side Panel: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Chrome Service Worker 生命周期: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- Dexie: https://dexie.org/docs/
- Readability: https://github.com/mozilla/readability
- AI SDK: https://ai-sdk.dev/docs/introduction

这些是接口参考，未复制第三方产品代码。
