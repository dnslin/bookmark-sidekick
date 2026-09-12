# 验证记录

本次交付是源代码，不是经过完整运行验证的安装包。

## 已执行

| 检查 | 结果 |
|---|---|
| `npm test` | 30 项测试通过，0 失败 |
| 12 个 TS/TSX 文件的 TypeScript `transpileModule` 语法诊断 | 0 个语法错误 |
| `src/domain.ts` 严格类型检查 | 通过，包含 strict 与 noUncheckedIndexedAccess |
| `bash -n scripts/create-repo.sh` | 通过 |

测试使用 Node.js 22.16.0、TypeScript 5.8.3。核心规则没有外部依赖，可以在没有安装 npm 包的环境运行。

## 尚未执行 / 不能声称通过

- npm 依赖安装及 lockfile 生成：当前环境无法解析 `registry.npmjs.org`。
- 全项目 TypeScript 类型检查：依赖类型尚不可用。
- WXT 生产构建、`.output/chrome-mv3` 安装包生成。
- Chrome 中的完整交互、页面布局、权限请求、IndexedDB 与 Worker 联动测试。
- 真实 LLM 请求：没有使用用户 API Key，没有产生模型费用。
- GitHub 创建、推送和 Actions：当前连接没有创建仓库操作，本机也没有已认证的 GitHub CLI。

`transpileModule` 的语法检查不等于完整类型检查；30 项纯函数测试不等于数据库或 Chrome 集成测试。

## 建议的首次完整验证

```bash
npm install
npm run check
```

运行后按 `docs/ACCEPTANCE.md` 验收。首次成功安装后提交 `package-lock.json`，将 CI 改为使用 `npm ci` 固定解析结果。
## 2026-09-12 完整包复核

新版界面与轻量动画已经合并到完整项目中。本次打包实际执行：

| 检查 | 结果 |
|---|---|
| `node --experimental-strip-types --test tests/*.test.mjs` | 30 项测试通过，0 失败 |
| 12 个 TS/TSX 文件的 TypeScript `transpileModule` 语法诊断 | 0 个语法错误 |
| 新版 `style.css` 结构检查 | 198 个代码块，花括号平衡 |
| `bash -n scripts/create-repo.sh` | 通过 |

当前打包环境不能解析 `registry.npmjs.org`，因此没有在这里重新安装依赖或执行 WXT 生产构建。解压后在可联网环境运行 `npm install && npm run check`。

