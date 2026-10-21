# v0.2.0 发布检查

日期：2026-10-21。功能基线：`main` 的 `92b2e43`。版本元数据和更新日志在该基线上更新，没有修改产品源码、依赖版本、扩展权限或发布工作流。

## 版本与安装包

- `package.json`、锁文件顶层及根包版本均为 `0.2.0`，生成的 Chrome Manifest V3 清单版本一致。
- 本地 `bookmark-sidekick-0.2.0-chrome.zip` 为 410,598 字节，包含 16 个扩展文件；逐字节对应构建目录，入口、样式、图标和搜索线程文件齐全。
- 发布包由现有标签工作流重新构建，附件使用 `bookmark-sidekick-v0.2.0-chrome.zip` 和对应 `.sha256`。远端构建、附件与发布状态以 [GitHub Actions](https://github.com/dnslin/bookmark-sidekick/actions) 和 [Release](https://github.com/dnslin/bookmark-sidekick/releases/tag/v0.2.0) 为准。
- 更新日志覆盖自 `v0.1.7` 以来的 PR #6 / #7，明确说明 v3-only 备份变化；已有浏览器内数据保留，旧 v1/v2 备份不能直接导入。

## 已执行检查

| 命令／检查 | 结果 |
| --- | --- |
| `npm run check` | 类型检查、160 项测试和 Chrome 生产构建通过；0 失败、0 跳过。 |
| `npm run zip` | 成功生成 Chrome ZIP。 |
| `unzip -t .output/bookmark-sidekick-0.2.0-chrome.zip` | 所有文件完整性检查通过。 |
| 清单与 ZIP 入口核对 | 版本为 0.2.0，MV3；后台、侧栏、提取脚本、图标、样式和正文搜索线程存在。 |
| 版本与依赖 JSON 对照 | 除三个根版本字段外，包元数据和锁定依赖图与功能基线一致。 |
| `git diff --check` | 通过。 |
| `npm audit --json` | 退出 1：9 项既存包告警，1 低、4 中、4 高。不是无告警结果。 |
| `npm audit --omit=dev --json` | 退出 1：7 项，1 低、4 中、2 高；生产依赖标签不等于代码实际进入 Chrome 执行路径，适用性见下节。 |

构建保留侧栏脚本超过 500 kB 的现有提示，没有隐藏或调高阈值。三项功能的真实 Chrome、长文回归与性能边界见 [功能验收记录](LIBRARY-UPGRADE-VALIDATION.md)。

## 依赖告警适用性

按锁定版本、完整调用链和 Chrome 产物核对，而不是仅凭包名或字符串是否出现判断。以下结论只覆盖当前浏览器扩展、受控源码的 macOS 本地构建及 Ubuntu 标签构建；不表示依赖已修补，也不推广到其他运行方式。

| 告警来源 | 当前路径与处理理由 |
| --- | --- |
| `undici@5.29.0` / `@fastify/busboy@2.1.1`，两项高危包 | AI SDK 的 `getDefaultDownloadFetch()` 先判断 Node 运行时；Chrome 返回原生 `globalThis.fetch`，只有 Node 分支才动态加载 Undici。包中保留该分支文字，但没有 Undici 的网络、WebSocket 或 Busboy 解析实现。本项目模型调用只发送文本，构建／测试也不调用该下载分支，没有调用其 WebSocket 或 multipart 解析路径。[Undici 公告](https://github.com/nodejs/undici/security/advisories/GHSA-vxpw-j846-p89q)、[Busboy 公告](https://github.com/fastify/busboy/security/advisories/GHSA-x8mw-p69m-v3mx)。 |
| `ai`、`@ai-sdk/openai-compatible`、`@ai-sdk/gateway`、`@ai-sdk/provider-utils`，四项中危包 | 审计通过上述 Undici 依赖链传播；当前 Chrome 使用原生网络接口。没有将审计传播出的包数量误写成四个独立的浏览器漏洞。 |
| `vite@8.3.0`，高危包 | 告警来自开发服务器的编辑器启动路径；本次只执行 build／zip，未启动该服务器或编辑器端点，Chrome ZIP 不包含开发服务器。当前 macOS／Ubuntu 发布路径也不满足 Windows 公告的运行条件。[维护者公告](https://github.com/vitejs/launch-editor/security/advisories/GHSA-587h-7wmj-h5pm)。 |
| `source-map-js@1.2.1`，高危包 | 只属于构建工具链。告警针对处理攻击者控制的索引 source map；当前发布只处理受控仓库和锁定依赖的输入，不接收外部 source map，Chrome ZIP 也不包含该解析器。[公告](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)。 |
| `dompurify@3.4.15`，低危包 | 两份公告要求 `IN_PLACE` 节点输入，其中一份还涉及清洗 hook。正文提取与 Reader 均传入字符串和白名单配置，未启用 `IN_PLACE` 或注册清洗 hook，未调用公告所述路径。[维护者公告](https://github.com/cure53/DOMPurify/security/advisories/GHSA-6688-9rhm-gjv2)。 |

结论：在以上明确边界内，没有确认的可达高危路径阻塞本次 Chrome 发布；原生审计仍为非零。本次不将发布扩大为依赖集中升级，保留现有锁定版本。依赖修补的复查日期为 **2026-10-28，或下次版本发布前，以较早者为准**。Node 执行方式、对外开发服务器、外部 source map 输入或清洗模式改变时，需要重新核对这些结论。
