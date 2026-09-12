#!/usr/bin/env bash
# Run locally after installing GitHub CLI. No access token is stored in this project.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v gh >/dev/null || { printf '%s\n' '请先安装 GitHub CLI：macOS 可运行 brew install gh'; exit 1; }
gh auth status >/dev/null 2>&1 || { printf '%s\n' '请先执行 gh auth login --hostname github.com --scopes workflow，再重新运行此脚本'; exit 1; }
OWNER="$(gh api user --jq .login)"
if [[ "$OWNER" != "dnslin" ]]; then
  printf '本机当前登录的是 %s，不是 dnslin。请先切换正确账号；未创建仓库。\n' "$OWNER"
  exit 1
fi
NAME="${1:-bookmark-sidekick}"
[[ "$NAME" =~ ^[a-zA-Z0-9._-]+$ ]] || { echo '仓库名只能包含字母、数字、点、下划线和连字符'; exit 1; }
if gh repo view "$OWNER/$NAME" >/dev/null 2>&1; then
  echo "仓库 $OWNER/$NAME 已存在；脚本停止，不会覆盖。"; exit 1
fi
if [[ ! -d .git ]]; then git init -b main; fi
if git remote get-url origin >/dev/null 2>&1; then
  echo '当前目录已经配置 origin；脚本停止，不会更换远程地址。'; exit 1
fi
if ! git var GIT_AUTHOR_IDENT >/dev/null 2>&1; then
  echo '请先设置本机 Git 用户信息：git config --global user.name / user.email'; exit 1
fi
git add .
if ! git diff --cached --quiet; then git commit -m 'feat: initial Chrome sidebar bookmark MVP'; fi
gh repo create "$OWNER/$NAME" --private --source=. --remote=origin --push \
  --description '个人 Chrome 侧边栏书签助手：LLM 分类预览、用户确认、阅读快照'
printf '\n已创建私有仓库并推送源码：%s/%s\n' "$OWNER" "$NAME"
