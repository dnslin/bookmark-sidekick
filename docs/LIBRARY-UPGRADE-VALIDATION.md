# 标签整理 正文搜索与稍后读验证记录

日期：2026-10-21。分支：`codex/library-upgrade`。

三项功能已按确认方案实现。沿用现有系统字体、颜色、书签行和「最近／分类／待确认」导航。完整自动检查、隔离浏览器验证及真实 Chrome 扩展加载、站点权限与 MV3 后台重启验证均通过。

## 实现结果

| 功能 | 当前行为 |
| --- | --- |
| 手动标签 | 支持输入、已有标签建议、移除、清空与保存；每条最多 20 个，每个最多 32 字符；未回车输入也会提交；保存期间的新编辑保留。 |
| 批量整理 | 只选择当前结果；批量改分类、增删指定标签和安排阅读；默认保持不变；取消保留选择；失败保留面板与草稿；已删除书签明确跳过。 |
| 正文搜索 | 本地 Worker 执行；复用两套 Fuse 索引；中文分词、多词跨字段 AND、元数据模糊与正文精确包含；片段来自实际正文，点击进入快照定位。 |
| 稍后读 | 主动加入后进入待读；本地快照支持继续阅读与位置恢复；滚动到底不自动已读；明确点击后完成；移出只改阅读安排。 |
| 数据与备份 | Dexie v2 一次升级补默认阅读字段；v3 备份包含手动标签、阅读状态、正文和位置；明确拒绝 v1/v2。 |

手动整理继续使用已有的整条 AI 保护。阅读更新不增加 AI 内容版本，也不取消分类任务。正文快照的版本保持单调，防止旧阅读页在连续保存或备份恢复后回写位置。

列表只显示阅读状态；具体阅读百分比在阅读菜单、详情和阅读页显示，避免为了列表展示位置而读取整库快照正文。短侧栏的批量表单整体滚动，字段和操作区不互相遮挡；阅读页底部控制保持可见。

## 实际执行的自动检查

环境：Node.js `v26.12.0`，npm `11.20.0`。使用项目现有依赖，没有修改依赖清单或锁文件。

| 命令 | 结果 |
| --- | --- |
| `npm run check` | 通过：严格类型检查、153 项测试、Chrome MV3 生产构建。153 项通过，0 失败，0 跳过。 |
| `git diff --check` | 通过。 |
| `node --experimental-strip-types --test tests/search*.test.mjs` | 18 项搜索测试通过，包含查询清空、错误重试、旧回包、索引增量与特殊标点。 |
| `node --experimental-strip-types scripts/benchmark-search.mjs` | 固定规模和全文末尾命中断言通过，见下表。 |
| 旧快照版本判断的条件反转实验 | 临时反转 `SAVE_PROGRESS` 的版本比较后，两项回归失败；恢复原文件后，整理测试 19 项通过。确认测试能识别该保护失效。 |

关键新增测试先验证失败，再验证实现后通过。原有设置草稿、AI 在途修改、恢复唯一匹配、搜索与分类测试没有跳过或削弱。独立评审发现的并发标签丢失和重复恢复版本回退已修复，并新增回归。

生产产物位于 `.output/chrome-mv3`，总大小约 1.28 MB。侧边栏脚本约 584.89 kB，独立搜索 Worker 约 127.31 kB。构建仍提示侧边栏脚本超过 500 kB；没有调整提示阈值。

## 固定规模搜索验证

以下是本机 Node 的一次固定语料模拟，包含实际 Fuse 建索引与查询。时间不包含 IndexedDB 读取、线程通信和界面渲染，不代表用户真实书签库的完整交互时间。

| 规模 | 首次查询含建索引 | 索引就绪后的查询 |
| --- | --- | --- |
| 1,000 篇，4,011,354 字符 | 42.7 ms | 11.8—19.7 ms |
| 10,000 篇，40,113,534 字符 | 348.8 ms | 112.8—173.9 ms |
| 单篇 499,941 字符，命中正文末尾 | 2.12 ms | 正确返回命中片段 |

一万篇的「状态 恢复」查询实际返回全部一万条，耗时 145.8 ms。正文没有截断；只限制展示片段长度。对应模拟的堆使用增量约 180 MiB，并非浏览器峰值内存测量。

## 隔离浏览器验证

使用项目实际 App、后台服务、Dexie 和 IndexedDB。测试入口使用现有 Vite/Tailwind 依赖生成生产模式产物，仅替换 Chrome API；样例与真实个人书签隔离。页面采用与扩展相同的 `script-src 'self'; object-src 'none'; base-uri 'none'` 策略。

还直接运行了 WXT 生成的搜索 Worker 文件，确认在该策略下能够创建线程、读取真实 IndexedDB 并返回正确正文结果。此检查没有把 Worker 改成 Blob，也没有放宽 CSP。

| 场景 | 实际结果 |
| --- | --- |
| 存量数据库升级 | 先建立真实 v1 数据库，再由产品代码打开为 v2；7 条原书签和 5 份快照保留，阅读状态默认 `none`、位置默认 0。 |
| 单条标签保存 | 通过界面添加标签，实际后台写入 IndexedDB，再通过真实搜索线程找到书签。 |
| 批量事务失败与重试 | 在第二条写入的真实 Dexie hook 中注入错误；两条记录整体回滚；界面保留两个选择和标签草稿；移除故障后重试成功，原标签仍保留。 |
| 当前结果与取消 | 搜索结果两条，全选只选这两条；取消面板不写入且保留选择；改变查询退出整理并清除选择。 |
| 选中项被删除 | 选中两项后，通过模拟原生书签 API 删除其中一项；其余一项成功，明确提示一项已删除并跳过。 |
| 正文命中与定位 | 仅正文中的「中断恢复」返回两条结果；点击片段后实际文本节点被高亮，定位到对应段落；返回保留查询。 |
| 阅读进度 | 滚动实际阅读容器，真实 scroll 事件触发位置保存；重开快照恢复至 100%；此时仍为阅读中，点击已读才从待读列表移出。 |
| 阅读不重建索引 | 记录创建线程、查询请求与回包数量；阅读状态和位置写入后这些数量保持不变。 |
| 正文更新与删除 | 当前查询不变时保存新正文，结果自动出现；删除带正文书签后结果消失，覆盖正文数从 5 减至 4。 |
| 旧位置拒写 | 替换正文和恢复不同正文后，使用旧 `capturedAt` 的实际后台请求返回拒写，不覆盖新位置。 |
| v3 备份往返 | 实际点击导出，下载 v3 JSON；改变标签、分类与正文后从界面恢复，内容对应正确；恢复版本不回退。 |
| 旧备份反馈 | 选择 v2 文件后显示「不支持此备份格式，仅支持 v3 备份」，没有展示可确认的恢复预览。 |
| 搜索失败与重试 | 注入工作线程错误后显示失败和重试；没有伪装成无结果；重试重新创建线程并返回正确结果。 |
| 清空查询与缓存 | 清空后通知已有线程停止旧查询；随后正文变化不会发布旧结果；再次查询复用缓存并找到新正文。 |
| 弹窗键盘行为 | Enter 打开后，Escape、取消按钮和关闭按钮均返回「批量修改」触发按钮；取消保留选择；模态背景不能获取焦点。 |
| 窄宽度与短高度 | 430、360、320 px 无横向溢出；320×600 深色下的 32 字符标签正常换行，阅读选项不被操作区遮挡，提交按钮可滚动或按 Tab 到达。 |
| 阅读页短高度 | 320×600 下无横向溢出，底部阅读位置和完成按钮位于可见视口内。 |

最终隔离页面捕获的未处理 JavaScript 异常为 0。线程故障与数据库错误是明确注入的测试场景，其界面错误反馈和恢复均单独检查。

## 真实 Chrome 扩展验收

使用已安装的官方 Google Chrome `155.0.8059.80`，通过原生扩展管理页加载 `.output/chrome-mv3`。扩展 ID 为 `aimgndkeefgblddienmpaimmjnilojlc`，来源路径和启用状态已在 Chrome 界面核对。使用独立配置 `.output/chrome-real-qa-profile`，没有登录账号或导入个人书签。

本轮运行完整的已构建扩展。书签、权限、侧边栏、内容提取脚本、后台消息、IndexedDB 和正文搜索线程都使用真实 Chrome 实现，没有替换 API，也没有修改构建产物或 CSP。三篇本地文章通过扩展的「收藏」操作建立原生书签与快照，没有直接向数据库写入样例。

| 场景 | 实际结果 |
| --- | --- |
| 未打包扩展加载 | 开发者模式下选择构建目录，Chrome 显示「扩展程序已加载完毕」；从扩展按钮打开实际侧边栏，初始书签数为 0。 |
| 拒绝读取权限 | 点击收藏后出现 Chrome 原生「读取和更改您在 localhost 上的数据」弹窗；拒绝后仍创建原生书签，提示「未授权读取网页，仅保存书签」；详情没有正文，阅读按钮禁用，正文专属关键词无结果。 |
| 允许读取权限 | 在 `127.0.0.1` 文章上允许原生弹窗，实际注入 `extract.js` 并保存正文；同站点第二篇收藏无需重复弹窗。搜索仅在长文章末尾出现的「真实扩展缓存命中」，返回正确书签和真实片段。 |
| 手动标签和批量整理 | 先为一条书签保存「手动验收」；随后全选三条，统一改为工具分类、追加「Chrome批量」、加入稍后读；提示三项成功。重载后原标签和新增标签均保留，没有覆盖原标签。 |
| 真实滚动和位置恢复 | 从稍后读打开快照，使用实际侧栏滚动到 43%；关闭侧栏并停止后台，再打开后菜单显示「继续阅读 · 43%」，正文容器恢复到 43%。 |
| 关闭侧栏后停止后台 | 在 `chrome://serviceworker-internals/` 对本扩展点击 Stop；确认状态变为 `STOPPED`、进程为 0、线程为 -1。重新打开侧栏后，后台恢复 `RUNNING`，进程从 79903 变为 82470。分类、标签、阅读状态及位置保留。 |
| 侧栏保持打开时停止后台 | 再次 Stop，确认 `STOPPED`；直接在现有阅读页点击「标记已读」。实际后台消息唤醒新线程，状态变为 `RUNNING`，线程从 1 变为 2；界面提示已读成功。没有手动点击 Start，也没有打开后台 DevTools 维持运行。 |
| 扩展重新加载 | 从扩展管理页点击重新加载，Chrome 显示「已重新加载」。再次打开侧栏，三条书签、工具分类、两个标签、待读两条及已读一条均保留；已授予站点访问权限仍生效。扩展管理页未出现错误条目。 |
| 拒绝后的补授权 | 回到 localhost 页面，再次点击顶部收藏并允许权限；提示已有书签快照已更新，书签总数仍为三条。搜索此前无结果的正文关键词，正确返回原书签；其两个标签和待读状态保留，正文覆盖数为 3。 |
| 稍后读筛选 | 待阅读显示两条，已读显示一条；已读书签仍保留在全部收藏中。 |
| 真实搜索定位 | 重载后搜索「批量整理正文线索」，打开命中片段后跳到正文末尾，实际可见文字高亮；阅读位置为 100%，状态仍为阅读中，完成仍需显式标记。 |

本轮没有发现需要修复的三项功能缺陷，没有修改产品代码、依赖或权限声明。`git diff --quiet 387cbb9 -- src entrypoints tests package.json package-lock.json wxt.config.ts` 通过，确认验收所用实现与上一轮已通过 153 项自动检查的提交一致。本轮没有为文档和截图重复运行该组自动测试。

本地文章由 `python3 -m http.server 47833 --bind 127.0.0.1 --directory .output/chrome-real-qa-site` 提供。Chrome 使用 `--user-data-dir=/Volumes/data/project/bookmark-sidekick/.output/chrome-real-qa-profile --no-first-run --no-default-browser-check --remote-debugging-port=0` 启动，所有页面操作、权限处理和后台停止均通过真实 Chrome 界面完成。

真实 Chrome 截图：

- [扩展已加载](/Volumes/data/project/bookmark-sidekick/docs/library-chrome-loaded.png)
- [原生权限弹窗](/Volumes/data/project/bookmark-sidekick/docs/library-chrome-permission.png)
- [批量修改三条书签](/Volumes/data/project/bookmark-sidekick/docs/library-chrome-bulk.png)
- [正文末尾搜索结果](/Volumes/data/project/bookmark-sidekick/docs/library-chrome-search.png)
- [真实滚动至 43%](/Volumes/data/project/bookmark-sidekick/docs/library-chrome-reader-progress.png)
- [后台停止后的 43% 恢复](/Volumes/data/project/bookmark-sidekick/docs/library-chrome-reader-restored.png)
- [后台 STOPPED](/Volumes/data/project/bookmark-sidekick/docs/library-chrome-worker-stopped.png)
- [后台再次 RUNNING 与已读成功](/Volumes/data/project/bookmark-sidekick/docs/library-chrome-worker-restarted.png)
- [正文末尾定位与高亮](/Volumes/data/project/bookmark-sidekick/docs/library-chrome-search-located.png)

## 隔离浏览器截图

截图来自实际 React 界面和隔离示例数据，不是原型，也不是用户个人书签。

- [最近列表](/Volumes/data/project/bookmark-sidekick/docs/library-home.png)
- [批量修改](/Volumes/data/project/bookmark-sidekick/docs/library-bulk.png)
- [正文搜索结果](/Volumes/data/project/bookmark-sidekick/docs/library-search.png)
- [阅读页及位置](/Volumes/data/project/bookmark-sidekick/docs/library-reader.png)
- [320px 深色长标签表单](/Volumes/data/project/bookmark-sidekick/docs/library-dark-320.png)

## 验证边界

- 隔离浏览器一节的 Chrome 接口使用测试替身；真实 Chrome 一节使用完整扩展和实际 Chrome API。两组样例均与个人书签库隔离，未访问或修改用户个人 Chrome 书签。
- 没有连接真实模型；AI 分类的在途修改、手动保护和阅读并发使用隔离自动测试覆盖。
- 真实扩展加载、原生权限拒绝与允许、扩展重载，以及两种 MV3 后台 Stop 后唤醒场景已验收。本轮没有使用个人书签库，也不将本地样例结果等同于所有外部网站的正文提取效果。
- 没有推送、创建发布或合并。本次改动保留在本地功能分支上。
