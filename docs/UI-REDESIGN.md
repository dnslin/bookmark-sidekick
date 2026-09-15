# 拾签界面重设计

用户确认以提供的三页设计稿为视觉基准，取代早期视觉方案。分支：`codex/apple-ui-redesign`。

## 目标与技术

保留浏览器侧边栏收藏、搜索、分类、建议确认、详情、阅读、设置和备份能力。采用 React 19、Tailwind CSS 4、Lucide 与 Motion for React。Appica 基础控件和 Cult UI 分段导航作为参考，最终布局以用户设计稿为准。

## 界面与行为

- 顶部：线性书签图标、拾签、收藏加号和设置；搜索框下是无边框当前网页行。
- 收藏：今天／昨天／更早分组，显示网站图标、标题、域名和右侧分类。悬停或键盘聚焦显示详情入口，底部显示书签总数和刷新。
- 分类：蓝色线性文件夹、名称与真实数量；独立未分类／新建分类区域。编辑进入原有设置，新建分类复用设置校验与存储。标签点击后筛选对应书签。
- 建议：展开一条建议，展示分类、标签和摘要，其余折叠。确认沿用 APPLY；忽略只删除草稿，不修改书签。保留文字形式的批量确认入口。
- 网站图标：SiteIcon 使用 Chrome favicon 服务；失败时显示域名首字母。替换原有 DOM 观察器，使当前页、书签、详情和建议使用同一组件。
- 布局：顶部和底部保留位置，正文独立滚动；主要参考尺寸 430×960，适配 320px 窄侧栏。
- 动效：分段选中背景弹簧过渡，页面淡入；系统减少动态效果时停止位移。

## 代码位置与规范

- `src/App.tsx`：界面数据流与现有业务回调。
- `src/components/Navigation.tsx`、`Review.tsx`、`SiteIcon.tsx`：独立界面职责。
- `src/library.ts`：日期分组与分类／标签筛选纯函数。
- `entrypoints/sidepanel/style.css`、`restore.css`：统一样式。
- `tests/`：Node 测试；沿用单引号、命名函数与显式类型。

## 边界与验证

始终保留错误提示、权限请求时机和后台校验。不修改数据库结构、AI 协议或 Chrome 原生文件夹。新增分类仅影响本地配置。

命令：`npm run typecheck`、`npm test`、`npm run build`、`git diff --check`。浏览器验证范围和局限见 `UI-VALIDATION.md`。

参考文档：https://appica.dev/ui/docs/react/installation 、https://www.cult-ui.com/docs/components/direction-aware-tabs 、https://motion.dev/docs/react 。
